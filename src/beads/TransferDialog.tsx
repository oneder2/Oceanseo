import { useEffect, useRef, useState } from "react";
import { Copy, RefreshCw, X } from "lucide-react";
import { profileStatus, type LocalProfile } from "../accountStore";
import { useFocusScope, topDialog } from "../useFocusScope";
import { currentPattern } from "./works";
import { counts, formatCm, physicalSize } from "./model";
import { cancelHandoff, copyHandoff, copyWorksFile, previewWorksFile, profileLabel, type BeadHandoff, type BeadTransferBundle, type BeadTransferPreview } from "./transfer";
import { can } from "../modules/capabilities";

export default function TransferDialog({ bundle, handoff, onClose }: { bundle: BeadTransferBundle; handoff?: BeadHandoff; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<BeadTransferPreview | null>(null);
  const [target, setTarget] = useState<LocalProfile | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useFocusScope(true, ref);
  async function dismiss() {
    if (busy) return;
    if (!handoff) { onClose(); return; }
    setBusy(true); setError("");
    try { await cancelHandoff(handoff); onClose(); }
    catch (reason) { setError(String(reason).replace(/^Error: /, "")); setBusy(false); }
  }
  async function refresh() {
    setBusy(true); setError(""); setPreview(null);
    try {
      const [next, status] = await Promise.all([previewWorksFile(bundle), profileStatus()]);
      if (mounted.current) { setPreview(next); setTarget(status.current); }
    } catch (reason) { if (mounted.current) setError(String(reason).replace(/^Error: /, "")); }
    finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && topDialog() === ref.current) { event.preventDefault(); event.stopPropagation(); void dismiss(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, onClose]);
  async function confirm() {
    if (!preview || busy) return;
    setBusy(true); setError("");
    try { if (handoff) await copyHandoff(handoff, preview); else await copyWorksFile(bundle, preview); }
    catch (reason) { setError(String(reason).replace(/^Error: /, "")); setPreview(null); setBusy(false); }
  }
  const destination = target ? profileLabel(target) : "正在确认当前资料库…";
  return <div className="modal-backdrop bead-transfer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) void dismiss(); }}>
    <section ref={ref} tabIndex={-1} className="modal bead-transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="bead-transfer-title" aria-busy={busy}>
      <header><div><span className="works-kicker">{handoff ? "待复制作品" : "作品文件"} · {bundle.works.length} 件</span><h2 id="bead-transfer-title">复制到当前资料库</h2></div>
        <button className="icon-button" aria-label="关闭作品复制" disabled={busy} onClick={() => void dismiss()}><X size={20}/></button></header>
      <div className="bead-transfer-route"><span>来源<strong>{bundle.sourceLabel}</strong></span><Copy size={20}/><span>目标<strong>{destination}</strong></span></div>
      <p>源作品保持完整。复制图纸、历史版本和拼放进度，作为独立作品保存。</p>
      <ul className="bead-transfer-items">{bundle.works.map(work => {
        const pattern = currentPattern(work), size = physicalSize(pattern);
        return <li key={work.id}><strong>{work.title}</strong><span>{pattern.width} × {pattern.height} 格 · {counts(pattern).filter(count => count > 0).length} 色 · {work.versions.length} 个版本</span><small>约 {formatCm(size.canvas.width)} × {formatCm(size.canvas.height)} cm · 完成 {new Set(work.completedCells).size} 颗</small></li>;
      })}</ul>
      <p className="bead-transfer-summary" role="status">{preview ? preview.alreadyCopied ? "此作品文件已在当前资料库复制过，再次确认不会重复添加。" : `当前已有 ${preview.existingCount} 件，复制后共 ${preview.existingCount + preview.incomingCount} / 100 件作品。` : busy ? "正在校验图纸、品牌色号和目标资料库…" : "请重新预览，核对目标的最新情况。"}</p>
      {error && <p role="alert" className="bead-transfer-error">{error}</p>}
      {!can("bead-studio", "write") && <p role="alert">当前资料库为只读，暂时无法复制。原作品仍保留{handoff ? "在来源资料库中" : "在文件中"}。</p>}
      <footer><button className="secondary-button" disabled={busy} onClick={() => void dismiss()}>取消</button>
        {!preview && !busy && <button className="secondary-button" onClick={() => void refresh()}><RefreshCw size={16}/>重新预览</button>}
        <button className="primary-button" disabled={busy || !preview || !can("bead-studio", "write")} onClick={() => void confirm()}><Copy size={16}/>{busy ? "正在处理…" : preview?.alreadyCopied ? "确认已复制" : "确认复制"}</button></footer>
    </section>
  </div>;
}
