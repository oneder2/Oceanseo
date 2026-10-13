import { useEffect, useRef, useState } from "react";
import { RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import { topDialog, useFocusScope } from "../useFocusScope";
import { can } from "../modules/capabilities";
import { currentPattern } from "./works";
import { commitLifecycle, previewLifecycle, type WorkAction, type WorkPreview } from "./lifecycle";

export default function WorkLifecycleDialog({ workId, action, onClose }: { workId: string; action: WorkAction; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<WorkPreview | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const mounted = useRef(true);
  useFocusScope(true, ref, "[data-dialog-initial]:not(:disabled)");
  const title = action === "trash" ? "移到最近删除" : action === "restore" ? "恢复作品" : "彻底删除作品";
  async function refresh() {
    setBusy(true); setError(""); setPreview(null);
    try { const value = await previewLifecycle(workId, action); if (mounted.current) setPreview(value); }
    catch (reason) { if (mounted.current) setError(String(reason).replace(/^Error: /, "")); }
    finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, [workId, action]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy && topDialog() === ref.current) { event.preventDefault(); event.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", escape); return () => document.removeEventListener("keydown", escape);
  }, [busy, onClose]);
  async function confirm() {
    if (!preview || busy) return;
    setBusy(true); setError("");
    try { await commitLifecycle(preview); }
    catch (reason) { setError(String(reason).replace(/^Error: /, "")); setPreview(null); setBusy(false); }
  }
  return <div className="modal-backdrop bead-transfer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={ref} tabIndex={-1} className="modal bead-transfer-dialog bead-lifecycle-dialog" role="dialog" aria-modal="true" aria-labelledby="bead-lifecycle-title" aria-busy={busy}>
      <header><div><span className="works-kicker">作品管理</span><h2 id="bead-lifecycle-title">{title}</h2></div><button className="icon-button" disabled={busy} aria-label="关闭作品管理" onClick={onClose}><X size={20}/></button></header>
      {preview && <div className="bead-lifecycle-work"><strong>{preview.work.title}</strong><span>{currentPattern(preview.work).width} × {currentPattern(preview.work).height} 格 · {preview.work.versions.length} 个版本 · 完成 {preview.work.completedCells.length} 颗</span></div>}
      <p>{action === "trash" ? "图纸、历史版本和拼放记录会完整保留。作品会从进行中或已归档列表移走，可以在“最近删除”恢复。"
        : action === "restore" ? `将作品恢复到${preview?.work.deletedFromArchive ? "已归档列表" : "进行中的作品"}，保留原图纸、版本和完成记录。`
        : "清理后无法从“最近删除”恢复。删除前会保存安全备份，已有备份仍可能包含这件作品；此操作不删除历史备份。"}</p>
      {action === "trash" && <p className="bead-destination-help">最近删除不会自动清理，恢复期持续到你确认彻底删除为止。归档用于暂时收起作品；最近删除用于准备清理。</p>}
      {busy && <p role="status">正在核对已保存的作品…</p>}
      {error && <p className="bead-transfer-error" role="alert">{error}</p>}
      <footer><button className="secondary-button" data-dialog-initial disabled={busy} onClick={onClose}>取消</button>{!preview && !busy && <button className="secondary-button" onClick={() => void refresh()}><RefreshCw size={16}/>重新核对</button>}
        <button className={action === "purge" ? "bead-purge-button" : "primary-button"} disabled={busy || !preview || !can("bead-studio", "write")} onClick={() => void confirm()}>{action === "restore" ? <RotateCcw size={16}/> : <Trash2 size={16}/>} {busy ? "正在处理…" : title}</button></footer>
    </section>
  </div>;
}
