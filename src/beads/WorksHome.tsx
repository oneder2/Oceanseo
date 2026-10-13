import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowRight, Copy, Download, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { currentPattern, isDeletedWork, isLiveWork, type BeadWork } from "./works";
import { counts, physicalSize, formatCm, type BeadPattern } from "./model";
import { useBeadDocument } from "./useBeadDocument";
import { can } from "../modules/capabilities";
import { flushAppData } from "../appDataStore";
import { platform } from "../platform";
import type { BeadSection } from "./BeadModule";
import "./works-home.css";
import TransferDialog from "./TransferDialog";
import DestinationDialog from "./DestinationDialog";
import WorkLifecycleDialog from "./WorkLifecycleDialog";
import type { WorkAction } from "./lifecycle";
import { exportWorksFile, parseTransfer, pendingHandoff, TRANSFER_MAX_BYTES, TRANSFER_NOTICE, type BeadHandoff, type BeadTransferBundle } from "./transfer";
import { profileSessionStorage } from "../profileStorage";

function PatternPreview({ pattern }: { pattern: BeadPattern }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, pattern.width, pattern.height);
    pattern.cells.forEach((color, index) => {
      if (color < 0) return;
      ctx.fillStyle = pattern.palette[color].hex;
      ctx.fillRect(index % pattern.width, Math.floor(index / pattern.width), 1, 1);
    });
  }, [pattern]);
  return <canvas ref={ref} width={pattern.width} height={pattern.height} role="img" aria-label={`${pattern.title}的图纸预览`} />;
}
function workProgress(work: BeadWork) {
  const pattern = currentPattern(work);
  const total = pattern.cells.filter(color => color >= 0).length;
  const completed = (work.progressVersionId ?? work.currentVersionId) === work.currentVersionId
    ? new Set(work.completedCells.filter(index => pattern.cells[index] >= 0)).size : 0;
  return { total, completed, percent: total ? Math.round(completed / total * 100) : 0 };
}

