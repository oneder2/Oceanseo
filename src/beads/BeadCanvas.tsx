import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { colorCode, type BeadPattern } from "./model";
import { drawPattern } from "./render";
import { fitCamera, resizeCamera, zoomCamera, pinchCamera, type Camera } from "./camera";

export type Tool = "pan" | "paint" | "erase" | "pick" | "fill";
type Point = { x: number; y: number };
type Gesture =
  | { kind: "pan"; x: number; y: number; camera: Camera }
  | { kind: "pinch"; center: Point; distance: number; camera: Camera }
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
  marking = false,
  onCellTap,
  completedCells = [],
  touch = false,
  highlightColor = null,
  section = null,
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
  marking?: boolean;
  onCellTap?: (point: Point) => void;
  completedCells?: number[];
  touch?: boolean;
  highlightColor?: number | null;
  section?: { x: number; y: number; width: number; height: number } | null;
}) {
  const stage = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera>({ x: 44, y: 38, cell: 24 });
  const [hover, setHover] = useState<Point | null>(null);
  const [draft, setDraft] = useState<BeadPattern | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const fingers = useRef(new Map<number, Point>());
  const touchOrigin = useRef<Point | null>(null);
  const suppressTap = useRef(false);
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
  useLayoutEffect(() => {
    if (!viewport.width || !touch) return;
    const fitted = fitCamera(section?.width ?? pattern.width, section?.height ?? pattern.height, viewport);
    setCamera({ ...fitted, x: fitted.x - (section?.x ?? 0) * fitted.cell, y: fitted.y - (section?.y ?? 0) * fitted.cell });
  }, [section, touch, viewport.width, viewport.height, pattern.width, pattern.height]);
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
    // Locator rings annotate the original colours; they never replace the
    // palette. A section is a viewing aid, not a cropped/modified drawing.
    ctx.save();
    if (section) {
      ctx.fillStyle = "#e8eff2c9";
      for (let y = 0; y < pattern.height; y++) for (let x = 0; x < pattern.width; x++) {
        if (x >= section.x && x < section.x + section.width && y >= section.y && y < section.y + section.height) continue;
        ctx.fillRect(camera.x + x * camera.cell, camera.y + y * camera.cell, camera.cell, camera.cell);
      }
      ctx.strokeStyle = "#38616f";
      ctx.lineWidth = 3;
      ctx.strokeRect(camera.x + section.x * camera.cell, camera.y + section.y * camera.cell, section.width * camera.cell, section.height * camera.cell);
    }
    if (highlightColor !== null) {
      for (let i = 0; i < pattern.cells.length; i++) {
        const x = i % pattern.width, y = Math.floor(i / pattern.width);
        if (section && (x < section.x || x >= section.x + section.width || y < section.y || y >= section.y + section.height)) continue;
        if (pattern.cells[i] !== highlightColor) continue;
        const px = camera.x + x * camera.cell, py = camera.y + y * camera.cell;
        if (px + camera.cell < 0 || py + camera.cell < 0 || px > viewport.width || py > viewport.height) continue;
        const inset = Math.min(3, camera.cell * .12);
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.min(5, camera.cell * .24);
        ctx.strokeRect(px + inset, py + inset, camera.cell - inset * 2, camera.cell - inset * 2);
        ctx.strokeStyle = "#733bb2"; ctx.lineWidth = Math.min(2, camera.cell * .12);
        ctx.strokeRect(px + inset, py + inset, camera.cell - inset * 2, camera.cell - inset * 2);
      }
    }
    ctx.restore();
    // Completion is an annotation, never a replacement for the bead's colour.
    ctx.save();
    for (const index of completedCells) {
      if (pattern.cells[index] < 0) continue;
      const x = camera.x + (index % pattern.width + 0.5) * camera.cell;
      const y = camera.y + (Math.floor(index / pattern.width) + 0.5) * camera.cell;
      if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) continue;
      ctx.beginPath();
      ctx.arc(x, y, camera.cell * 0.36, 0, Math.PI * 2);
      ctx.fillStyle = "#173c46dc";
      ctx.fill();
      ctx.lineWidth = Math.max(1, camera.cell * 0.04);
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - camera.cell * 0.18, y);
      ctx.lineTo(x - camera.cell * 0.04, y + camera.cell * 0.14);
      ctx.lineTo(x + camera.cell * 0.19, y - camera.cell * 0.15);
      ctx.lineWidth = Math.max(1, camera.cell * 0.065);
      ctx.stroke();
    }
    ctx.restore();
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
  }, [pattern, draft, camera, viewport, labels, contours, hover, locked, completedCells, highlightColor, section]);
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
  function point(e: { currentTarget: HTMLCanvasElement; clientX: number; clientY: number }): Point | null {
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
    if (touch && e.pointerType === "touch") {
      const rect = e.currentTarget.getBoundingClientRect();
      const finger = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (!fingers.current.size) { suppressTap.current = false; touchOrigin.current = finger; onGesture(true); }
      fingers.current.set(e.pointerId, finger);
      e.currentTarget.setPointerCapture(e.pointerId);
      if (fingers.current.size >= 2) {
        e.preventDefault();
        suppressTap.current = true;
        const [a, b] = [...fingers.current.values()];
        gesture.current = { kind: "pinch", camera: current.current.camera,
          center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) };
        onGesture(true);
        return;
      }
    }
    if (e.button === 0 && marking) {
      // Keep the native click sequence intact in marking mode. Calling
      // preventDefault() during pointerdown suppresses click on Android/WebView.
      return;
    }
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
    } else {
      gesture.current = { kind: "pan", x: e.clientX, y: e.clientY, camera };
      onGesture(true);
    }
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (touch && fingers.current.has(e.pointerId)) {
      const rect = e.currentTarget.getBoundingClientRect();
      const finger = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      fingers.current.set(e.pointerId, finger);
      const g = gesture.current;
      if (g?.kind === "pinch") {
        if (fingers.current.size >= 2) {
          const [a, b] = [...fingers.current.values()];
          setCamera(pinchCamera(g.camera, g.distance, Math.hypot(a.x - b.x, a.y - b.y), g.center,
            { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
        }
        return;
      }
      if (touchOrigin.current && Math.hypot(finger.x - touchOrigin.current.x, finger.y - touchOrigin.current.y) > 8) {
        suppressTap.current = true;
        if (marking && !g) {
          gesture.current = { kind: "pan", camera: current.current.camera,
            x: rect.left + touchOrigin.current.x, y: rect.top + touchOrigin.current.y };
          onGesture(true);
        }
      }
    }
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
    } else if (g?.kind === "pan" || g?.kind === "pinch") onGesture(false);
  }
  function endPointer(e: React.PointerEvent<HTMLCanvasElement>, accept = true) {
    if (fingers.current.delete(e.pointerId)) {
      if (!accept) suppressTap.current = true;
      if (fingers.current.size) return;
      touchOrigin.current = null;
      onGesture(false);
    }
    finish(accept);
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
          onPointerUp={e => endPointer(e)}
          onPointerCancel={e => endPointer(e, false)}
          onLostPointerCapture={e => { if (fingers.current.has(e.pointerId)) endPointer(e, false); }}
          onClick={(event) => {
            if (!marking || locked || (touch && suppressTap.current)) return;
            const p = point(event);
            if (p) onCellTap?.(p);
          }}
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
            : touch ? "左上角 (1,1) · 双指缩放 / 拖动查看" : "左上角 (1,1) · 滚轮缩放 / 中键拖动"}
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
              { const fitted = fitCamera(section?.width ?? pattern.width, section?.height ?? pattern.height, viewport);
                setCamera({ ...fitted, x: fitted.x - (section?.x ?? 0) * fitted.cell, y: fitted.y - (section?.y ?? 0) * fitted.cell }); }
            }
          >
            <Maximize size={16} />
          </button>
        </div>
      </footer>
    </div>
  );
}
