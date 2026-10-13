import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Ellipsis, Info, Trash2, X } from "lucide-react";
import { useFocusScope } from "../useFocusScope";
import type { ModuleId } from "../modules/catalog";
import type { PersonalWorkspace } from "./model";

export default function ToolActions({ module, label, workspace, workspaces, busy, onRemove }: {
  module: ModuleId; label: string; workspace: PersonalWorkspace; workspaces: PersonalWorkspace[];
  busy: boolean; onRemove: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false), [properties, setProperties] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), dialog = useRef<HTMLElement>(null);
  const menuId = useId(), titleId = useId();
  useFocusScope(properties, dialog);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = trigger.current!.getBoundingClientRect();
      const height = menu.current!.offsetHeight;
      setPosition({ left: Math.max(12, Math.min(box.right - 212, innerWidth - 224)), top: Math.max(12, box.bottom + height + 8 <= innerHeight - 12 ? box.bottom + 6 : box.top - height - 6), width: 212 });
    };
    place(); menu.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const dismiss = (event: Event) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("focusin", dismiss);
    window.addEventListener("scroll", scroll, true); window.addEventListener("resize", place);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("focusin", dismiss); window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", place); };
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  return <>
    <button ref={trigger} className="scene-tool-actions" type="button" aria-label={`工具操作：${label}`} title="工具操作" disabled={busy} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}><Ellipsis size={17}/></button>
    {open && createPortal(<div className="scene-tool-menu" id={menuId} ref={menu} role="menu" aria-label={`${label}的操作`} style={position} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>("button")], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      } else if (event.key === "Tab") setOpen(false);
    }}><small>{label}</small>
      <button type="button" role="menuitem" onClick={() => { close(); setProperties(true); }}><Info size={16}/>属性</button>
      <button className="scene-tool-menu-delete" type="button" role="menuitem" onClick={() => { close(); void onRemove(); }}><Trash2 size={16}/>删除工具</button>
      <p>仅从当前工作区移除，保留共享资料。</p>
    </div>, document.body)}
    {properties && createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setProperties(false); }}>
      <section ref={dialog} className="modal scene-dialog scene-tool-properties" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setProperties(false); } }}>
        <header className="modal-head"><div><span>工具属性</span><h2 id={titleId}>{label}</h2></div><button className="icon-button" type="button" aria-label="关闭工具属性" onClick={() => setProperties(false)}><X size={18}/></button></header>
        <dl><div><dt>当前工作区</dt><dd>{workspace.name}</dd></div><div><dt>资料范围</dt><dd>所有工作区共享同一份资料</dd></div><div><dt>已添加到</dt><dd>{workspaces.filter(w => !w.deleted && w.tools.some(t => t.module === module && !t.archived)).map(w => w.name).join("、")}</dd></div></dl>
        <p>修改内容会在已添加此工具的工作区同步显示。删除工具只移除当前入口，其他工作区仍可使用。</p>
        <footer className="modal-footer"><button className="primary-button" type="button" onClick={() => setProperties(false)}>完成</button></footer>
      </section>
    </div>, document.body)}
  </>;
}
