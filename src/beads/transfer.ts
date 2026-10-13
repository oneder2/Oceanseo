import { invoke, isTauri } from "../personal/invoke";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { flushAppData, withAppRestore } from "../appDataStore";
import { profileLocalStorage as localStorage, profileSessionStorage } from "../profileStorage";
import { isBeadWorksDocument, validBeadWork, type BeadWork, type BeadWorksDocument } from "./works";
import { profileStatus, type LocalProfile, type ProfileStatus } from "../accountStore";

export const TRANSFER_MAX_BYTES = 2 * 1024 * 1024;
export const TRANSFER_NOTICE = "oceanseo.bead-copy-notice.v1";
export interface BeadTransferBundle {
  beadTransferVersion: 1;
  operationId: string;
  createdAt: string;
  sourceLabel: string;
  works: BeadWork[];
}
export interface BeadTransferPreview {
  operationId: string;
  bundleHash: string;
  targetHash: string;
  existingCount: number;
  incomingCount: number;
  alreadyCopied: boolean;
}
export interface BeadTransferReceipt {
  operationId: string;
  workIds: string[];
  copiedCount: number;
  alreadyCopied: boolean;
  snapshotPath: string;
}

export interface BeadHandoff {
  version: 1;
  sourceKey: string;
  targetKey: string;
  worksHash: string;
  bundle: BeadTransferBundle;
}
export function profileLabel(target: LocalProfile) {
  const space = target.workspace;
  return `${target.username ? `${target.username} · ` : ""}${space ? `${space.environment === "preview" ? "测试" : "正式"} · ${space.edition === "personal" ? "个人空间" : "拼豆空间"}` : target.username ? "个人账号资料库" : "本机资料库"}`;
}
export const pendingHandoff = () => invoke<BeadHandoff | null>("pending_bead_handoff");
export const cancelHandoff = (handoff: BeadHandoff) => invoke<void>("cancel_bead_handoff", { targetKey: handoff.targetKey, operationId: handoff.bundle.operationId });

export async function openCopyDestination(targetKey: string, expectedCurrent: string, workIds: string[]) {
  return withAppRestore(async () => {
    const current = await profileStatus();
    if (current.current.key !== expectedCurrent) throw Error("来源资料库已变化，请重新选择作品。");
    if (current.restartRequired) {
      if (current.selectedKey !== targetKey) throw Error("待打开的资料库已变化，请通过账号页面重新确认。");
    }
    // Verify the exact native snapshot even when a previous restart failed.
    await invoke<BeadHandoff>("stage_bead_handoff", { targetKey, expectedCurrent, workIds });
    if (!current.restartRequired) {
      await invoke<ProfileStatus>("select_local_profile", { key: targetKey, expectedCurrent });
    }
    await invoke("restart_selected_profile", { selectedKey: targetKey });
  });
}

function copyNotice(receipt: BeadTransferReceipt, cleanupPending = false) {
  try {
    profileSessionStorage.setItem(TRANSFER_NOTICE,
      (receipt.alreadyCopied ? "这些作品已复制过，本次没有重复添加。" : `已复制 ${receipt.copiedCount} 件作品到当前资料库，原作品仍保留。`)
      + (cleanupPending ? "暂存记录尚未清理，重新确认不会重复添加。" : ""));
  } catch { /* Native copy has committed. */ }
}
export async function copyHandoff(handoff: BeadHandoff, preview: BeadTransferPreview) {
  return withAppRestore(async () => {
    const result = await invoke<{ receipt: BeadTransferReceipt; cleanupPending: boolean }>("commit_bead_handoff", {
      operationId: handoff.bundle.operationId, expectedTargetHash: preview.targetHash, expectedBundleHash: preview.bundleHash,
    });
    copyNotice(result.receipt, result.cleanupPending);
    window.location.reload();
    return result.receipt;
  });
}

export function parseTransfer(content: string): BeadTransferBundle {
  if (new TextEncoder().encode(content).length > TRANSFER_MAX_BYTES) throw Error("作品文件超过 2 MB，请减少一次导出的作品数量。");
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw Error("作品文件无法读取，请从原作品页面重新导出。"); }
  if (!value || typeof value !== "object") throw Error("请选择从作品页面导出的作品文件。");
  const bundle = value as BeadTransferBundle;
  if (bundle.beadTransferVersion !== 1 || typeof bundle.operationId !== "string"
    || !/^[0-9a-f-]{36}$/.test(bundle.operationId)
    || typeof bundle.sourceLabel !== "string" || !bundle.sourceLabel.trim() || bundle.sourceLabel.length > 120
    || typeof bundle.createdAt !== "string" || !Number.isFinite(Date.parse(bundle.createdAt))
    || !Array.isArray(bundle.works) || !bundle.works.length || bundle.works.length > 100 || !bundle.works.every(validBeadWork)) {
    throw Error("作品文件无效。这不是整库备份；请从原作品页面重新导出。");
  }
  return bundle;
}

