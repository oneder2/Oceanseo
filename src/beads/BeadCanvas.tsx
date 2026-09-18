import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { colorCode, type BeadPattern } from "./model";
import { drawPattern } from "./render";
import { fitCamera, resizeCamera, zoomCamera, type Camera } from "./camera";

export type Tool = "pan" | "paint" | "erase" | "pick" | "fill";
type Point = { x: number; y: number };
type Gesture =
  | { kind: "pan"; x: number; y: number; camera: Camera }
  | {
      kind: "paint";
      pattern: BeadPattern;
      value: number;
      last: Point | null;
      label: string;
    };
export default function BeadCanvas({
  pattern,
  tool,
  color,
  labels,
  contours,
  locked,
  onCommit,
  onFill,
  onPick,
  onGesture,
}: {
  pattern: BeadPattern;
  tool: Tool;
  color: number;
  labels: boolean;
  contours: boolean;
  locked: boolean;
  onCommit: (label: string, p: BeadPattern) => void;
  onFill: (point: Point) => void;
  onPick: (color: number) => void;
  onGesture: (active: boolean) => void;
}) {
  const stage = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera>({ x: 44, y: 38, cell: 24 });
  const [hover, setHover] = useState<Point | null>(null);
  const [draft, setDraft] = useState<BeadPattern | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const previous = useRef({ width: 0, height: 0, columns: 0, rows: 0 });
  const current = useRef({ camera, viewport });
  current.current = { camera, viewport };
  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width >= 80 && r.height >= 80)
        setViewport({ width: r.width, height: r.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!viewport.width) return;
    const before = previous.current;
    if (
      !before.width ||
      before.columns !== pattern.width ||
      before.rows !== pattern.height
    ) {
      setCamera(fitCamera(pattern.width, pattern.height, viewport));
      setHover(null);
    } else setCamera((c) => resizeCamera(c, before, viewport));
    previous.current = {
      ...viewport,
      columns: pattern.width,
      rows: pattern.height,
    };
  }, [viewport.width, viewport.height, pattern.width, pattern.height]);
  useEffect(() => {
    const node = canvas.current;
    if (!node || !viewport.width) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    node.width = Math.round(viewport.width * dpr);
    node.height = Math.round(viewport.height * dpr);
    const ctx = node.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#e8eff2";
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    drawPattern(
      ctx,
      draft ?? pattern,
      camera.cell,
      camera.x,
      camera.y,
      viewport.width,
      viewport.height,
      labels,
      true,
      contours,
    );
    if (hover && !locked) {
      ctx.strokeStyle = "#c96545";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        camera.x + hover.x * camera.cell,
        camera.y + hover.y * camera.cell,
        camera.cell,
        camera.cell,
      );
    }
  }, [pattern, draft, camera, viewport, labels, contours, hover, locked]);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (gesture.current) return;
      const r = node.getBoundingClientRect();
      setCamera((c) =>
        zoomCamera(
          c,
          Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.003),
          e.clientX - r.left,
          e.clientY - r.top,
        ),
      );
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  function point(e: React.PointerEvent<HTMLCanvasElement>): Point | null {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left - camera.x) / camera.cell),
      y = Math.floor((e.clientY - r.top - camera.y) / camera.cell);
    return x >= 0 && y >= 0 && x < pattern.width && y < pattern.height
      ? { x, y }
      : null;
  }
  function paint(p: Point) {
    const g = gesture.current;
    if (g?.kind !== "paint") return;
    const from = g.last ?? p;
    g.last = p;
    const steps = Math.max(Math.abs(p.x - from.x), Math.abs(p.y - from.y), 1);
    const cells = [...g.pattern.cells];
    for (let step = 0; step <= steps; step++) {
      cells[
        Math.round(from.y + ((p.y - from.y) * step) / steps) * pattern.width +
          Math.round(from.x + ((p.x - from.x) * step) / steps)
      ] = g.value;
    }
    g.pattern = { ...g.pattern, cells };
    setDraft(g.pattern);
  }
  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (locked || (e.button !== 0 && e.button !== 1)) return;
    e.preventDefault();
    e.currentTarget.focus();
    const p = point(e);
    if (e.button === 0 && tool === "pick") {
      if (p && pattern.cells[p.y * pattern.width + p.x] >= 0)
        onPick(pattern.cells[p.y * pattern.width + p.x]);
      return;
    }
    if (e.button === 0 && tool === "fill") {
      if (p) onFill(p);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 0 && (tool === "paint" || tool === "erase")) {
      gesture.current = {
        kind: "paint",
        pattern,
        value: tool === "erase" ? -1 : color,
        last: null,
        label: tool === "erase" ? "橡皮擦除" : "画笔绘制",
      };
      onGesture(true);
      if (p) paint(p);
    } else
      gesture.current = { kind: "pan", x: e.clientX, y: e.clientY, camera };
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = point(e);
    setHover(p);
    const g = gesture.current;
    if (g?.kind === "paint") {
      if (p) paint(p);
      else g.last = null;
    }
    if (g?.kind === "pan") {
      setCamera({
        ...g.camera,
        x: Math.max(
          44 - pattern.width * g.camera.cell,
          Math.min(viewport.width - 44, g.camera.x + e.clientX - g.x),
        ),
        y: Math.max(
          38 - pattern.height * g.camera.cell,
          Math.min(viewport.height - 38, g.camera.y + e.clientY - g.y),
        ),
      });
    }
  }
  function finish(accept = true) {
    const g = gesture.current;
    gesture.current = null;
    setDraft(null);
    if (g?.kind === "paint") {
      onGesture(false);
      if (accept) onCommit(g.label, g.pattern);
    }
  }
  const zoom = (factor: number) =>
    setCamera((c) =>
      zoomCamera(
        c,
        factor,
        current.current.viewport.width / 2,
        current.current.viewport.height / 2,
      ),
    );
  return (
    <div className="bead-canvas-wrap">
      <div
        className={`bead-stage tool-${tool}${locked ? " is-locked" : ""}`}
        ref={stage}
      >
        <canvas
          ref={canvas}
          tabIndex={0}
          aria-label="拼豆画布"
          aria-disabled={locked}
          style={{ width: viewport.width, height: viewport.height }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={() => finish()}
          onPointerCancel={() => finish(false)}
          onLostPointerCapture={() => finish()}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (
              gesture.current?.kind === "paint" &&
              (e.key === "Escape" ||
                ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z"))
            ) {
              e.preventDefault();
              e.stopPropagation();
              finish(false);
            }
          }}
        />
      </div>
      <footer className="bead-canvas-footer">
        <span>
          {hover
            ? `X ${hover.x + 1} · Y ${hover.y + 1} · ${pattern.cells[hover.y * pattern.width + hover.x] < 0 ? "空白" : colorCode(pattern.cells[hover.y * pattern.width + hover.x], pattern)}`
            : "左上角 (1,1) · 滚轮缩放 / 中键拖动"}
        </span>
        <div>
          <button title="缩小" aria-label="缩小" onClick={() => zoom(0.8)}>
            <ZoomOut size={16} />
          </button>
          <output aria-label="画布缩放比例">
            {Math.round((camera.cell / 24) * 100)}%
          </output>
          <button title="放大" aria-label="放大" onClick={() => zoom(1.25)}>
            <ZoomIn size={16} />
          </button>
          <button
            title="适应画布"
            aria-label="适应画布"
            onClick={() =>
              setCamera(fitCamera(pattern.width, pattern.height, viewport))
            }
          >
            <Maximize size={16} />
          </button>
        </div>
      </footer>
    </div>
  );
}
