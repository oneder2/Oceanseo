import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Eraser,
  Eye,
  Focus,
  Hand,
  PaintBucket,
  Palette,
  Pencil,
  Pipette,
  Redo2,
  Ruler,
  ScanLine,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  colorCode,
  counts,
  formatCm,
  isPattern,
  physicalSize,
  type BeadPattern,
} from "./model";
import { samePattern, type Proposal } from "./document";
import { floodFill } from "./edit";
import { useBeadDocument } from "./useBeadDocument";
import { useImageImport } from "./useImageImport";
import { exportPattern } from "./export";
import BeadCanvas, { type Tool } from "./BeadCanvas";
import ColorPanel from "./ColorPanel";
import ImportPanel from "./ImportPanel";
import DocumentPanel from "./DocumentPanel";
import ShapePanel from "./ShapePanel";
import PreviewDialog from "./PreviewDialog";
import "./studio.css";

type Panel = "colors" | "import" | "shape" | "document" | "view";
const panels: { id: Panel; label: string; icon: typeof Palette }[] = [
  { id: "colors", label: "豆色", icon: Palette },
  { id: "import", label: "导入", icon: Upload },
  { id: "shape", label: "填充与加边", icon: ScanLine },
  { id: "document", label: "尺寸", icon: Ruler },
  { id: "view", label: "显示", icon: Eye },
];
const tools: {
  id: Tool;
  label: string;
  key: string;
  icon: typeof Hand;
  help: string;
}[] = [
  {
    id: "pan",
    label: "拖动画布",
    key: "V",
    icon: Hand,
    help: "拖动查看 · 滚轮缩放",
  },
  {
    id: "paint",
    label: "画笔",
    key: "B",
    icon: Pencil,
    help: "按住拖动绘制 · 一整笔可撤销",
  },
  {
    id: "erase",
    label: "橡皮",
    key: "E",
    icon: Eraser,
    help: "拖动擦除为透明空格",
  },
  {
    id: "pick",
    label: "吸管",
    key: "I",
    icon: Pipette,
    help: "点击取色 · 不会自动切换画笔",
  },
  {
    id: "fill",
    label: "区域填充",
    key: "G",
    icon: PaintBucket,
    help: "点击相连区域 · 预览后再应用",
  },
];
function DocumentTitle({
  value,
  disabled,
  commit,
}: {
  value: string;
  disabled: boolean;
  commit: (title: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      aria-label="图纸名称"
      maxLength={80}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim() || "未命名图纸";
        setDraft(next);
        commit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          setDraft(value);
        }
      }}
    />
  );
}

