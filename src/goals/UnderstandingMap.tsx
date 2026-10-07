import { Check, CircleHelp, MessageCircle, GitBranch } from "lucide-react";
import type { Understanding } from "./conversationData";
import type { GoalState } from "./model";
import type { Task } from "../types";
import { currentProposal } from "./dialogue";
export default function UnderstandingMap({
  nodes,
  state,
  tasks,
  onDiscuss,
}: {
  nodes: Understanding[];
  state: GoalState;
  tasks: Task[];
  onDiscuss: (text: string) => void;
}) {
  const labels = { clear: "已明确", assumed: "待确认", unknown: "尚缺信息" };
  const p = currentProposal(state);
  const actions = [
    ...state.actions
      .filter((a) => !p?.plan.actions.some((x) => x.id === a.id))
      .map((a) => ({
        ...a,
        draft: tasks.find((t) => t.id === a.taskId),
        pending: false,
      })),
    ...(p?.plan.actions ?? []).map((a) => ({ ...a, pending: true })),
  ];
  const titleOf = (id: string) =>
    actions.find((a) => a.id === id)?.draft?.title || "关联事项已不可用";
  function branch(parentId: string, depth = 0): React.ReactNode {
    return nodes
      .filter((n) => n.parentId === parentId)
      .map((n) => (
        <li key={n.id} className={`understanding-node is-${n.status}`}>
          <article>
            <div>
              <span className="understanding-status">
                {n.status === "clear" ? (
                  <Check size={14} />
                ) : (
                  <CircleHelp size={14} />
                )}{" "}
                {labels[n.status]}
              </span>
              <button
                onClick={() => onDiscuss(`关于「${n.label}」，我想补充：`)}
                title="引用到对话"
                aria-label={`讨论${n.label}`}
              >
                <MessageCircle size={16} />
              </button>
            </div>
            <strong>{n.label}</strong>
            <p>{n.evidence || "依据尚待补充"}</p>
          </article>
          {depth < 80 && nodes.some((x) => x.parentId === n.id) && (
            <ul>{branch(n.id, depth + 1)}</ul>
          )}
        </li>
      ));
  }
  return (
    <div className="gc-scroll understanding-body">
      <p className="gc-muted">
        这是小汐目前的理解。需要纠正时，点节点旁的对话图标，继续用文字说明。
      </p>
      <div className="understanding-legend">
        <span>● 已明确</span>
        <span>◐ 待确认</span>
        <span>○ 尚缺信息</span>
      </div>
      {!nodes.length ? (
        <div className="gc-empty">
          <GitBranch size={30} />
          <h3>聊一聊，线索就会慢慢清楚</h3>
          <p>对话后在这里呈现目标、约束和仍需补充的信息。</p>
        </div>
      ) : (
        <ul className="understanding-tree">{branch("")}</ul>
      )}
      {!!(p?.plan.goals.length || state.goals.length) && (
        <section className="understanding-relations">
          <h3>目标与行动关系</h3>
          {[
            ...state.goals.filter(
              (g) => !p?.plan.goals.some((x) => x.id === g.id),
            ),
            ...(p?.plan.goals ?? []),
          ].map((g) => (
            <div key={g.id}>
              <strong>
                {g.parentId ? "↳ " : ""}
                {g.title}
              </strong>
              <small>{g.criterion || "完成标准待补充"}</small>
              {actions
                .filter((a) => a.goalId === g.id)
                .map((a) => (
                  <p key={a.id}>
                    ↳ {a.draft?.title || "关联事项已不可用"}
                    {a.pending ? " · 待执行" : " · 已保存"}
                    {` · ${a.minutes} 分钟`}
                    {a.draft?.dueDate ? ` · 截止 ${a.draft.dueDate}` : ""}
                    {a.dependsOn.length
                      ? ` · 前置事项：${a.dependsOn.map(titleOf).join("、")}`
                      : ""}
                  </p>
                ))}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
