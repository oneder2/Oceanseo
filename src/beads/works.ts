import { isPattern, type BeadPattern } from "./model";
import { samePattern } from "./document";

export const BEAD_WORKS_VERSION = 1 as const;
export const WORK_HISTORY_LIMIT = 20;

export interface BeadWorkVersion {
  id: string;
  label: string;
  createdAt: string;
  pattern: BeadPattern;
  /** Physical completion snapshot when leaving this drawing version. */
  completedCells?: number[];
}

export interface BeadWork {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  currentVersionId: string;
  versions: BeadWorkVersion[];
  completedCells: number[];
  /** The exact version the completion marks belong to. Old documents omit it. */
  progressVersionId?: string;
  deletedAt?: string;
  deletedFromArchive?: boolean;
}

export interface BeadWorksDocument {
  version: typeof BEAD_WORKS_VERSION;
  activeId: string;
  works: BeadWork[];
  /** Optional per-account stock snapshot keyed by a stable brand/color identity. */
  inventory?: Record<string, number | null>;
  /** Purged identities are retained for later operation-based sync. */
  purgedWorkIds?: string[];
}

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
export const isDeletedWork = (work: BeadWork) => work.deletedAt !== undefined;
export const isLiveWork = (work: BeadWork) => !work.archived && !isDeletedWork(work);
export function validCompletion(value: unknown, pattern: BeadPattern): value is number[] {
  return Array.isArray(value) && new Set(value).size === value.length
    && value.every(index => Number.isInteger(index) && index >= 0 && index < pattern.cells.length && pattern.cells[index] >= 0);
}

export function validWorkVersion(value: unknown): value is BeadWorkVersion {
  if (!value || typeof value !== "object") return false;
  const v = value as BeadWorkVersion;
  return typeof v.id === "string" && /^[0-9a-f-]{36}$/.test(v.id)
    && typeof v.label === "string" && v.label.length <= 80
    && typeof v.createdAt === "string" && isPattern(v.pattern)
    && (v.completedCells === undefined || validCompletion(v.completedCells, v.pattern));
}

export function validBeadWork(value: unknown): value is BeadWork {
  if (!value || typeof value !== "object") return false;
  const work = value as BeadWork;
  return typeof work.id === "string" && /^[0-9a-f-]{36}$/.test(work.id)
    && typeof work.title === "string" && work.title.length <= 80
    && typeof work.createdAt === "string" && typeof work.updatedAt === "string"
    && typeof work.archived === "boolean"
    && (work.deletedAt === undefined ? work.deletedFromArchive === undefined
      : typeof work.deletedAt === "string" && Number.isFinite(Date.parse(work.deletedAt)) && work.archived && typeof work.deletedFromArchive === "boolean")
    && Array.isArray(work.versions) && work.versions.length > 0 && work.versions.length <= WORK_HISTORY_LIMIT
    && work.versions.every(validWorkVersion)
    && work.versions.some(v => v.id === work.currentVersionId)
    && new Set(work.versions.map(version => version.id)).size === work.versions.length
    && validCompletion(work.completedCells, currentPattern(work))
    && (work.progressVersionId === undefined || typeof work.progressVersionId === "string")
    && (work.progressVersionId === undefined || work.progressVersionId === work.currentVersionId);
}

export function isBeadWorksDocument(value: unknown): value is BeadWorksDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as BeadWorksDocument;
  return document.version === BEAD_WORKS_VERSION
    && typeof document.activeId === "string"
    && Array.isArray(document.works)
    && document.works.length <= 100
    && document.works.every(validBeadWork)
    && new Set(document.works.map(work => work.id)).size === document.works.length
    && (document.inventory === undefined || (document.inventory && Object.keys(document.inventory).length <= 256
      && Object.entries(document.inventory).every(([key, amount]) => key.length <= 160
        && (amount === null || (Number.isInteger(amount) && amount >= 0 && amount <= 100000)))))
    && (document.purgedWorkIds === undefined || Array.isArray(document.purgedWorkIds)
      && document.purgedWorkIds.length <= 10000 && new Set(document.purgedWorkIds).size === document.purgedWorkIds.length
      && document.purgedWorkIds.every(key => typeof key === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(key) && !document.works.some(work => work.id === key)))
    && (document.works.some(isLiveWork) ? document.works.some(w => w.id === document.activeId && isLiveWork(w)) : document.activeId === "");
}

