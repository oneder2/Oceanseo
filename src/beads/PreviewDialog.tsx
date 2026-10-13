import { useEffect, useRef } from "react";
import { counts, type BeadPattern } from "./model";
import { drawPattern } from "./render";
import type { Proposal } from "./document";
import { patternImpact, WORK_HISTORY_LIMIT, type BeadWork } from "./works";

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
  work,
  restoreProgress,
}: {
  before: BeadPattern;
  proposal: Proposal;
  apply: () => void;
  cancel: () => void;
  work?: BeadWork;
  restoreProgress?: number;
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
  const impact = patternImpact(before, proposal.after);
  const retained = restoreProgress ?? (impact.progressCompatible ? work?.completedCells.length ?? 0 : 0);
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
        <table className="bead-change-summary"><caption>变更摘要</caption><tbody>
          <tr><th scope="row">网格</th><td>{before.width} × {before.height} → {proposal.after.width} × {proposal.after.height}</td></tr>
          <tr><th scope="row">使用颜色</th><td>{counts(before).filter(Boolean).length} → {counts(proposal.after).filter(Boolean).length} 色</td></tr>
          <tr><th scope="row">变化格点</th><td>{impact.changed} 个{impact.cropped > 0 && `，其中 ${impact.cropped} 颗被裁去`}</td></tr>
          <tr><th scope="row">拼放记录</th><td>当前 {work?.completedCells.length ?? 0} 颗 → 应用后 {retained} 颗</td></tr>
        </tbody></table>
        {work && <p className="bead-progress-impact">{restoreProgress !== undefined ? "恢复版本会带回当时记录的完成标记。"
          : impact.progressCompatible ? "格点和豆色一致，保留已有拼放标记。" : "新图纸从零记录拼放进度；原完成记录会保存在旧版本，可通过作品记录恢复。"}</p>}
        {work && work.versions.length >= WORK_HISTORY_LIMIT && <p className="bead-history-limit">最多保留最近 {WORK_HISTORY_LIMIT} 个版本。本次确认后，最早的版本会移出记录；长期保留请先导出作品文件或备份。</p>}
        <p className="bead-preview-delta">
          豆数变化：{delta >= 0 ? "+" : ""}
          {delta} 颗 · {restoreProgress !== undefined ? "确认后另存版本，可从作品记录恢复" : "应用后可整体撤销"}
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
