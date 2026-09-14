import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import {
  Download,
  Eraser,
  Hand,
  Pencil,
  Pipette,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Upload,
} from "lucide-react";
import { APP_STATE_KEYS, persistAppState } from "./appDataStore";
import {
  blankPattern,
  colorCode,
  counts,
  isPattern,
  MAX_COLORS,
  resizePattern,
  validSize,
  type BeadPattern,
} from "./beads/model";
import { drawPattern, exportCanvas } from "./beads/render";
import type { ConvertOptions } from "./beads/convert";
import "./beads/studio.css";

type Tool = "pan" | "paint" | "erase" | "pick";
type Camera = { cell: number; x: number; y: number };
function load() {
  try {
    const p: unknown = JSON.parse(
      localStorage.getItem(APP_STATE_KEYS.beads) ?? "null",
    );
    return isPattern(p) ? p : blankPattern();
  } catch {
    return blankPattern();
  }
}
export default function BeadStudio() {
  const [pattern, setPattern] = useState(load);
  const [tool, setTool] = useState<Tool>("pan"),
    [color, setColor] = useState(0);
  const [size, setSize] = useState({
    width: pattern.width,
    height: pattern.height,
  });
  const [scaleResize, setScaleResize] = useState(false);
  const [camera, setCamera] = useState<Camera>({ cell: 18, x: 44, y: 40 });
  const [viewport, setViewport] = useState({ width: 600, height: 540 });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [labels, setLabels] = useState(true),
    [status, setStatus] = useState(""),
    [saveStatus, setSaveStatus] = useState("");
  const [source, setSource] = useState<{
    image: ImageBitmap;
    name: string;
    url: string;
  } | null>(null);
  const [options, setOptions] = useState<ConvertOptions>({
    width: 48,
    height: 48,
    mode: "photo",
    colors: 16,
    cleanup: 1,
  });
  const [lockRatio, setLockRatio] = useState(true),
    [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    pattern: BeadPattern;
    message: string;
  } | null>(null);
  const [history, setHistory] = useState<BeadPattern[]>([]),
    [future, setFuture] = useState<BeadPattern[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null),
    stageRef = useRef<HTMLDivElement>(null),
    fileRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null),
    importToken = useRef(0),
    patternRef = useRef(pattern);
  const sourceRef = useRef(source);
  const drag = useRef<{
    x: number;
    y: number;
    camera: Camera;
    before: BeadPattern;
    last: number | null;
    painting: boolean;
  } | null>(null);
  patternRef.current = pattern;
  sourceRef.current = source;
  const tally = useMemo(() => counts(pattern), [pattern]);
  const total = tally.reduce((a, b) => a + b, 0);

  useEffect(() => {
    if (!pending) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setPending(null);
      }
    };
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [pending]);

  useEffect(() => {
    setSaveStatus("正在保存…");
    const timer = window.setTimeout(() => {
      void persistAppState(APP_STATE_KEYS.beads, pattern)
        .then(() => setSaveStatus("已保存到本机"))
        .catch(() => setSaveStatus("数据库保存失败，本地副本已保留"));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [pattern]);
  // Flush the latest document on workspace navigation, even within the debounce window.
  useEffect(
    () => () => {
      workerRef.current?.terminate();
      importToken.current++;
      sourceRef.current?.image.close();
      if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
      void persistAppState(APP_STATE_KEYS.beads, patternRef.current).catch(
        () => undefined,
      );
    },
    [],
  );
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setViewport({
        width: Math.max(1, r.width),
        height: Math.max(1, r.height),
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  function fit(p = pattern) {
    const cell = Math.max(
      1,
      Math.min(
        36,
        (viewport.width - 90) / p.width,
        (viewport.height - 80) / p.height,
      ),
    );
    setCamera({
      cell,
      x: Math.max(44, (viewport.width - p.width * cell) / 2),
      y: Math.max(36, (viewport.height - p.height * cell) / 2),
    });
  }
  useEffect(() => {
    fit();
  }, [viewport.width, viewport.height, pattern.width, pattern.height]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#e8eff2";
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    drawPattern(
      ctx,
      pattern,
      camera.cell,
      camera.x,
      camera.y,
      viewport.width,
      viewport.height,
      labels,
    );
    if (hover) {
      ctx.strokeStyle = "#ec6f48";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        camera.x + hover.x * camera.cell,
        camera.y + hover.y * camera.cell,
        camera.cell,
        camera.cell,
      );
    }
  }, [pattern, camera, viewport, hover, labels]);
  function bound(c: Camera): Camera {
    return {
      ...c,
      x: Math.max(
        44 - pattern.width * c.cell,
        Math.min(viewport.width - 44, c.x),
      ),
      y: Math.max(
        36 - pattern.height * c.cell,
        Math.min(viewport.height - 36, c.y),
      ),
    };
  }
  function zoom(
    factor: number,
    x = viewport.width / 2,
    y = viewport.height / 2,
  ) {
    setCamera((c) => {
      const cell = Math.max(1, Math.min(72, c.cell * factor)),
        ratio = cell / c.cell;
      return bound({
        cell,
        x: x - (x - c.x) * ratio,
        y: y - (y - c.y) * ratio,
      });
    });
  }
  // Native listener prevents the surrounding workspace from scrolling while zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoom(
        Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.003),
        event.clientX - r.left,
        event.clientY - r.top,
      );
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [viewport, pattern.width, pattern.height]);
  function commit(next: BeadPattern) {
    setHistory((h) => [...h.slice(-19), patternRef.current]);
    setFuture([]);
    setPattern(next);
    setSize({ width: next.width, height: next.height });
  }
  function undo() {
    const prev = history.at(-1);
    if (!prev) return;
    setFuture((f) => [...f, pattern]);
    setHistory((h) => h.slice(0, -1));
    setPattern(prev);
    setSize({ width: prev.width, height: prev.height });
    setColor((c) => Math.min(c, prev.palette.length - 1));
  }
  function redo() {
    const next = future.at(-1);
    if (!next) return;
    setHistory((h) => [...h, pattern]);
    setFuture((f) => f.slice(0, -1));
    setPattern(next);
    setSize({ width: next.width, height: next.height });
    setColor((c) => Math.min(c, next.palette.length - 1));
  }
  function gridPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left - camera.x) / camera.cell),
      y = Math.floor((event.clientY - rect.top - camera.y) / camera.cell);
    return x >= 0 && y >= 0 && x < pattern.width && y < pattern.height
      ? { x, y }
      : null;
  }
  function paint(point: { x: number; y: number }) {
    if (!drag.current) return;
    const index = point.y * pattern.width + point.x,
      previous = drag.current.last;
    drag.current.last = index;
    setPattern((current) => {
      const cells = [...current.cells],
        startX = previous === null ? point.x : previous % current.width,
        startY =
          previous === null ? point.y : Math.floor(previous / current.width);
      const steps = Math.max(
        Math.abs(point.x - startX),
        Math.abs(point.y - startY),
        1,
      );
      for (let step = 0; step <= steps; step++)
        cells[
          Math.round(startY + ((point.y - startY) * step) / steps) *
            current.width +
            Math.round(startX + ((point.x - startX) * step) / steps)
        ] = tool === "erase" ? -1 : color;
      return { ...current, cells };
    });
  }
  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = gridPoint(event);
    if (tool === "pick" && point) {
      const i = pattern.cells[point.y * pattern.width + point.x];
      if (i >= 0) {
        setColor(i);
        setTool("paint");
      }
      return;
    }
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      camera,
      before: pattern,
      last: null,
      painting: event.button !== 1 && (tool === "paint" || tool === "erase"),
    };
    if (drag.current.painting && point) paint(point);
  }
  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = gridPoint(event);
    setHover(point);
    const state = drag.current;
    if (!state) return;
    if (state.painting) {
      if (point) paint(point);
      else state.last = null;
    } else
      setCamera(
        bound({
          ...state.camera,
          x: state.camera.x + event.clientX - state.x,
          y: state.camera.y + event.clientY - state.y,
        }),
      );
  }
  function pointerEnd() {
    const state = drag.current;
    drag.current = null;
    if (state?.painting) {
      setHistory((h) => [...h.slice(-19), state.before]);
      setFuture([]);
    }
  }
  async function selectImage(file?: File) {
    if (!file) return;
    const token = ++importToken.current;
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(true);
    setStatus("");
    let bitmap: ImageBitmap | null = null;
    try {
      if (
        file.size > 16 * 1024 * 1024 ||
        !/^image\/(png|jpeg|webp|bmp)$/.test(file.type)
      )
        throw new Error("请选择不超过 16 MB 的 PNG、JPEG、WebP 或 BMP 图片");
      bitmap = await createImageBitmap(file);
      if (token !== importToken.current) {
        bitmap.close();
        return;
      }
      if (bitmap.width * bitmap.height > 16_000_000)
        throw new Error("图片超过 1600 万像素，请先缩小后导入");
      sourceRef.current?.image.close();
      if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
      setSource({
        image: bitmap,
        name: file.name.replace(/\.[^.]+$/, "").slice(0, 80),
        url: URL.createObjectURL(file),
      });
      const w =
        options.mode === "pixel"
          ? Math.min(160, bitmap.width)
          : Math.min(48, bitmap.width);
      setOptions((o) => ({
        ...o,
        width: w,
        height: Math.max(
          1,
          Math.min(160, Math.round((w * bitmap!.height) / bitmap!.width)),
        ),
      }));
    } catch (e) {
      bitmap?.close();
      setStatus(e instanceof Error ? e.message : "图片无法解码");
    } finally {
      if (token === importToken.current) setBusy(false);
    }
  }
  function dimension(key: "width" | "height", value: number) {
    setOptions((o) => {
      const next = { ...o, [key]: value };
      if (lockRatio && source && validSize(value)) {
        if (key === "width")
          next.height = Math.max(
            1,
            Math.min(
              160,
              Math.round((value * source.image.height) / source.image.width),
            ),
          );
        else
          next.width = Math.max(
            1,
            Math.min(
              160,
              Math.round((value * source.image.width) / source.image.height),
            ),
          );
      }
      return next;
    });
  }
  function convert() {
    if (
      !source ||
      busy ||
      !validSize(options.width) ||
      !validSize(options.height)
    )
      return;
    const surface = document.createElement("canvas");
    surface.width = options.width;
    surface.height = options.height;
    const ctx = surface.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      setStatus("无法读取图片像素");
      return;
    }
    // Pixel mode samples nearest neighbors; photo mode uses area-like browser resampling.
    ctx.imageSmoothingEnabled = options.mode === "photo";
    ctx.imageSmoothingQuality = "high";
    // Letterboxing preserves aspect ratio, including extreme portrait/landscape sources.
    const ratio = Math.min(
      surface.width / source.image.width,
      surface.height / source.image.height,
    );
    const w = source.image.width * ratio,
      h = source.image.height * ratio;
    ctx.drawImage(
      source.image,
      (surface.width - w) / 2,
      (surface.height - h) / 2,
      w,
      h,
    );
    const data = ctx.getImageData(0, 0, surface.width, surface.height).data;
    setBusy(true);
    setStatus("正在整理配色与色块…");
    try {
      const worker = new Worker(
        new URL("./beads/convert.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;
      worker.onmessage = (
        event: MessageEvent<{ pattern?: BeadPattern; error?: string }>,
      ) => {
        worker.terminate();
        workerRef.current = null;
        setBusy(false);
        if (event.data.error) {
          setStatus(event.data.error);
          return;
        }
        if (event.data.pattern) {
          setPending({
            pattern: { ...event.data.pattern, title: source.name },
            message: "应用导入结果会替换当前图纸。原图纸可通过撤销恢复。",
          });
          setStatus("转换完成，请预览并确认");
        }
      };
      worker.onerror = () => {
        worker.terminate();
        workerRef.current = null;
        setBusy(false);
        setStatus("转换未完成，请缩小尺寸后重试");
      };
      worker.postMessage({ data, options }, [data.buffer]);
    } catch {
      setBusy(false);
      setStatus("无法启动图片转换，请重试");
    }
  }
  async function exportPng() {
    setBusy(true);
    setStatus("");
    try {
      const canvas = exportCanvas(pattern);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("PNG 编码失败"))),
          "image/png",
        ),
      );
      const name = `${pattern.title.replace(/[\\/:*?"<>|]/g, "_") || "拼豆图纸"}.png`;
      if (isTauri()) {
        const path = await save({
          title: "导出完整拼豆图纸",
          defaultPath: name,
          filters: [{ name: "PNG 图片", extensions: ["png"] }],
        });
        if (!path) return;
        await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      } else {
        const url = URL.createObjectURL(blob),
          link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
      setStatus(
        `已导出完整图纸、色号、坐标和用色清单（${canvas.width} × ${canvas.height} 像素）`,
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "导出未完成，请重新选择位置");
    } finally {
      setBusy(false);
    }
  }
  const tools: { id: Tool; name: string; icon: typeof Hand }[] = [
    { id: "pan", name: "拖动画布", icon: Hand },
    { id: "paint", name: "画笔", icon: Pencil },
    { id: "erase", name: "橡皮", icon: Eraser },
    { id: "pick", name: "吸管", icon: Pipette },
  ];
  return (
    <section className="bead-studio" aria-label="拼豆工坊">
      <header className="bead-heading">
        <div>
          <span>BEAD STUDIO / 拼豆工坊</span>
          <input
            aria-label="图纸名称"
            maxLength={80}
            value={pattern.title}
            onChange={(e) =>
              setPattern((p) => ({ ...p, title: e.target.value }))
            }
          />
          <p>
            {pattern.width} × {pattern.height} 格 · {total} 颗豆 ·{" "}
            {tally.filter(Boolean).length} 色 <small>{saveStatus}</small>
          </p>
        </div>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => void exportPng()}
        >
          <Download size={16} />
          导出完整 PNG
        </button>
      </header>
      <div className="bead-layout">
        <aside className="bead-controls" aria-label="导入与图纸设置">
          <details open>
            <summary>导入图片</summary>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp,image/bmp"
              onChange={(e) => {
                void selectImage(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              className="secondary-button bead-upload"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={16} />
              选择图片
            </button>
            {source && (
              <figure className="bead-source">
                <img src={source.url} alt="导入原图" />
                <figcaption>
                  {source.image.width} × {source.image.height} px
                </figcaption>
              </figure>
            )}
            <label>
              导入模式
              <select
                aria-label="导入模式"
                value={options.mode}
                onChange={(e) => {
                  const mode = e.target.value as ConvertOptions["mode"];
                  setOptions((o) => ({
                    ...o,
                    mode,
                    ...(mode === "pixel" &&
                    source &&
                    source.image.width <= 160 &&
                    source.image.height <= 160
                      ? {
                          width: source.image.width,
                          height: source.image.height,
                        }
                      : {}),
                  }));
                }}
              >
                <option value="photo">照片转图 · 精简配色</option>
                <option value="pixel">像素原稿 · 保留原色</option>
              </select>
            </label>
            <p className="bead-help">
              像素原稿每个像素对应一颗豆。放大过的像素画，请填入原始格数；透明处留空，不识别带网格或文字的成品图纸。
            </p>
            <div className="bead-fields">
              <label>
                解析宽度
                <input
                  type="number"
                  min={1}
                  max={160}
                  value={options.width}
                  onChange={(e) => dimension("width", Number(e.target.value))}
                />
              </label>
              <label>
                解析高度
                <input
                  type="number"
                  min={1}
                  max={160}
                  value={options.height}
                  onChange={(e) => dimension("height", Number(e.target.value))}
                />
              </label>
            </div>
            <label className="bead-check">
              <input
                type="checkbox"
                checked={lockRatio}
                onChange={(e) => setLockRatio(e.target.checked)}
              />
              联动宽高比例
            </label>
            {options.mode === "photo" && (
              <>
                <label>
                  最多颜色数
                  <input
                    type="number"
                    min={2}
                    max={48}
                    value={options.colors}
                    onChange={(e) =>
                      setOptions((o) => ({
                        ...o,
                        colors: Math.max(
                          2,
                          Math.min(48, Number(e.target.value)),
                        ),
                      }))
                    }
                  />
                </label>
                <label>
                  去杂色强度
                  <select
                    value={options.cleanup}
                    onChange={(e) =>
                      setOptions((o) => ({
                        ...o,
                        cleanup: Number(e.target.value),
                      }))
                    }
                  >
                    <option value={0}>关闭 · 保留细节</option>
                    <option value={1}>温和 · 保留轮廓</option>
                    <option value={2}>较强 · 简化色块</option>
                  </select>
                </label>
              </>
            )}
            <button
              className="bead-action"
              disabled={
                !source ||
                busy ||
                !validSize(options.width) ||
                !validSize(options.height)
              }
              onClick={convert}
            >
              {busy ? "正在处理…" : "生成图纸预览"}
            </button>
            {busy && workerRef.current && (
              <button
                className="secondary-button"
                onClick={() => {
                  workerRef.current?.terminate();
                  workerRef.current = null;
                  setBusy(false);
                  setStatus("已取消转换");
                }}
              >
                取消转换
              </button>
            )}
          </details>
          <details>
            <summary>调整画布尺寸</summary>
            <div className="bead-fields">
              <label>
                画布宽度
                <input
                  type="number"
                  min={1}
                  max={160}
                  value={size.width}
                  onChange={(e) =>
                    setSize((s) => ({ ...s, width: Number(e.target.value) }))
                  }
                />
              </label>
              <label>
                画布高度
                <input
                  type="number"
                  min={1}
                  max={160}
                  value={size.height}
                  onChange={(e) =>
                    setSize((s) => ({ ...s, height: Number(e.target.value) }))
                  }
                />
              </label>
            </div>
            <label className="bead-check">
              <input
                type="checkbox"
                checked={scaleResize}
                onChange={(e) => setScaleResize(e.target.checked)}
              />
              缩放内容（最近邻）
            </label>
            <p className="bead-help">
              关闭缩放时保留左上角，新增格子留空；缩小时裁去超出边界的内容。支持
              1–160 格。
            </p>
            <button
              className="secondary-button"
              disabled={!validSize(size.width) || !validSize(size.height)}
              onClick={() =>
                setPending({
                  pattern: resizePattern(
                    pattern,
                    size.width,
                    size.height,
                    scaleResize,
                  ),
                  message: scaleResize
                    ? "将按新尺寸缩放图纸内容，可撤销。"
                    : "将调整边界，超出新边界的内容会被裁去，可撤销。",
                })
              }
            >
              预览尺寸调整
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                setPending({
                  pattern: blankPattern(),
                  message: "创建空白图纸将替换当前内容，可撤销。",
                })
              }
            >
              新建空白图纸
            </button>
          </details>
        </aside>
        <div className="bead-drawing">
          <div className="bead-toolbar" role="toolbar" aria-label="画布工具">
            {tools.map((t) => (
              <button
                key={t.id}
                aria-label={t.name}
                title={t.name}
                aria-pressed={tool === t.id}
                className={tool === t.id ? "active" : ""}
                onClick={() => setTool(t.id)}
              >
                <t.icon size={17} />
                <span>{t.name}</span>
              </button>
            ))}
            <span className="bead-toolbar-gap" />
            <button
              aria-label="撤销"
              title="撤销（画布聚焦时 Ctrl+Z）"
              disabled={!history.length}
              onClick={undo}
            >
              <Undo2 size={17} />
            </button>
            <button
              aria-label="重做"
              title="重做"
              disabled={!future.length}
              onClick={redo}
            >
              <Redo2 size={17} />
            </button>
          </div>
          <div ref={stageRef} className={`bead-stage tool-${tool}`}>
            <canvas
              ref={canvasRef}
              tabIndex={0}
              aria-label="拼豆画布：使用拖动工具平移，滚轮缩放，画笔绘制"
              style={{ width: viewport.width, height: viewport.height }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerEnd}
              onPointerCancel={pointerEnd}
              onLostPointerCapture={pointerEnd}
              onPointerLeave={() => setHover(null)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
                  e.preventDefault();
                  if (e.shiftKey) redo();
                  else undo();
                }
              }}
            />
          </div>
          <div className="bead-canvas-footer">
            <span>
              {hover
                ? `X ${hover.x + 1} / Y ${hover.y + 1} · ${pattern.cells[hover.y * pattern.width + hover.x] < 0 ? "空白" : colorCode(pattern.cells[hover.y * pattern.width + hover.x])}`
                : "左上角 (1,1) · 拖动平移 / 滚轮缩放"}
            </span>
            <div>
              <button aria-label="缩小" onClick={() => zoom(0.8)}>
                <ZoomOut size={16} />
              </button>
              <span>{Math.round((camera.cell / 24) * 100)}%</span>
              <button aria-label="放大" onClick={() => zoom(1.25)}>
                <ZoomIn size={16} />
              </button>
              <button
                aria-label="适应画布"
                title="适应画布"
                onClick={() => fit()}
              >
                <Maximize size={16} />
              </button>
            </div>
          </div>
          <label className="bead-check">
            <input
              type="checkbox"
              checked={labels}
              onChange={(e) => setLabels(e.target.checked)}
            />
            显示每颗豆的编号{" "}
            {camera.cell < 18 && "· 放大后显示，导出始终包含编号"}
          </label>
          <p className="bead-help">
            导出包含整个图纸（含屏幕外部分）、色号、坐标、尺寸和用色清单。每五格加粗；空白格不放豆。
          </p>
          {status && (
            <p className="bead-status" role="status">
              {status}
            </p>
          )}
        </div>
        <aside className="bead-palette" aria-label="豆色与用量">
          <h2>
            豆色与用量 <span>{tally.filter(Boolean).length} 色</span>
          </h2>
          <p className="bead-help">
            B 编号为本图纸编号。请对照实体豆，填写品牌色号或名称。
          </p>
          <div className="bead-palette-list">
            {pattern.palette.map((c, i) => (
              <button
                key={i}
                className={color === i ? "active" : ""}
                aria-label={`选择 ${colorCode(i)} ${c.name}`}
                aria-pressed={color === i}
                onClick={() => {
                  setColor(i);
                  setTool("paint");
                }}
              >
                <i style={{ background: c.hex }} />
                <span>
                  <strong>{colorCode(i)}</strong>
                  <small>{c.name}</small>
                </span>
                <em>{tally[i]} 颗</em>
              </button>
            ))}
          </div>
          <label>
            当前色名称
            <input
              maxLength={40}
              value={pattern.palette[color]?.name ?? ""}
              onChange={(e) =>
                setPattern((p) => ({
                  ...p,
                  palette: p.palette.map((c, i) =>
                    i === color ? { ...c, name: e.target.value } : c,
                  ),
                }))
              }
            />
          </label>
          <label>
            当前色值
            <input
              type="color"
              value={pattern.palette[color]?.hex ?? "#000000"}
              onChange={(e) =>
                commit({
                  ...pattern,
                  palette: pattern.palette.map((c, i) =>
                    i === color ? { ...c, hex: e.target.value } : c,
                  ),
                })
              }
            />
          </label>
          <button
            className="secondary-button"
            disabled={pattern.palette.length >= MAX_COLORS}
            onClick={() => {
              setColor(pattern.palette.length);
              commit({
                ...pattern,
                palette: [
                  ...pattern.palette,
                  { hex: "#8b7fa3", name: "新颜色" },
                ],
              });
            }}
          >
            添加颜色
          </button>
        </aside>
      </div>
      {pending && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPending(null);
          }}
        >
          <section
            className="modal bead-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label="确认图纸变更"
          >
            <h2>预览图纸</h2>
            <Preview pattern={pending.pattern} />
            <p>{pending.message}</p>
            <p>
              {pending.pattern.width} × {pending.pattern.height} 格 ·{" "}
              {counts(pending.pattern).filter(Boolean).length} 色 ·{" "}
              {pending.pattern.cells.filter((c) => c >= 0).length} 颗豆
            </p>
            <footer>
              <button
                className="secondary-button"
                onClick={() => setPending(null)}
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  commit(pending.pattern);
                  setColor(0);
                  setPending(null);
                  setStatus("图纸已应用，可使用画笔继续修改");
                }}
              >
                应用图纸
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
function Preview({ pattern }: { pattern: BeadPattern }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 480, 360);
    const cell = Math.min(400 / pattern.width, 290 / pattern.height);
    drawPattern(ctx, pattern, cell, 40, 35, 480, 360, false);
  }, [pattern]);
  return (
    <canvas ref={ref} width={480} height={360} aria-label="图纸变更预览" />
  );
}