export function createWork(pattern: BeadPattern, title = pattern.title): BeadWork {
  const timestamp = now();
  const version = { id: id(), label: "初始图纸", createdAt: timestamp, pattern: { ...pattern, title } };
  return { id: id(), title, createdAt: timestamp, updatedAt: timestamp, archived: false,
    currentVersionId: version.id, versions: [version], completedCells: [], progressVersionId: version.id };
}

export function migrateLegacyPattern(pattern: BeadPattern): BeadWorksDocument {
  const work = createWork(pattern);
  return { version: BEAD_WORKS_VERSION, activeId: work.id, works: [work], inventory: {} };
}

/** Stable enough for a local stock snapshot and readable in exported data. */
export function materialKey(color: BeadPattern["palette"][number]) {
  return `${color.brand ?? "custom"}:${color.code ?? color.hex.toLowerCase()}`;
}

export function setInventory(
  document: BeadWorksDocument,
  key: string,
  amount: number | null,
): BeadWorksDocument {
  if (amount !== null && (!Number.isInteger(amount) || amount < 0 || amount > 100000)) return document;
  return { ...document, inventory: { ...(document.inventory ?? {}), [key]: amount } };
}

export function activeWork(document: BeadWorksDocument) {
  const work = findActiveWork(document);
  if (!work) throw Error("请先选择或新建一件作品。");
  return work;
}
export const findActiveWork = (document: BeadWorksDocument) => document.works.find(w => w.id === document.activeId && isLiveWork(w)) ?? document.works.find(isLiveWork);

export function currentPattern(work: BeadWork): BeadPattern {
  return work.versions.find(v => v.id === work.currentVersionId)?.pattern ?? work.versions.at(-1)!.pattern;
}

export function savePattern(document: BeadWorksDocument, pattern: BeadPattern, label: string): BeadWorksDocument {
  const work = findActiveWork(document);
  if (!work) return document;
  const nextPattern = { ...pattern, title: work.title };
  // Opening or selecting a work is a view operation, not a new drawing version.
  // Its completion marks must survive remounts, flushing and device restarts.
  if (samePattern(currentPattern(work), nextPattern)) return document;
  const timestamp = now();
  const version = { id: id(), label: label.slice(0, 80), createdAt: timestamp, pattern: nextPattern };
  const impact = patternImpact(currentPattern(work), nextPattern);
  const updated: BeadWork = { ...work, updatedAt: timestamp, currentVersionId: version.id,
    versions: [...snapshotProgress(work), version].slice(-WORK_HISTORY_LIMIT),
    completedCells: impact.progressCompatible ? [...work.completedCells] : [], progressVersionId: version.id };
  return { ...document, works: document.works.map(item => item.id === work.id ? updated : item) };
}

export function renameWork(document: BeadWorksDocument, title: string): BeadWorksDocument {
  const work = activeWork(document);
  const clean = title.trim().slice(0, 80) || "未命名作品";
  const timestamp = now();
  return { ...document, works: document.works.map(item => item.id === work.id
    ? { ...item, title: clean, updatedAt: timestamp, versions: item.versions.map(v => ({ ...v, pattern: { ...v.pattern, title: clean } })) }
    : item) };
}

export function addWork(document: BeadWorksDocument, pattern: BeadPattern, title = "新作品"): BeadWorksDocument {
  if (document.works.length >= 100) throw Error("当前资料库已保存 100 件作品，请先整理作品再新建。");
  const work = createWork({ ...pattern, title }, title);
  return { ...document, activeId: work.id, works: [...document.works, work] };
}