export default function BeadWorkbench() {
  const { state, dispatch, saveStatus } = useBeadDocument();
  const pattern = state.present;
  const [tool, setTool] = useState<Tool>("pan"),
    [selection, setSelection] = useState(0);
  const color = Math.min(selection, pattern.palette.length - 1);
  const [panel, setPanel] = useState<Panel | null>(null),
    [focused, setFocused] = useState(false);
  const [labels, setLabels] = useState(true),
    [contours, setContours] = useState(true);
  const [notice, notify] = useState(""),
    [exporting, setExporting] = useState(false),
    [gesture, setGesture] = useState(false);
  const root = useRef<HTMLElement>(null),
    inspector = useRef<HTMLElement>(null),
    trigger = useRef<HTMLElement | null>(null);
  const exportingRef = useRef(false);
  const tally = useMemo(() => counts(pattern), [pattern]);
  const total = tally.reduce((a, b) => a + b, 0),
    measure = useMemo(() => physicalSize(pattern), [pattern]);
  const importer = useImageImport(
    (p) =>
      propose({
        label: "导入图纸",
        after: { ...p, beadPitchMm: pattern.beadPitchMm },
        message: "导入结果会替换当前图纸，沿用当前豆距；应用后可撤销。",
      }),
    notify,
  );
  const busy = importer.busy || exporting;
  const locked = busy || !!state.proposal,
    controlsLocked = locked || gesture;
  useEffect(() => {
    if (panel) inspector.current?.focus();
  }, [panel]);
  function openPanel(next: Panel) {
    trigger.current = document.activeElement as HTMLElement;
    setPanel((value) => (value === next ? null : next));
  }
  function closePanel() {
    setPanel(null);
    trigger.current?.focus();
  }
  function focusCanvas() {
    root.current
      ?.querySelector<HTMLCanvasElement>(".bead-stage canvas")
      ?.focus();
  }
  function commit(label: string, after: BeadPattern) {
    if (!locked) dispatch({ type: "commit", label, after });
  }
  function propose(proposal: Proposal) {
    // Import completion may arrive while its previous render still has busy=true.
    if (state.proposal || !isPattern(proposal.after)) return;
    if (samePattern(pattern, proposal.after)) {
      notify(
        proposal.label.includes("填充")
          ? "没有可填充的格子：空心需要闭合轮廓，区域填充需要选择不同颜色。"
          : "图纸没有变化，请调整参数后重试。",
      );
      return;
    }
    dispatch({ type: "propose", proposal });
  }
  async function exportPng() {
    if (controlsLocked || exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      notify(await exportPattern(pattern));
    } catch (e) {
      notify(e instanceof Error ? e.message : "导出失败，请重新选择位置");
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }
  function undo() {
    if (!controlsLocked) dispatch({ type: "undo" });
  }
  function redo() {
    if (!controlsLocked) dispatch({ type: "redo" });
  }
  const activeTool = tools.find((t) => t.id === tool)!;
  return (
    <section
      ref={root}
      className={`bead-studio bead-workbench${focused ? " is-focused" : ""}`}
      aria-label="拼豆工坊"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest('[aria-modal="true"]')) {
          // Browser undo can otherwise edit a previously focused input behind the dialog.
          if (
            (e.ctrlKey || e.metaKey) &&
            ["z", "y"].includes(e.key.toLowerCase())
          )
            e.preventDefault();
          return;
        }
        if (e.key === "Escape" && panel && !state.proposal) {
          e.stopPropagation();
          closePanel();
          return;
        }
        if (
          e.defaultPrevented ||
          e.nativeEvent.isComposing ||
          (e.target as HTMLElement).closest(
            "input, textarea, select, [contenteditable=true]",
          )
        )
          return;
        if (controlsLocked) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) redo();
          else undo();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
          e.preventDefault();
          e.stopPropagation();
          redo();
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const next = tools.find(
          (t) => t.key.toLowerCase() === e.key.toLowerCase(),
        );
        if (next) {
          e.preventDefault();
          setTool(next.id);
          focusCanvas();
        }
      }}
    >
      <header className="bead-workbench-head">
        <div className="bead-document-heading">
          <span>拼豆工坊</span>
          <DocumentTitle
            value={pattern.title}
            disabled={controlsLocked}
            commit={(title) => commit("重命名图纸", { ...pattern, title })}
          />
          <small
            title={saveStatus}
            className={saveStatus.includes("失败") ? "is-error" : ""}
          >
            {saveStatus}
          </small>
        </div>
        <div className="bead-document-actions">
          <button
            aria-pressed={focused}
            onClick={() => {
              setFocused((v) => !v);
              setPanel(null);
            }}
            title="隐藏导航与属性面板，为画布腾出空间"
          >
            <Focus size={16} />
            <span>{focused ? "退出专注" : "专注画布"}</span>
          </button>
          <button
            className="bead-export"
            disabled={controlsLocked}
            onClick={() => void exportPng()}
          >
            <Download size={16} />
            <span>{exporting ? "导出中…" : "导出 PNG"}</span>
          </button>
        </div>
      </header>
      <div className="bead-command-bar">
        <div className="bead-tool-group" role="toolbar" aria-label="画布工具">
          {tools.map((t) => (
            <button
              key={t.id}
              disabled={controlsLocked}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              aria-keyshortcuts={t.key}
              title={`${t.label}（${t.key}）· ${t.help}`}
              onClick={() => {
                setTool(t.id);
                focusCanvas();
              }}
            >
              <t.icon size={17} />
              <span>{t.label}</span>
            </button>
          ))}
          <span className="bead-tool-divider" />
          <button
            aria-label="撤销"
            title={`撤销${state.past.at(-1) ? `：${state.past.at(-1)!.label}` : ""}（Ctrl+Z）`}
            disabled={controlsLocked || !state.past.length}
            onClick={undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            aria-label="重做"
            title="重做（Ctrl+Shift+Z）"
            disabled={controlsLocked || !state.future.length}
            onClick={redo}
          >
            <Redo2 size={17} />
          </button>
        </div>
        <button
          className="bead-current-swatch"
          aria-label={`当前豆色 ${colorCode(color, pattern)}，打开豆色面板`}
          onClick={() => openPanel("colors")}
        >
          <i style={{ background: pattern.palette[color].hex }} />
          <strong>{colorCode(color, pattern)}</strong>
          <span>{tally[color]} 颗</span>
        </button>
      </div>
      <div className="bead-panel-bar" role="toolbar" aria-label="图纸面板">
        <span className="bead-tool-context">{activeTool.help}</span>
        {panels.map((p) => (
          <button
            key={p.id}
            aria-expanded={panel === p.id}
            aria-controls={`bead-panel-${p.id}`}
            title={`打开${p.label}面板`}
            onClick={() => openPanel(p.id)}
          >
            <p.icon size={15} />
            <span>{p.label}</span>
          </button>
        ))}
      </div>
      <div className={`bead-editor-body${panel ? " has-panel" : ""}`}>
        <BeadCanvas
          pattern={pattern}
          tool={tool}
          color={color}
          labels={labels}
          contours={contours}
          locked={locked}
          onCommit={commit}
          onGesture={setGesture}
          onPick={(index) => {
            setSelection(index);
            setPanel("colors");
            notify(
              `已选中 ${colorCode(index, pattern)}；按 B 或选择画笔开始绘制`,
            );
          }}
          onFill={(point) =>
            propose({
              label: "区域填充",
              after: floodFill(pattern, point.x, point.y, color),
              message: `用 ${colorCode(color, pattern)} 替换点击位置上下左右相连的同色区域。`,
            })
          }
        />
        {panel && (
          <button
            className="bead-inspector-scrim"
            aria-label="关闭属性面板"
            onClick={closePanel}
          />
        )}
        <aside
          ref={inspector}
          hidden={!panel}
          tabIndex={-1}
          className="bead-inspector"
          role={panel ? "dialog" : undefined}
          aria-modal="false"
          aria-label={
            panel
              ? `${panels.find((p) => p.id === panel)!.label}面板`
              : undefined
          }
        >
          <header>
            <h2>{panels.find((p) => p.id === panel)?.label}</h2>
            <button aria-label="收起面板" onClick={closePanel}>
              <X size={17} />
            </button>
          </header>
          <div className="bead-inspector-scroll">
            <fieldset
              disabled={controlsLocked}
              hidden={panel !== "colors"}
              id="bead-panel-colors"
            >
              <ColorPanel
                pattern={pattern}
                color={color}
                tally={tally}
                select={setSelection}
                commit={commit}
                paint={() => {
                  setTool("paint");
                  closePanel();
                  focusCanvas();
                }}
                propose={propose}
              />
            </fieldset>
            <div hidden={panel !== "import"} id="bead-panel-import">
              <ImportPanel
                importer={importer}
                disabled={exporting || !!state.proposal || gesture}
              />
            </div>
            <fieldset
              disabled={controlsLocked}
              hidden={panel !== "shape"}
              id="bead-panel-shape"
            >
              <ShapePanel
                pattern={pattern}
                color={color}
                propose={propose}
                notify={notify}
              />
            </fieldset>
            <fieldset
              disabled={controlsLocked}
              hidden={panel !== "document"}
              id="bead-panel-document"
            >
              <DocumentPanel
                pattern={pattern}
                propose={propose}
                commit={commit}
              />
            </fieldset>
            <div
              hidden={panel !== "view"}
              id="bead-panel-view"
              className="bead-panel-content"
            >
              <h3>画布辅助</h3>
              <label className="bead-check">
                <input
                  type="checkbox"
                  checked={labels}
                  onChange={(e) => setLabels(e.target.checked)}
                />
                显示每颗豆的编号
              </label>
              <label className="bead-check">
                <input
                  type="checkbox"
                  checked={contours}
                  onChange={(e) => setContours(e.target.checked)}
                />
                高亮图案边缘
              </label>
              <p className="bead-help">
                放大后显示编号。边缘辅助线不改变豆色；同色定位图在「豆色」面板中。
              </p>
              <h3>快捷键</h3>
              <dl className="bead-shortcuts">
                {tools.map((t) => (
                  <div key={t.id}>
                    <dt>{t.label}</dt>
                    <dd>
                      <kbd>{t.key}</kbd>
                    </dd>
                  </div>
                ))}
                <div>
                  <dt>撤销 / 重做</dt>
                  <dd>Ctrl+Z / Ctrl+Shift+Z</dd>
                </div>
                <div>
                  <dt>应用全屏</dt>
                  <dd>F11</dd>
                </div>
              </dl>
              <h3>导出规则</h3>
              <p className="bead-help">
                PNG
                始终包含完整图纸、豆色编号、边缘辅助线、坐标、尺寸和用量。不会导出选色定位标记，不受当前缩放和平移影响。
              </p>
            </div>
          </div>
        </aside>
        {(notice || busy) && (
          <div className="bead-notice" role="status">
            <span>
              {busy
                ? importer.busy
                  ? "正在处理图片…"
                  : "正在导出 PNG…"
                : notice}
            </span>
            {importer.busy ? (
              <button onClick={importer.cancel}>取消</button>
            ) : (
              !busy && (
                <button aria-label="关闭操作提示" onClick={() => notify("")}>
                  <X size={14} />
                </button>
              )
            )}
          </div>
        )}
      </div>
      <footer className="bead-document-status">
        <span>
          {pattern.width} × {pattern.height} 格 <b>·</b> {total} 颗豆 <b>·</b>{" "}
          {tally.filter(Boolean).length} 色
        </span>
        <span>
          {measure.artwork
            ? `图案约 ${formatCm(measure.artwork.width)} × ${formatCm(measure.artwork.height)} cm`
            : "还没有放豆"}{" "}
          <b>·</b> {measure.pitch} mm 豆距
        </span>
      </footer>
      {state.proposal && (
        <PreviewDialog
          before={pattern}
          proposal={state.proposal}
          cancel={() => dispatch({ type: "discard" })}
          apply={() => {
            const label = state.proposal!.label;
            dispatch({ type: "apply" });
            notify(`${label}已应用，可撤销`);
          }}
        />
      )}
    </section>
  );
}
