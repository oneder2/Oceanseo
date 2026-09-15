import { useEffect, useRef } from "react";
import { counts, type BeadPattern } from "./model";
import { drawPattern } from "./render";
import type { Proposal } from "./document";

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
export default function PreviewDialog({
  before,
  proposal,
  apply,
  cancel,
}: {
  before: BeadPattern;
  proposal: Proposal;
  apply: () => void;
  cancel: () => void;
}) {
  const ref = useRef<HTMLElement>(null),
    cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        cancelRef.current();
      }
      if (event.key === "Tab") {
        const buttons = ref.current?.querySelectorAll("button");
        if (!buttons?.length) return;
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const total = (p: BeadPattern) => counts(p).reduce((a, b) => a + b, 0);
  const delta = total(proposal.after) - total(before);
  return (
    <div
      className="bead-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="确认图纸变更"
        className="bead-preview-modal"
      >
        <header>
          <span>确认修改</span>
          <h2>{proposal.label}</h2>
        </header>
        <div className="bead-preview-pair">
          {[
            { label: "修改前", pattern: before },
            { label: "应用后", pattern: proposal.after },
          ].map((p) => (
            <figure key={p.label}>
              <figcaption>
                {p.label} · {p.pattern.width}×{p.pattern.height} 格 ·{" "}
                {total(p.pattern)} 颗
              </figcaption>
              <Preview pattern={p.pattern} />
            </figure>
          ))}
        </div>
        <p>{proposal.message}</p>
        <p className="bead-preview-delta">
          豆数变化：{delta >= 0 ? "+" : ""}
          {delta} 颗 · 应用后可整体撤销
        </p>
        <footer>
          <button className="secondary-button" onClick={cancel}>
            取消
          </button>
          <button className="bead-action" onClick={apply}>
            应用图纸
          </button>
        </footer>
      </section>
    </div>
  );
}