/** A local copy has independent identities, including every saved version. */
export function duplicateWork(document: BeadWorksDocument, workId: string): BeadWorksDocument {
  if (document.works.length >= 100) throw Error("当前资料库已保存 100 件作品，请先整理作品再复制。");
  const source = document.works.find(work => work.id === workId);
  if (!source) return document;
  if (isDeletedWork(source)) throw Error("请先从最近删除恢复这件作品。");
  const title = `${source.title.slice(0, 75)} · 副本`;
  const versionIds = new Map(source.versions.map(version => [version.id, id()]));
  const timestamp = now();
  const copy: BeadWork = { ...source, id: id(), title, archived: false, createdAt: timestamp, updatedAt: timestamp,
    currentVersionId: versionIds.get(source.currentVersionId)!,
    progressVersionId: versionIds.get(source.progressVersionId ?? source.currentVersionId),
    completedCells: [...source.completedCells],
    versions: source.versions.map(version => ({ ...version, id: versionIds.get(version.id)!, completedCells: version.completedCells ? [...version.completedCells] : undefined,
      pattern: structuredClone({ ...version.pattern, title }) })) };
  return { ...document, activeId: copy.id, works: [...document.works, copy] };
}

export function archiveActiveWork(document: BeadWorksDocument): BeadWorksDocument {
  const work = activeWork(document);
  const replacement = document.works.find(item => item.id !== work.id && isLiveWork(item));
  if (!replacement) return document;
  return { ...document, activeId: replacement.id, works: document.works.map(item => item.id === work.id ? { ...item, archived: true } : item) };
}

export function restoreWork(document: BeadWorksDocument, workId: string): BeadWorksDocument {
  const target = document.works.find(work => work.id === workId && !isDeletedWork(work));
  if (!target) return document;
  return {
    ...document,
    activeId: target.id,
    works: document.works.map(work => work.id === workId ? { ...work, archived: false, updatedAt: now() } : work),
  };
}

/** Restore a saved version as a new current version, preserving the old history. */
export function restoreVersion(document: BeadWorksDocument, workId: string, versionId: string): BeadWorksDocument {
  const target = document.works.find(work => work.id === workId && isLiveWork(work));
  const version = target?.versions.find(item => item.id === versionId);
  if (!target || !version || target.currentVersionId === version.id) return document;
  const timestamp = now();
  const completedCells = [...(version.completedCells ?? [])];
  const restored = { ...version, id: id(), label: `恢复：${version.label}`.slice(0, 80), createdAt: timestamp, completedCells };
  return {
    ...document,
    activeId: target.id,
    works: document.works.map(work => work.id === target.id
      ? { ...work, currentVersionId: restored.id, updatedAt: timestamp, versions: [...snapshotProgress(work), restored].slice(-WORK_HISTORY_LIMIT), completedCells, progressVersionId: restored.id }
      : work),
  };
}

function snapshotProgress(work: BeadWork): BeadWorkVersion[] {
  return work.versions.map(version => version.id === work.currentVersionId
    ? { ...version, completedCells: [...work.completedCells] } : version);
}

function material(pattern: BeadPattern, x: number, y: number, colors: string[]) {
  if (x >= pattern.width || y >= pattern.height) return "empty";
  return colors[pattern.cells[y * pattern.width + x]] ?? "empty";
}

export function patternImpact(before: BeadPattern, after: BeadPattern) {
  let changed = 0, cropped = 0;
  const colors = (pattern: BeadPattern) => pattern.palette.map(color => JSON.stringify([color.hex.toLowerCase(), color.brand ?? "", color.code ?? "", color.catalog ?? ""]));
  const beforeColors = colors(before), afterColors = colors(after);
  for (let y = 0; y < Math.max(before.height, after.height); y++) {
    for (let x = 0; x < Math.max(before.width, after.width); x++) {
      const oldColor = material(before, x, y, beforeColors), newColor = material(after, x, y, afterColors);
      if (oldColor !== newColor) changed++;
      if (oldColor !== "empty" && (x >= after.width || y >= after.height)) cropped++;
    }
  }
  return { changed, cropped, progressCompatible: before.width === after.width && before.height === after.height && changed === 0 };
}
