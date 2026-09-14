import { useEffect, useRef, useState } from "react";
import { colorCode, type BeadPattern } from "./model";

export default function ColorLocator({
  pattern,
  color,
  count,
}: {
  pattern: BeadPattern;
  color: number;
  count: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    panelRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setExpanded(false);
      }
      if (event.key === "Tab") {
        event.preventDefault();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      buttonRef.current?.focus();
    };
  }, [expanded]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, 360, 240);
    ctx.fillStyle = "#f4f1fa";
    ctx.fillRect(0, 0, 360, 240);
    const cell = Math.min(320 / pattern.width, 204 / pattern.height);
    const left = (360 - pattern.width * cell) / 2,
      top = (240 - pattern.height * cell) / 2;
    pattern.cells.forEach((c, i) => {
      if (c < 0) return;
      ctx.fillStyle = c === color ? "#7457b8" : "#d6d7de";
      ctx.fillRect(
        left + (i % pattern.width) * cell,
        top + Math.floor(i / pattern.width) * cell,
        Math.max(0.8, cell - (cell >= 5 ? 1 : 0)),
        Math.max(0.8, cell - (cell >= 5 ? 1 : 0)),
      );
    });
    ctx.strokeStyle = "#b3a6c9";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      left - 2,
      top - 2,
      pattern.width * cell + 4,
      pattern.height * cell + 4,
    );
  }, [pattern, color]);
  return (
    <>
      {expanded && (
        <div
          className="bead-locator-backdrop"
          onClick={() => setExpanded(false)}
        />
      )}
      <section
        ref={panelRef}
        tabIndex={expanded ? -1 : undefined}
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded ? true : undefined}
        className={`bead-locator${expanded ? " is-expanded" : ""}`}
        aria-label="同色定位图"
      >
        <div>
          <div className="bead-locator-head">
            <span className="bead-locator-label">同色定位</span>
            <strong>
              {colorCode(color)} <span>{count} 颗</span>
            </strong>
          </div>
          <p>
            <i />
            紫色位置 = 当前色 · 灰色 = 其他豆
          </p>
          <small>主画布保持原色，定位图不导出。</small>
          {!count && <p>当前色尚未用于图案。</p>}
          <button
            ref={buttonRef}
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "收起定位图" : "放大定位图"}
          </button>
        </div>
        <canvas
          ref={ref}
          width={720}
          height={480}
          aria-label={`${colorCode(color)} 全图分布，共 ${count} 颗。紫色为当前豆色的位置，不是图案原色。`}
        />
      </section>
    </>
  );
}
