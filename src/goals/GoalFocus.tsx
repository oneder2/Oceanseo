import { ArrowRight, Compass } from "lucide-react";
import type { PurchaseItem, Task } from "../types";
import type { LifeData } from "../life/model";
import { dateKey } from "../dateUtils";
import {
  destinations,
  actionDone,
  nextActions,
  type Action,
  type GoalState,
} from "./model";
import "./goals.css";
export default function GoalFocus({
  state,
  tasks,
  life,
  purchases = [],
  onOpen,
  onOrganize,
}: {
  state: GoalState;
  tasks: Task[];
  life: LifeData;
  purchases?: PurchaseItem[];
  onOpen: (a: Action) => void;
  onOrganize: () => void;
}) {
  const next = nextActions(state, tasks, life, undefined, purchases),
    first = next.ready[0];
  const allDone = state.actions.length > 0 && state.actions.every(a => actionDone(a, tasks, life, purchases));
  return (
    <section className="goal-focus" aria-label="现在先做">
      <div className="goal-focus-mark">
        <Compass size={25} />
      </div>
      <div className="goal-focus-main">
        <span className="goal-kicker">ONE STEP AT A TIME · 现在先做</span>
        <h2>
          {first?.task?.title ??
            (allDone ? "行动已清点，看看目标是否达成" : state.goals.length ? "先解开一个阻碍" : "把脑海里的事情先放下来")}
        </h2>
        <p>
          {first
            ? `${first.goal?.title} · 约 ${first.action.minutes} 分钟 · ${first.task?.dueDate ? `截止 ${first.task.dueDate}` : "前置条件已满足，符合当前时间与精力"}`
            : allDone
              ? "已关联的行动都有完成记录。对照目标的完成标准，再决定结束目标或补充下一步。"
            : state.goals.length
              ? "当前没有符合条件的行动。可以调整时间、精力，或处理等待中的事情。"
              : "不必先想清楚顺序。把想法交给小汐，一起找到下一步。"}
        </p>
        <div className="goal-focus-actions">
          <button
            className="primary-button"
            onClick={() => (first ? onOpen(first.action) : onOrganize())}
          >
            {first
              ? `开始 · ${destinations[first.action.destination]}`
              : allDone ? "检查目标成果" : state.goals.length
                ? "检查安排与阻碍"
                : "整理我的想法"}
            <ArrowRight size={16} />
          </button>
          {first && (
            <button className="secondary-button" onClick={onOrganize}>
              调整今天的安排
            </button>
          )}
        </div>
        {next.ready.length > 1 && (
          <div className="goal-next-list">
            之后可以做：
            {next.ready.slice(1).map((c) => (
              <button key={c.action.id} onClick={() => onOpen(c.action)}>
                {c.task?.title} · {c.action.minutes} 分钟
              </button>
            ))}
          </div>
        )}
        {!!next.blocked.length && (
          <details className="goal-waiting">
            <summary>
              {next.blocked.length} 项等待或暂缓，现在不用全部处理
            </summary>
            {next.blocked.slice(0, 6).map((c) => (
              <p key={c.action.id}>
                <strong>{c.task?.title || "关联任务缺失"}</strong> · {c.reason}
              </p>
            ))}
          </details>
        )}
        {state.goals.some(
          (g) =>
            g.status === "active" && g.reviewDate && g.reviewDate <= dateKey(),
        ) && (
          <p className="goal-review-due">
            有目标到了检查日期，可到整理台清点进展。
          </p>
        )}
      </div>
      {state.goals.length > 0 && (
        <button className="goal-focus-count" onClick={onOrganize}>
          <strong>
            {
              state.goals.filter((g) => !g.parentId && g.status === "active")
                .length
            }
          </strong>
          <span>进行中的目标</span>
          <small>{next.blocked.length} 项等待或暂缓</small>
        </button>
      )}
    </section>
  );
}
