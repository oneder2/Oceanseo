import { profileLocalStorage as localStorage, profileSessionStorage as sessionStorage } from "../profileStorage";
import { useEffect, useReducer, useRef, useState } from "react";
import { APP_STATE_KEYS, persistAppState, registerStateFlusher } from "../appDataStore";
import { blankPattern, isPattern } from "./model";
import { createDocument, documentReducer, samePattern } from "./document";
import type { DocumentAction } from "./document";
import { activeWork, addWork, archiveActiveWork, currentPattern, duplicateWork, findActiveWork, isBeadWorksDocument, isLiveWork, migrateLegacyPattern, patternImpact, renameWork, restoreVersion, restoreWork, savePattern, setInventory, type BeadWorksDocument } from "./works";
import { can } from "../modules/capabilities";

const SELECTED_WORK = "oceanseo.bead-view-selection.v1";

function loadStored(): { document: ReturnType<typeof createDocument>; works: BeadWorksDocument; fresh: boolean; loadError?: string } {
  try {
    const rawWorks: unknown = JSON.parse(localStorage.getItem(APP_STATE_KEYS.beadWorks) ?? "null");
    if (isBeadWorksDocument(rawWorks)) {
      const selection = sessionStorage.getItem(SELECTED_WORK);
      if (rawWorks.works.some(work => work.id === selection && isLiveWork(work))) rawWorks.activeId = selection!;
      const work = findActiveWork(rawWorks);
      return { document: createDocument(work ? currentPattern(work) : blankPattern()), works: rawWorks, fresh: false };
    }
    if (rawWorks !== null) throw new Error("invalid_bead_works");
    const legacy: unknown = JSON.parse(localStorage.getItem(APP_STATE_KEYS.beads) ?? "null");
    if (legacy !== null && !isPattern(legacy)) throw new Error("invalid_legacy_bead_pattern");
    const pattern = isPattern(legacy) ? legacy : blankPattern();
    return { document: createDocument(pattern), works: migrateLegacyPattern(pattern), fresh: !isPattern(legacy) };
  } catch {
    const pattern = blankPattern();
    return { document: createDocument(pattern), works: migrateLegacyPattern(pattern), fresh: true,
      loadError: "作品记录读取失败，原资料仍保留。请在偏好设置中导出备份，并恢复有效的作品记录。" };
  }
}
export function useBeadDocument() {
  const [initial] = useState(loadStored);
  const [state, rawDispatch] = useReducer(
    documentReducer,
    undefined,
    () => initial.document,
  );
  const works = useRef(initial.works);
  const initialized = useRef(!initial.fresh);
  const [activeWorkId, setActiveWorkId] = useState(initial.works.activeId);
  const [, refreshProgress] = useState(0);
  const [saveStatus, setSaveStatus] = useState(() => initial.loadError ?? (can("bead-studio", "write")
    ? initial.fresh ? "开始创作后自动保存" : "已保存到本机"
    : "当前作品为只读，原数据仍保留"));
  const latest = useRef(state.present);
  const editLabel = useRef("编辑图纸");
  const pendingAction = useRef<DocumentAction | null>(null);
  const pendingVersion = useRef<{ workId: string; currentId: string; versionId: string } | null>(null);
  latest.current = state.present;
  function mayWrite() {
    if (initial.loadError) { setSaveStatus(initial.loadError); return false; }
    if (can("bead-studio", "write")) return true;
    setSaveStatus("当前作品为只读，原数据仍保留");
    return false;
  }
  function persistCurrent() {
    if (initial.loadError || !initialized.current || !can("bead-studio", "write")) return Promise.resolve();
    return Promise.all([
      findActiveWork(works.current) ? persistAppState(APP_STATE_KEYS.beads, latest.current) : Promise.resolve(),
      persistAppState(APP_STATE_KEYS.beadWorks, works.current),
    ]).then(() => undefined);
  }
  useEffect(() => {
    let active = true;
    if (initial.loadError) { setSaveStatus(initial.loadError); return; }
    if (!can("bead-studio", "write")) return;
    const next = savePattern(works.current, state.present, editLabel.current);
    // A fresh device's placeholder must not become a cloud work or conflict
    // with real works downloaded during its first automatic connection.
    if (!initialized.current && next === works.current) {
      setSaveStatus("开始创作后自动保存");
      return;
    }
    initialized.current = true;
    setSaveStatus("正在保存…");
    works.current = next;
    void persistCurrent().then(() => {
          if (active) setSaveStatus("已保存到本机");
        })
        .catch(() => {
          if (active) setSaveStatus("保存失败，本地副本已保留");
        });
    return () => {
      active = false;
    };
  }, [state.present]);
  useEffect(() => registerStateFlusher(persistCurrent), []);
  useEffect(
    () => () => {
      void persistCurrent().catch(() => undefined);
    },
    [],
  );
  function dispatch(action: DocumentAction): boolean {
    if (initial.loadError) { setSaveStatus(initial.loadError); return false; }
    if (action.type !== "discard" && !can("bead-studio", "write")) { setSaveStatus("当前图纸为只读，原数据仍保留"); return false; }
    if (action.type === "discard") { pendingAction.current = null; pendingVersion.current = null; rawDispatch(action); return true; }
    if (action.type === "apply" && pendingVersion.current) {
      const pending = pendingVersion.current;
      const work = findActiveWork(works.current);
      if (!work || work.id !== pending.workId || work.currentVersionId !== pending.currentId) { setSaveStatus("作品已变化，请取消预览后重新选择版本。"); return false; }
      const next = restoreVersion(works.current, work.id, pending.versionId);
      pendingVersion.current = null;
      works.current = next;
      latest.current = currentPattern(activeWork(next));
      rawDispatch({ type: "replace", present: latest.current });
      return true;
    }
    if (action.type === "apply" && pendingAction.current) {
      const pending = pendingAction.current; pendingAction.current = null;
      rawDispatch({ type: "discard" }); rawDispatch(pending); return true;
    }
    if (action.type === "apply" && state.proposal && !findActiveWork(works.current)) {
      const proposal = state.proposal;
      if (!createNewWork()) return false;
      editLabel.current = proposal.label;
      rawDispatch({ type: "commit", label: proposal.label, after: proposal.after });
      return true;
    }
    if (["commit", "undo", "redo"].includes(action.type) && !state.proposal) {
      const next = documentReducer(state, action);
      const work = findActiveWork(works.current);
      editLabel.current = action.type === "commit" ? action.label : action.type === "undo" ? "撤销编辑" : "重做编辑";
      if (work?.completedCells.length && !samePattern(state.present, next.present) && !patternImpact(state.present, next.present).progressCompatible) {
        pendingAction.current = action;
        rawDispatch({ type: "propose", proposal: { label: editLabel.current, after: next.present,
          message: "这件作品已有拼放记录。确认修改前，请核对图纸和进度的变化。" } });
        return true;
      }
      if (!work && next.present !== state.present && !createNewWork()) return false;
    }
    if (action.type === "apply") editLabel.current = state.proposal?.label ?? "编辑图纸";
    rawDispatch(action);
    return true;
  }
  function selectWork(workId: string) {
    const work = works.current.works.find(item => item.id === workId && isLiveWork(item));
    if (!work || work.id === works.current.activeId) return;
    works.current = { ...works.current, activeId: work.id };
    // Navigation is allowed even when the document is read-only. Keep the
    // display selection in this profile's renderer, without a business write.
    sessionStorage.setItem(SELECTED_WORK, work.id);
    latest.current = currentPattern(work);
    setActiveWorkId(work.id);
    rawDispatch({ type: "replace", present: currentPattern(work) });
  }
  function createNewWork() {
    if (!mayWrite()) return;
    if (initialized.current && works.current.works.length >= 100) { setSaveStatus("当前资料库已保存 100 件作品，请先整理作品再新建。"); return false; }
    const next = initialized.current ? addWork(works.current, blankPattern(), "新作品") : migrateLegacyPattern({ ...blankPattern(), title: "新作品" });
    initialized.current = true;
    works.current = next;
    sessionStorage.setItem(SELECTED_WORK, next.activeId);
    setActiveWorkId(works.current.activeId);
    latest.current = currentPattern(activeWork(works.current));
    rawDispatch({ type: "replace", present: currentPattern(activeWork(works.current)) });
    return true;
  }
  function duplicateSavedWork(workId: string) {
    if (!mayWrite()) return false;
    try { works.current = duplicateWork(works.current, workId); }
    catch (error) { setSaveStatus(error instanceof Error ? error.message : "复制未完成，原作品仍保留"); return false; }
    initialized.current = true;
    sessionStorage.setItem(SELECTED_WORK, works.current.activeId);
    setActiveWorkId(works.current.activeId);
    latest.current = currentPattern(activeWork(works.current));
    rawDispatch({ type: "replace", present: latest.current });
    return true;
  }
  function renameActiveWork(title: string) {
    if (!mayWrite()) return;
    if (!findActiveWork(works.current)) { setSaveStatus("请先新建或恢复一件作品。"); return; }
    initialized.current = true;
    works.current = renameWork(works.current, title);
    const work = activeWork(works.current);
    latest.current = currentPattern(work);
    rawDispatch({ type: "replace", present: currentPattern(work) });
  }
  function archiveCurrentWork() {
    if (!mayWrite()) return false;
    if (!findActiveWork(works.current)) return false;
    const next = archiveActiveWork(works.current);
    if (next === works.current) return false;
    works.current = next;
    sessionStorage.setItem(SELECTED_WORK, next.activeId);
    setActiveWorkId(next.activeId);
    latest.current = currentPattern(activeWork(next));
    rawDispatch({ type: "replace", present: currentPattern(activeWork(next)) });
    return true;
  }
  function restoreArchivedWork(workId: string) {
    if (!mayWrite()) return;
    const next = restoreWork(works.current, workId);
    works.current = next;
    sessionStorage.setItem(SELECTED_WORK, next.activeId);
    setActiveWorkId(next.activeId);
    latest.current = currentPattern(activeWork(next));
    rawDispatch({ type: "replace", present: currentPattern(activeWork(next)) });
  }
  function restoreSavedVersion(versionId: string) {
    if (!mayWrite()) return false;
    const work = findActiveWork(works.current), version = work?.versions.find(item => item.id === versionId);
    if (!work || !version || work.currentVersionId === version.id || state.proposal) return false;
    pendingVersion.current = { workId: work.id, currentId: work.currentVersionId, versionId };
    rawDispatch({ type: "propose", proposal: { label: `恢复：${version.label}`.slice(0, 80), after: version.pattern, allowUnchanged: true,
      message: (version.completedCells === undefined ? "这个旧版本没有保存完成标记，恢复后从零记录拼放进度。" : `恢复后会另存一个当前版本，带回当时记录的 ${version.completedCells.length} 颗拼放标记。`)
        + "当前图纸和进度也会保存到版本记录。" } });
    return false;
  }
  function toggleProgress(index: number) {
    if (initial.loadError) { setSaveStatus(initial.loadError); return; }
    if (!can("bead-studio", "write")) {
      setSaveStatus("当前作品为只读，原进度仍保留");
      return;
    }
    const work = findActiveWork(works.current);
    if (!work) return;
    if (index < 0 || index >= state.present.cells.length || state.present.cells[index] < 0) return;
    const cells = new Set((work.progressVersionId ?? work.currentVersionId) === work.currentVersionId ? work.completedCells : []);
    if (cells.has(index)) cells.delete(index); else cells.add(index);
    works.current = { ...works.current, works: works.current.works.map(item => item.id === work.id
      ? { ...item, completedCells: [...cells].sort((a, b) => a - b), progressVersionId: work.currentVersionId, updatedAt: nowIso() }
      : item) };
    refreshProgress(value => value + 1);
    setSaveStatus("正在保存…");
    void persistAppState(APP_STATE_KEYS.beadWorks, works.current)
      .then(() => setSaveStatus("已保存到本机"))
      .catch(() => setSaveStatus("保存失败，本地副本已保留"));
  }
  function clearProgress() {
    if (initial.loadError) { setSaveStatus(initial.loadError); return; }
    if (!can("bead-studio", "write")) {
      setSaveStatus("当前作品为只读，原进度仍保留");
      return;
    }
    const work = findActiveWork(works.current);
    if (!work) return;
    works.current = { ...works.current, works: works.current.works.map(item => item.id === work.id
      ? { ...item, completedCells: [], progressVersionId: work.currentVersionId, updatedAt: nowIso() }
      : item) };
    refreshProgress(value => value + 1);
    setSaveStatus("正在保存…");
    void persistAppState(APP_STATE_KEYS.beadWorks, works.current)
      .then(() => setSaveStatus("已保存到本机"))
      .catch(() => setSaveStatus("保存失败，本地副本已保留"));
  }
  function updateInventory(key: string, amount: number | null) {
    if (!mayWrite()) return false;
    const next = setInventory(works.current, key, amount);
    if (next === works.current) return false;
    works.current = next;
    refreshProgress(value => value + 1);
    setSaveStatus("正在保存…");
    void persistAppState(APP_STATE_KEYS.beadWorks, works.current)
      .then(() => setSaveStatus("已保存到本机"))
      .catch(() => setSaveStatus("保存失败，本地副本已保留"));
    return true;
  }
  const restoreProgress = pendingVersion.current ? findActiveWork(works.current)?.versions.find(version => version.id === pendingVersion.current?.versionId)?.completedCells?.length ?? 0 : undefined;
  return { state, dispatch, restoreProgress, saveStatus, loadError: initial.loadError, initialized: initialized.current, works: works.current, activeWorkId, selectWork, createNewWork, duplicateSavedWork, renameActiveWork, archiveCurrentWork, restoreArchivedWork, restoreSavedVersion, toggleProgress, clearProgress, updateInventory };
}

function nowIso() { return new Date().toISOString(); }