export default function WorksHome({ onNavigate }: { onNavigate: (view: BeadSection) => void }) {
  const controller = useBeadDocument();
  const { works, initialized, loadError, saveStatus } = controller;
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"active" | "archived" | "trash">("active");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const archived = scope === "archived", deleted = scope === "trash";
  const [lifecycle, setLifecycle] = useState<{ workId: string; action: WorkAction } | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [transfer, setTransfer] = useState<BeadTransferBundle | null>(null);
  const [handoff, setHandoff] = useState<BeadHandoff | null>(null);
  const [copyIds, setCopyIds] = useState<string[] | null>(null);
  const [notice, setNotice] = useState(() => profileSessionStorage.getItem(TRANSFER_NOTICE) ?? "");
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { profileSessionStorage.removeItem(TRANSFER_NOTICE); }, []);
  useEffect(() => {
    if (!initialized || !isTauri()) return;
    let active = true;
    void pendingHandoff().then(pending => { if (active) setHandoff(pending); })
      .catch(reason => { if (active) setError(String(reason).replace(/^Error: /, "")); });
    return () => { active = false; };
  }, [initialized]);
  const visible = initialized ? works.works : [];
  const filtered = useMemo(() => visible.filter(work => (deleted ? isDeletedWork(work) : !isDeletedWork(work) && work.archived === archived) && work.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [visible, archived, deleted, query]);
  const current = visible.find(work => work.id === works.activeId && isLiveWork(work));
  const selected = filtered.filter(work => selectedIds.includes(work.id) && !isDeletedWork(work));
  const writable = can("bead-studio", "write") && !loadError;
  function changeScope(next: typeof scope) {
    setScope(next); setSelectedIds([]);
    if (next === "trash") setSelecting(false);
  }
  async function exportFile(workIds: string[]) {
    setOpening(true); setError(""); setNotice("");
    try { if (await exportWorksFile(workIds, works.works)) setNotice(`已导出 ${workIds.length} 件作品。在另一个发行版或目标资料库的作品页面导入即可复制。`); }
    catch (reason) { setError(String(reason).replace(/^Error: /, "")); }
    finally { setOpening(false); }
  }
  async function importFile(file: File) {
    setOpening(true); setError(""); setNotice("");
    try {
      if (file.size > TRANSFER_MAX_BYTES) throw Error("作品文件超过 2 MB，请减少一次导出的作品数量。");
      setTransfer(parseTransfer(await file.text()));
    } catch (reason) { setError(String(reason).replace(/^Error: /, "")); }
    finally { setOpening(false); }
  }
  async function open(workId?: string, view: BeadSection = "editor") {
    if (opening) return;
    setOpening(true); setError("");
    try {
      if (workId) controller.selectWork(workId);
      else if (!controller.createNewWork()) return;
      await flushAppData();
      onNavigate(view);
    } catch { setError("作品尚未保存成功，请重试。原作品和本机副本仍保留。"); }
    finally { setOpening(false); }
  }
  if (loadError) return <section className="works-home" role="alert"><h2>作品暂时无法打开</h2><p>{loadError}</p></section>;
  return <section className="works-home" aria-label="我的拼豆作品" aria-busy={opening}>
    <div className="works-start">
      <div><span className="works-kicker">Oceanseo 拼豆工坊</span><h2>{current ? "接着拼，你的作品还在这里。" : "从一幅喜欢的画面开始。"}</h2>
        <p>{current ? "图纸、豆色和拼放进度，一起留在作品里。" : "新建一件作品，再导入图片或绘制你的第一张图纸。"}</p>
        {!platform.mobile && <button className="primary-button" disabled={!writable || opening} onClick={() => void open()}><Plus size={18}/>新建作品</button>}
        {platform.mobile && <p>手机可导入作品文件、查看图纸并继续拼放；图片转图与精修请在电脑上完成。</p>}
      </div>
      {current && <button className="works-resume" disabled={opening} onClick={() => void open(current.id, "progress")}>
        <span className="works-preview"><PatternPreview pattern={currentPattern(current)}/></span>
        <span className="works-resume-info"><small>当前作品 · {workProgress(current).percent}%</small><strong>{current.title}</strong><span>继续拼放 <ArrowRight size={17}/></span></span>
      </button>}
    </div>
    <div className="works-list-head">
      <div className="works-tabs" role="group" aria-label="作品范围"><button aria-pressed={scope === "active"} onClick={() => changeScope("active")}>进行中的作品</button><button aria-pressed={archived} onClick={() => changeScope("archived")}><Archive size={16}/>已归档</button><button aria-pressed={deleted} onClick={() => changeScope("trash")}><Trash2 size={16}/>最近删除</button></div>
      <label className="works-search"><Search size={18}/><input aria-label="搜索作品" placeholder="搜索作品名称" value={query} onChange={event => { setQuery(event.target.value); setSelectedIds([]); }}/></label>
    </div>
      <div className="works-transfer-tools"><span>可直接复制到其他资料库；跨发行版或设备使用作品文件。</span><div className="works-transfer-buttons">{!deleted && <button className="secondary-button" aria-pressed={selecting} disabled={!isTauri() || opening || !!handoff} onClick={() => { setSelecting(value => !value); setSelectedIds([]); }}>{selecting ? "结束选择" : "批量选择"}</button>}<button className="secondary-button" disabled={!writable || opening || !!handoff} onClick={() => fileInput.current?.click()}><Upload size={16}/>导入作品文件</button></div>
      <input ref={fileInput} type="file" accept=".oceanbeads,.json,application/json,application/octet-stream" aria-label="选择作品文件" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }}/></div>
    {selecting && <div className="works-batch-bar" role="region" aria-label="批量作品操作"><span role="status">已选 {selected.length} 件 · 当前列表 {filtered.length} 件</span><div><button className="secondary-button" disabled={opening || !filtered.length} onClick={() => setSelectedIds(filtered.map(work => work.id))}>全选当前列表</button><button className="secondary-button" disabled={opening || !selected.length} onClick={() => setSelectedIds([])}>清空选择</button><button className="secondary-button" disabled={opening || !selected.length} onClick={() => void exportFile(selected.map(work => work.id))}><Download size={16}/>导出所选</button><button className="primary-button" disabled={opening || !selected.length || !!handoff} onClick={() => setCopyIds(selected.map(work => work.id))}><ArrowRight size={16}/>复制所选到其他资料库</button></div><small>只操作当前列表中勾选的作品，源作品保留。切换列表或搜索会清空选择；归档作品也可以复制。</small></div>}
    {deleted && <p className="works-trash-help">作品在这里保留，直到你确认彻底删除；期间可恢复图纸、版本和拼放记录。不会自动清理。</p>}
    {!filtered.length && <div className="works-empty"><h3>{query ? "没有找到这件作品" : deleted ? "最近删除为空" : archived ? "还没有归档的作品" : "这里会保存你的每一件作品"}</h3><p>{query ? "试试其他名称，或清空搜索。" : deleted ? "被移走的作品会显示在这里，方便恢复或确认清理。" : archived ? "归档会保留图纸和版本，随时可以恢复。" : "作品保存后，可以回到这里查看图纸或继续拼放。"}</p></div>}
    <div className="works-grid">{filtered.map(work => {
      const pattern = currentPattern(work), progress = workProgress(work), size = physicalSize(pattern);
      return <article className={`work-card${selecting && selectedIds.includes(work.id) ? " is-selected" : ""}`} data-work-id={work.id} key={work.id}>
        <div className="work-card-art"><PatternPreview pattern={pattern}/>{work.id === works.activeId && !archived && <span>当前作品</span>}</div>
        <div className="work-card-body">{selecting && <label className="work-select"><input type="checkbox" aria-label={`选择作品：${work.title}`} checked={selectedIds.includes(work.id)} disabled={opening} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, work.id] : ids.filter(id => id !== work.id))}/>选择这件作品</label>}<h3>{work.title}</h3><p>{pattern.width} × {pattern.height} 格 · {counts(pattern).filter(count => count > 0).length} 色 · {progress.total} 颗</p>
          <p className="work-size">画布约 {formatCm(size.canvas.width)} × {formatCm(size.canvas.height)} cm</p>
          {deleted && <p>移到最近删除：{new Date(work.deletedAt!).toLocaleDateString()}</p>}
          <div className="work-completion"><progress max={Math.max(1, progress.total)} value={progress.completed} aria-label={`${work.title}的拼放完成度`}/><span>{progress.completed}/{progress.total} 颗</span></div>
          {!selecting && <div className="work-card-actions">{deleted ? <>
            <button className="secondary-button" disabled={!isTauri() || !writable || opening} onClick={() => setLifecycle({ workId: work.id, action: "restore" })}>恢复作品</button>
            <button className="bead-purge-button" disabled={!isTauri() || !writable || opening} onClick={() => setLifecycle({ workId: work.id, action: "purge" })}><Trash2 size={16}/>彻底删除</button>
          </> : <>{archived ? <button className="secondary-button" disabled={!writable || opening} onClick={() => controller.restoreArchivedWork(work.id)}>恢复作品</button> : <>
            <button className="primary-button" disabled={opening} onClick={() => void open(work.id, "progress")}>继续拼放 <ArrowRight size={16}/></button>
            {!platform.mobile && <button className="secondary-button" disabled={opening} onClick={() => void open(work.id)}><Pencil size={16}/>打开图纸</button>}
          </>}
          <button className="work-copy" disabled={!writable || opening} onClick={() => controller.duplicateSavedWork(work.id)} aria-label={`复制作品：${work.title}`} title="复制作品"><Copy size={18}/></button>
          <button className="secondary-button work-transfer" disabled={!isTauri() || opening} onClick={() => setCopyIds([work.id])}><ArrowRight size={16}/>复制到其他资料库</button>
          <button className="work-copy work-export" disabled={opening} onClick={() => void exportFile([work.id])} aria-label={`导出作品文件：${work.title}`} title="导出可编辑作品文件"><Download size={18}/></button>
          <button className="work-copy work-delete" disabled={!isTauri() || !writable || opening} onClick={() => setLifecycle({ workId: work.id, action: "trash" })} aria-label={`移到最近删除：${work.title}`} title="移到最近删除"><Trash2 size={18}/></button>
          </>}</div>}
        </div>
      </article>;
    })}</div>
    <footer className="works-save"><span role="status">{saveStatus}</span><span>{visible.length} / 100 件作品{visible.some(isDeletedWork) && "（含最近删除）"}</span></footer>
    {error && <p role="alert">{error}</p>}
    {notice && <p className="works-transfer-notice" role="status">{notice}</p>}
    {transfer && <TransferDialog bundle={transfer} onClose={() => setTransfer(null)}/>}
    {handoff && <TransferDialog bundle={handoff.bundle} handoff={handoff} onClose={() => setHandoff(null)}/>}
    {copyIds && <DestinationDialog workIds={copyIds} onClose={() => setCopyIds(null)}/>}
    {lifecycle && <WorkLifecycleDialog {...lifecycle} onClose={() => setLifecycle(null)}/>}
  </section>;
}
