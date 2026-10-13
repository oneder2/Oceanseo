import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "./invoke";
import type { View } from "../types";

const WIDTH_KEY = "oceanseo.personal.sidebar-width.v1";
const DEFAULT_WIDTH = 244;
function readWidth() {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(value) && value >= 200 && value <= 360 ? value : DEFAULT_WIDTH;
  } catch { return DEFAULT_WIDTH; }
}
const directions = [
  ["North", "上边"], ["South", "下边"], ["East", "右边"], ["West", "左边"],
  ["NorthEast", "右上角"], ["NorthWest", "左上角"], ["SouthEast", "右下角"], ["SouthWest", "左下角"],
] as const;

/** Personal desktop chrome; no workspace or tool state is changed by resizing. */
export default function DesktopChrome({ fullscreen, view, onError }: {
  fullscreen: boolean; view: View; onError: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const [preferred, setPreferred] = useState(readWidth);
  const [viewport, setViewport] = useState(window.innerWidth);
  const width = Math.min(preferred, Math.max(200, viewport - 400));
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useLayoutEffect(() => {
    const shell = ref.current?.closest<HTMLElement>(".personal-shell");
    shell?.style.setProperty("--personal-sidebar-width", `${width}px`);
    try { localStorage.setItem(WIDTH_KEY, String(preferred)); } catch { /* Keep the session preference if storage is full. */ }
  }, [width, preferred]);
  useEffect(() => {
    const workspace = ref.current?.parentElement?.querySelector<HTMLElement>("main.workspace");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // AnimatedContent-inspired entrance: brief, small, and never hiding interactive content.
    const animation = workspace?.animate([{ opacity: 0.75, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }], {
      duration: 260, easing: "cubic-bezier(.22,1,.36,1)",
    });
    return () => animation?.cancel();
  }, [view]);
  function finish(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    ref.current?.closest(".personal-shell")?.classList.remove("is-resizing-sidebar");
  }
  return <>
    <div ref={ref} className="personal-sidebar-resizer" role="separator" aria-label="调整侧边栏宽度"
      aria-orientation="vertical" aria-valuemin={200} aria-valuemax={Math.min(360, Math.max(200, viewport - 400))}
      aria-valuenow={width} tabIndex={0} title="拖动调整宽度；方向键微调；双击恢复默认"
      onDoubleClick={() => setPreferred(DEFAULT_WIDTH)}
      onKeyDown={event => {
        const step = event.shiftKey ? 24 : 12;
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const max = Math.min(360, Math.max(200, viewport - 400));
        setPreferred(event.key === "Home" ? 200 : event.key === "End" ? max : Math.max(200, Math.min(max, width + (event.key === "ArrowRight" ? step : -step))));
      }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { id: event.pointerId, x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
        ref.current?.closest(".personal-shell")?.classList.add("is-resizing-sidebar");
      }}
      onPointerMove={event => {
        if (drag.current?.id !== event.pointerId) return;
        setPreferred(Math.max(200, Math.min(360, viewport - 400, drag.current.width + event.clientX - drag.current.x)));
      }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => {
        drag.current = null; ref.current?.closest(".personal-shell")?.classList.remove("is-resizing-sidebar");
      }}><span/></div>
    {isTauri() && !fullscreen && createPortal(<div className="personal-window-edges" aria-label="窗口边缘">
      {directions.map(([direction, label]) => <div key={direction} className={`personal-window-edge edge-${direction}`}
        title={`拖动${label}调整窗口大小`} aria-hidden="true" onMouseDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          void getCurrentWindow().startResizeDragging(direction).catch(() => onError("窗口缩放未开始，请重新拖动窗口边缘"));
        }}/>) }
    </div>, document.body)}
  </>;
}
