import { useEffect, useRef, useState } from "react";
import { ArrowRight, RefreshCw, X } from "lucide-react";
import { localProfiles, profileStatus, type LocalProfile } from "../accountStore";
import { topDialog, useFocusScope } from "../useFocusScope";
import { openCopyDestination, profileLabel } from "./transfer";

export default function DestinationDialog({ workIds, onClose }: { workIds: string[]; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const [targets, setTargets] = useState<LocalProfile[]>([]);
  const [source, setSource] = useState<LocalProfile | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useFocusScope(true, ref);
  async function load() {
    setBusy(true); setError("");
    try {
      const [profiles, status] = await Promise.all([localProfiles(), profileStatus()]);
      if (mounted.current) {
        const next = profiles.filter(profile => profile.key !== status.current.key);
        setSource(status.current); setTargets(next);
        setSelected(previous => next.some(profile => profile.key === previous) ? previous : "");
      }
    } catch (reason) { if (mounted.current) setError(String(reason).replace(/^Error: /, "")); }
    finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && topDialog() === ref.current) { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, onClose]);
  async function confirm() {
    if (busy || !selected || !source) return;
    setBusy(true); setError("");
    try { await openCopyDestination(selected, source.key, workIds); }
    catch (reason) { setError(String(reason).replace(/^Error: /, "")); setBusy(false); }
  }
  return <div className="modal-backdrop bead-transfer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={ref} tabIndex={-1} className="modal bead-transfer-dialog bead-destination-dialog" role="dialog" aria-modal="true" aria-labelledby="bead-destination-title" aria-busy={busy}>
      <header><div><span className="works-kicker">复制作品 · {workIds.length} 件</span><h2 id="bead-destination-title">选择目标资料库</h2></div><button className="icon-button" disabled={busy} aria-label="关闭目标选择" onClick={onClose}><X size={20}/></button></header>
      <p>来源：{source ? profileLabel(source) : "正在读取…"}</p>
      <p>先保存并打开目标，再核对图纸和进度，确认后复制。源作品会保留。</p>
      <fieldset className="bead-destinations" disabled={busy}><legend>复制到哪里</legend>{targets.map(target => {
        const available = target.key === "local" || target.signedIn;
        return <label key={target.key} className={selected === target.key ? "is-selected" : ""}>
          <input type="radio" name="bead-destination" value={target.key} checked={selected === target.key} disabled={!available} onChange={() => setSelected(target.key)}/>
          <span><strong>{profileLabel(target)}</strong><small>{!available ? "需要重新登录" : target.endpoint ? `${new URL(target.endpoint).host}${target.workspace ? " · 图纸和进度可自动同步" : " · 作品仅保存在本机"}` : "离线保存，作品不会上传"}</small></span>
        </label>;
      })}</fieldset>
      {!busy && !targets.some(target => target.key === "local" || target.signedIn) && <p>还没有可用的目标。关闭此窗口，在“我的账号”登录并打开目标账号或空间，再回来复制。</p>}
      <p className="bead-destination-help">这里显示在当前安装中打开过的资料库。复制到另一个发行版或设备，请使用作品文件导出与导入。</p>
      {error && <p className="bead-transfer-error" role="alert">{error}</p>}
      <footer><button className="secondary-button" disabled={busy} onClick={onClose}>取消</button>{error && <button className="secondary-button" disabled={busy} onClick={() => void load()}><RefreshCw size={16}/>刷新列表</button>}<button className="primary-button" disabled={busy || !selected || !source} onClick={() => void confirm()}>{busy ? "正在处理…" : "保存并打开目标"}<ArrowRight size={16}/></button></footer>
    </section>
  </div>;
}
