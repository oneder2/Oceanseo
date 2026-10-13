import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Archive, Check, ChevronDown, CircleCheck, Home, ListTodo, Plus, Settings2, Sun, X } from "lucide-react";
import ToolActions from "./ToolActions";
import { registeredNavigation } from "../modules/catalog";
import { viewAvailable } from "../platform";
import { flushAppData } from "../appDataStore";
import { useFocusScope } from "../useFocusScope";
import type { View } from "../types";
import { activeWorkspace, personalSnapshot, refreshPersonal, savePersonal, subscribePersonal } from "./runtime";
import { styles, type PersonalWorkspace, type WorkspaceStyle } from "./model";
import PageLoadBoundary from "../PageLoadBoundary";
import { toolIcons } from "./toolIcons";
import "./workspaces.css";

const ToolLibrary = lazy(() => import("./ToolLibrary"));
export default function WorkspaceControls({ view, onNavigate }: { view: View; onNavigate: (view: View) => void }) {
  const doc = useSyncExternalStore(subscribePersonal, personalSnapshot)!;
  const workspace = activeWorkspace()!;
  const [picker, setPicker] = useState(false);
  const [panel, setPanel] = useState<"create" | "manage" | "tools" | null>(null);
  const [name, setName] = useState("");
  const [style, setStyle] = useState<WorkspaceStyle>("neutral");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pickerId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const [pickerPosition, setPickerPosition] = useState<CSSProperties>({});
  const ref = useRef<HTMLElement>(null);
  useFocusScope(!!panel, ref);
  useLayoutEffect(() => {
    if (!picker) return;
    function position() {
      const box = trigger.current!.getBoundingClientRect();
      const width = Math.min(Math.max(box.width + 28, 264), window.innerWidth - 24);
      const top = Math.max(12, Math.min(box.bottom + 8, window.innerHeight - 170));
      setPickerPosition({ left: Math.max(12, Math.min(box.left, window.innerWidth - width - 12)), top, width, maxHeight: window.innerHeight - top - 12 });
    }
    position();
    options.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(trigger.current!);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [picker]);
  useEffect(() => {
    if (!picker) return;
    const outside = (event: PointerEvent | FocusEvent) => {
      if (!options.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPicker(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); };
  }, [picker]);
  async function commit(workspaces: PersonalWorkspace[], activeId = doc.activeId) {
    setBusy(true); setError("");
    try {
      await flushAppData();
      await refreshPersonal();
      const latest = personalSnapshot()!;
      if (JSON.stringify(latest.workspaces) !== JSON.stringify(doc.workspaces)) throw Error("工作区设置已变化，请关闭面板后重新操作");
      await savePersonal({ ...latest, workspaces, activeId });
      setBusy(false); setPicker(false); setPanel(null);
    } catch (e) { setError(String(e)); setBusy(false); }
  }
  function open(panel: "create" | "manage" | "tools") {
    setName(panel === "manage" ? workspace.name : ""); setStyle(panel === "manage" ? workspace.style : "neutral");
    setError(""); setConfirmDelete(false); setPicker(false); setPanel(panel);
  }
  function changeWorkspace(next: PersonalWorkspace) { return commit(doc.workspaces.map(w => w.id === next.id ? next : w)); }
  const navigation = registeredNavigation().flatMap(g => g.items).filter(item => !["overview", "tasks"].includes(item.module) && viewAvailable(item.view));
  return <>
    <div className="scene-picker">
      <span className="scene-eyebrow">MY WORKSPACES</span>
      <button ref={trigger} className="scene-current" type="button" aria-expanded={picker} aria-haspopup="dialog" aria-controls={picker ? pickerId : undefined} disabled={busy} onClick={() => setPicker(!picker)} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setPicker(true); } }}>
        <span className="scene-emblem">{workspace.main ? <Home size={19}/> : workspace.name.slice(0, 1)}</span>
        <span><strong>{workspace.name}</strong><small>{workspace.main ? "主页 · 总体待办" : "场景工具 · 共享资料"}</small></span><ChevronDown size={16}/>
      </button>
      {picker && createPortal(<div className="scene-options" ref={options} id={pickerId} role="dialog" aria-label="切换工作区" style={pickerPosition} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); setPicker(false); trigger.current?.focus(); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(options.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }}>
        <div className="scene-options-head"><span>切换工作区</span><small>{doc.workspaces.filter(w => !w.deleted).length} 个场景</small></div>
        {doc.workspaces.filter(w => !w.deleted).map(w => <button type="button" key={w.id} disabled={busy} aria-label={`${w.name}${w.main ? " · 主工作区" : ""}`} aria-pressed={w.id === workspace.id} onClick={() => {
          if (w.id === workspace.id) { setPicker(false); trigger.current?.focus(); }
          else void commit(doc.workspaces, w.id);
        }}>
          <span className="scene-option-emblem" data-style={w.style}>{w.main ? <Home size={16}/> : w.name.slice(0,1)}</span>
          <span className="scene-option-copy"><strong>{w.name}</strong><small>{w.main ? "主工作区 · 所有任务" : `${w.tools.filter(t => !t.archived).length} 个工具 · 共享资料`}</small></span>
          {w.id === workspace.id && <Check size={16}/>}</button>)}
        <button className="scene-option-create" type="button" onClick={() => open("create")}><Plus size={16}/>新增工作区</button>
      </div>, document.body)}
      <button className="scene-manage" type="button" onClick={() => open("manage")}><Settings2 size={14}/>工作区设置</button>
      {error && !panel && <p role="alert">{error}</p>}
    </div>
    <section className="scene-navigation" aria-label="共享任务">
      <h2>通用 <span>所有工作区共享</span></h2>
      {workspace.main && <button type="button" className={view === "overview" ? "active" : ""} aria-current={view === "overview" ? "page" : undefined} onClick={() => onNavigate("overview")}><Home size={17}/>主页</button>}
      {([ ["today", "今天", Sun], ["all", "所有待办", ListTodo], ["completed", "完成记录", CircleCheck] ] as const).map(([id, label, Icon]) => <button type="button" key={id} className={view === id ? "active" : ""} aria-current={view === id ? "page" : undefined} onClick={() => onNavigate(id)}><Icon size={17}/>{label}</button>)}
    </section>
    <section className="scene-navigation" aria-label="当前工作区工具">
      <h2>工作区工具 <span>{workspace.tools.filter(t => !t.archived).length}</span></h2>
      {navigation.map(item => { const Icon = toolIcons[item.module] ?? Archive; return <div className="scene-tool-row" key={item.view}>
        <button type="button" className={view === item.view ? "active" : ""} aria-current={view === item.view ? "page" : undefined} onClick={() => onNavigate(item.view)}><Icon size={17}/><span>{item.label}</span></button>
        <ToolActions module={item.module} label={item.label} workspace={workspace} workspaces={doc.workspaces} busy={busy} onRemove={() => changeWorkspace({ ...workspace, tools: workspace.tools.map(t => t.module === item.module ? { ...t, archived: true } : t) })}/>
      </div>; })}
      {!workspace.tools.some(t => !t.archived) && <p className="scene-empty">这里还没有工具。<br/>按你的用途，自由添加。</p>}
      <button className="scene-add-tool" type="button" onClick={() => open("tools")}><Plus size={17}/>添加工具</button>
    </section>
    {panel && createPortal(<div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setPanel(null); }}>
      <section className={`modal scene-dialog ${panel === "tools" ? "scene-library" : ""}`} role="dialog" aria-modal="true" aria-labelledby="scene-dialog-title" ref={ref} tabIndex={-1}>
        <header className="modal-head"><div><span>{workspace.name}</span><h2 id="scene-dialog-title">{panel === "create" ? "一个新的场景" : panel === "manage" ? "工作区设置" : "为这个工作区添加工具"}</h2></div>
          <button className="icon-button" type="button" aria-label="关闭工作区面板" disabled={busy} onClick={() => setPanel(null)}><X size={18}/></button></header>
        {panel === "tools" ? <PageLoadBoundary><Suspense fallback={<p className="scene-library-body" role="status">正在打开工具库…</p>}><ToolLibrary workspace={workspace} busy={busy} onChange={changeWorkspace}/></Suspense></PageLoadBoundary> : <form onSubmit={e => { e.preventDefault(); if (!name.trim()) return;
          void (panel === "create" ? commit([...doc.workspaces, { id: crypto.randomUUID(), name: name.trim(), main: false, style, deleted: false, tools: [] }]) : changeWorkspace({ ...workspace, name: name.trim(), style })); }}>
          <label className="form-field"><span>工作区名称</span><input required maxLength={40} value={name} onChange={e => setName(e.target.value)} disabled={workspace.main && panel === "manage"} placeholder="例如：生活、项目、学习"/></label>
          <fieldset className="scene-style-field"><legend>视觉风格</legend><p>风格只影响呈现。名称和工具组合由你决定。</p><div className="scene-style-options">
            {styles.map(s => <button type="button" key={s.id} data-style={s.id} aria-pressed={s.id === style} className={s.id === style ? "selected" : ""} onClick={() => setStyle(s.id)}><span className="scene-swatch"/><strong>{s.label}</strong><small>{s.description}</small></button>)}
          </div></fieldset>
          {workspace.main && panel === "manage" && <p className="scene-main-note">主工作区唯一且不可删除，始终保留主页与总体待办。</p>}
          {!workspace.main && panel === "manage" && <div className="scene-delete">
            {confirmDelete ? <><p>删除后，{Object.values(doc.taskOwners).filter(id => id === workspace.id).length} 条任务会改为「待定」，工具资料保留在归档中。</p><button type="button" disabled={busy} onClick={() => void commit(doc.workspaces.map(w => w.id === workspace.id ? { ...w, deleted: true } : w), "main")}>确认删除工作区</button></> : <button type="button" onClick={() => setConfirmDelete(true)}>删除这个工作区</button>}
          </div>}
          <footer className="modal-footer"><button className="primary-button" type="submit" disabled={busy || !name.trim()}>{busy ? "正在保存…" : panel === "create" ? "创建工作区" : "保存工作区"}</button></footer>
        </form>}
        {error && <p className="scene-error" role="alert">{error}</p>}
      </section>
    </div>, document.body)}
  </>;
}