function downloadBrowserFile(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function browserWorks(): BeadWorksDocument {
  const raw = profileSessionStorage.getItem("tideplan.bead-works.v1") ?? localStorage.getItem("tideplan.bead-works.v1");
  if (!raw) return { version: 1, activeId: "", works: [] };
  const value: unknown = JSON.parse(raw);
  if (!isBeadWorksDocument(value)) throw Error("当前浏览器作品资料无效");
  return value;
}
function browserClone(work: BeadWork): BeadWork {
  const versions = new Map(work.versions.map(version => [version.id, crypto.randomUUID()]));
  const timestamp = new Date().toISOString();
  const copyId = crypto.randomUUID();
  return { ...structuredClone(work), id: copyId, title: `${work.title.slice(0, 75)} · 副本`, createdAt: timestamp, updatedAt: timestamp,
    currentVersionId: versions.get(work.currentVersionId)!, progressVersionId: versions.get(work.progressVersionId ?? work.currentVersionId),
    versions: work.versions.map(version => ({ ...structuredClone(version), id: versions.get(version.id)!, pattern: { ...structuredClone(version.pattern), title: `${work.title.slice(0, 75)} · 副本` } })) };
}
function browserHash(value: unknown) { return JSON.stringify(value); }
export async function exportWorksFile(workIds: string[], sourceWorks?: BeadWork[]) {
  if (!isTauri()) {
    const works = (sourceWorks ?? browserWorks().works).filter(work => workIds.includes(work.id));
    if (!works.length) throw Error("没有可导出的作品");
    const bundle: BeadTransferBundle = { beadTransferVersion: 1, operationId: crypto.randomUUID(), createdAt: new Date().toISOString(), sourceLabel: "Oceanseo Web", works: structuredClone(works) };
    const content = JSON.stringify(bundle);
    if (new TextEncoder().encode(content).length > TRANSFER_MAX_BYTES) throw Error("作品文件超过 2 MB，请减少一次导出的作品数量。");
    downloadBrowserFile(`Oceanseo-works-${new Date().toISOString().slice(0, 10)}.oceanbeads`, content);
    return true;
  }
  await flushAppData();
  const bundle = await invoke<BeadTransferBundle>("export_bead_transfer", { workIds });
  let path: string | null;
  try {
    path = await save({ title: "导出可编辑作品文件", defaultPath: `Oceanseo-works-${new Date().toISOString().slice(0, 10)}.oceanbeads`,
      filters: [{ name: "Oceanseo 作品文件", extensions: ["oceanbeads"] }] });
  } catch (reason) {
    // Android's document picker rejects on cancellation; desktop returns null.
    if (String(reason).replace(/^Error: /, "") === "File picker cancelled") return false;
    throw reason;
  }
  if (!path) return false;
  await writeTextFile(path, JSON.stringify(bundle));
  return true;
}
export async function previewWorksFile(bundle: BeadTransferBundle) {
  if (!isTauri()) {
    const current = browserWorks();
    const alreadyCopied = profileSessionStorage.getItem(`oceanseo.bead-copy.${bundle.operationId}`) === "done";
    return { operationId: bundle.operationId, bundleHash: browserHash(bundle), targetHash: browserHash(current), existingCount: current.works.length, incomingCount: alreadyCopied ? 0 : bundle.works.length, alreadyCopied } satisfies BeadTransferPreview;
  }
  await flushAppData();
  return invoke<BeadTransferPreview>("preview_bead_transfer", { bundle });
}
export async function copyWorksFile(bundle: BeadTransferBundle, preview: BeadTransferPreview) {
  if (!isTauri()) {
    const current = browserWorks();
    if (browserHash(current) !== preview.targetHash) throw Error("当前作品已变化，请重新预览");
    if (profileSessionStorage.getItem(`oceanseo.bead-copy.${bundle.operationId}`) === "done") return { operationId: bundle.operationId, workIds: [], copiedCount: 0, alreadyCopied: true, snapshotPath: "" };
    if (current.works.length + bundle.works.length > 100) throw Error("当前资料库最多保存 100 件作品，请先整理。");
    const copies = bundle.works.map(browserClone);
    const next: BeadWorksDocument = { ...current, activeId: copies[0]?.id ?? current.activeId, works: [...current.works, ...copies] };
    if (!isBeadWorksDocument(next)) throw Error("作品文件无法写入当前资料库");
    localStorage.setItem("tideplan.bead-works.v1", JSON.stringify(next));
    profileSessionStorage.setItem(`oceanseo.bead-copy.${bundle.operationId}`, "done");
    return { operationId: bundle.operationId, workIds: copies.map(work => work.id), copiedCount: copies.length, alreadyCopied: false, snapshotPath: "" };
  }
  return withAppRestore(async () => {
    const receipt = await invoke<BeadTransferReceipt>("commit_bead_transfer", { bundle, expectedTargetHash: preview.targetHash, expectedBundleHash: preview.bundleHash });
    copyNotice(receipt);
    window.location.reload();
    return receipt;
  });
}
