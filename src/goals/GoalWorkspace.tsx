import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Compass,
  Plus,
  Sparkles,
} from "lucide-react";
import DatePicker from "../DatePicker";
import { dateKey } from "../dateUtils";
import { useDraft } from "../drafts";
import { useJob, reviewResult } from "../life/agent";
import type { LifeData } from "../life/model";
import type { PurchaseItem, Task } from "../types";
import type { GoalController } from "./store";
import {
  destinations,
  goalSnapshot,
  isPlan,
  localReview,
  mergedPlan,
  nextActions,
  actionDone,
  type Action,
  type Goal,
  type Plan,
  type PlanAction,
  type Proposal,
} from "./model";
import { planningContext, type Target } from "./context";
import GoalFocus from "./GoalFocus";
import { conditionLines } from "./handoff";
import "./goals.css";

interface Props {
  purchases?: PurchaseItem[];
  controller: GoalController;
  tasks: Task[];
  life: LifeData;
  targets: Target[];
  configured: boolean;
  onSettings: () => void;
  onOpen: (a: Action) => void;
  onTask: (t: Task) => void;
  onComplete: (id: string) => void;
}
export default function GoalWorkspace({
  controller: c,
  tasks,
  life,
  purchases = [],
  targets,
  configured,
  onSettings,
  onOpen,
  onTask,
  onComplete,
}: Props) {
  const s = c.state;
  const [tab, setTab] = useState<"inbox" | "goals" | "review">("inbox"),
    [message, setMessage] = useState(""),
    [shareNotes, setShareNotes] = useState(false),
    [proposalId, setProposalId] = useState(""),
    [undoConfirm, setUndoConfirm] = useState(false);
  const raw = useDraft<string>("goal-input", () => s.draft),
    note = useDraft<string>("goal-review-note", () => "");
  const job = useJob(),
    pending = s.proposals.filter((p) => p.status === "pending"),
    proposal = pending.find((p) => p.id === proposalId) ?? pending.at(-1);
  const next = nextActions(s, tasks, life, undefined, purchases),
    context = planningContext(s, tasks, targets, shareNotes),
    latest = useRef({ tasks, targets });
  latest.current = { tasks, targets };
  useEffect(() => {
    if (
      s.goals.length &&
      !s.thoughts.some((t) => t.status === "inbox") &&
      !pending.length
    )
      setTab("goals");
  }, []);
  async function capture() {
    if (!raw.value.trim()) return s;
    const value = raw.value.trim();
    const saved = await c.update((s) => ({
      ...s,
      draft: "",
      thoughts: [
        ...s.thoughts,
        {
          id: crypto.randomUUID(),
          text: value,
          status: "inbox",
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    raw.set("");
    raw.clear("");
    return saved;
  }
  async function organize() {
    if (!isTauri()) {
      setMessage(
        "浏览器预览不连接 AI。可手动建立方案，或在已安装的桌面应用中整理。",
      );
      return;
    }
    if (!configured) {
      onSettings();
      return;
    }
    await job.run(
      "小汐正在梳理目标和先后关系…",
      async () => {
        const saved = await capture();
        if (!saved.thoughts.some((t) => t.status === "inbox"))
          throw Error("先记录一些想法，或把已有想法移回收集箱");
        const snapshotTasks = [...latest.current.tasks];
        const value = await invoke<unknown>("run_planning_agent", {
          kind: "goals",
          context: planningContext(
            saved,
            snapshotTasks,
            latest.current.targets,
            shareNotes,
          ),
        });
        if (!isPlan(value)) throw Error("整理结果格式无效，原始想法已保留");
        const merged = mergedPlan(saved, value);
        if (merged.error) throw Error(merged.error);
        const p: Proposal = {
          id: crypto.randomUUID(),
          sourceIds: saved.thoughts
            .filter((t) => t.status === "inbox")
            .map((t) => t.id),
          createdAt: new Date().toISOString(),
          goalSnapshot: goalSnapshot(saved),
          taskVersions: Object.fromEntries(
            snapshotTasks.map((t) => [t.id, t.updatedAt]),
          ),
          status: "pending",
          plan: value,
        };
        return p;
      },
      (p) => {
        void c
          .update((current) => ({
            ...current,
            proposals: [...current.proposals, p],
          }))
          .then(() => {
            setProposalId(p.id);
            setTab("inbox");
          })
          .catch(() => {});
      },
    );
  }
  function manualPlan() {
    const id = crypto.randomUUID();
    const p: Proposal = {
      id,
      sourceIds: s.thoughts
        .filter((t) => t.status === "inbox")
        .map((t) => t.id),
      createdAt: new Date().toISOString(),
      goalSnapshot: goalSnapshot(s),
      taskVersions: Object.fromEntries(tasks.map((t) => [t.id, t.updatedAt])),
      status: "pending",
      plan: {
        summary: "从一个小目标开始",
        questions: [],
        assumptions: [],
        later: [],
        goals: [
          {
            id: crypto.randomUUID(),
            parentId: "",
            title: "我的目标",
            criterion: "",
            status: "active",
            reviewDate: "",
          },
        ],
        actions: [],
      },
    };
    c.edit((s) => ({ ...s, proposals: [...s.proposals, p] }));
    setProposalId(id);
    setTab("inbox");
  }
  function adjustGoal(g: Goal) {
    const actions = s.actions
      .filter((a) => a.goalId === g.id)
      .map((a) => {
        const t = tasks.find((t) => t.id === a.taskId);
        const { taskId, ...meta } = a;
        return {
          ...meta,
          existingTaskId: t ? taskId : "",
          draft: {
            title: t?.title || "重新关联行动",
            notes: t?.notes || "",
            horizon: t?.horizon || "short",
            priority: t?.priority || "normal",
            startDate: t?.startDate || "",
            dueDate: t?.dueDate || "",
          },
        } as PlanAction;
      });
    const p: Proposal = {
      id: crypto.randomUUID(),
      sourceIds: [],
      createdAt: new Date().toISOString(),
      goalSnapshot: goalSnapshot(s),
      taskVersions: Object.fromEntries(tasks.map((t) => [t.id, t.updatedAt])),
      status: "pending",
      plan: {
        summary: `调整目标：${g.title}。复用原行动，原任务内容保持由任务编辑器管理。`,
        questions: [],
        assumptions: [],
        later: [],
        goals: [g],
        actions,
      },
    };
    c.edit((s) => ({ ...s, proposals: [...s.proposals, p] }));
    setProposalId(p.id);
    setTab("inbox");
  }
  function editPlan(fn: (p: Plan) => Plan) {
    if (!proposal) return;
    c.edit((s) => ({
      ...s,
      proposals: s.proposals.map((p) =>
        p.id === proposal.id ? { ...p, plan: fn(p.plan) } : p,
      ),
    }));
  }
  const editGoal = (id: string, patch: Partial<Goal>) =>
    editPlan((p) => ({
      ...p,
      goals: p.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }));
  const editAction = (id: string, patch: Partial<PlanAction>) =>
    editPlan((p) => ({
      ...p,
      actions: p.actions.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  function addAction(goalId: string) {
    editPlan((p) => ({
      ...p,
      actions: [
        ...p.actions,
        {
          id: crypto.randomUUID(),
          goalId,
          existingTaskId: "",
          dependsOn: [],
          minutes: 25,
          energy: "normal",
          blocker: "",
          deferredUntil: "",
          destination: "task",
          targetId: "",
          targetDate: "",
          draft: {
            title: "下一步行动",
            notes: "",
            horizon: "short",
            priority: "normal",
            startDate: "",
            dueDate: "",
          },
        },
      ],
    }));
  }
  function patchAction(id: string, patch: Partial<Action>) {
    c.edit((s) => ({
      ...s,
      actions: s.actions.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  }
  async function review(kind: "morning" | "evening" | "weekly", ai = false) {
    const entry = localReview(s, tasks, life, kind, purchases);
    entry.note = note.value;
    if (ai) {
      if (!configured) {
        onSettings();
        return;
      }
      await job.run(
        "正在对照实际记录复盘…",
        async () => {
          if (!isTauri()) throw Error("请在桌面应用中使用 AI 复盘");
          const value = await invoke("run_planning_agent", {
            kind: "goal_review",
            context: { ...context, actual: entry.text, userNote: note.value },
          });
          return reviewResult(value);
        },
        (text) => {
          void c
            .update((s) => ({
              ...s,
              reviews: [
                ...s.reviews.slice(-199),
                { ...entry, text, source: "ai" },
              ],
            }))
            .then(() => {
              note.clear();
              setMessage(
                "复盘已保存；建议尚未改变计划，可写入收集箱继续整理。",
              );
            })
            .catch(() => {});
        },
      );
    } else
      await c
        .update((s) => ({ ...s, reviews: [...s.reviews.slice(-199), entry] }))
        .then(() => {
          note.clear();
          setMessage("清点已保存");
        });
  }
  if (!c.loaded) return (
    <section className="goal-workspace">
      <p role={c.error ? "alert" : "status"}>{c.error || "正在读取目标与想法…"}</p>
      {c.error && <button className="secondary-button" disabled={c.busy} onClick={() => void c.recoverLatest()}>重新读取目标数据</button>}
    </section>
  );
  return (
    <section className="goal-workspace" aria-label="想法与目标">
      <nav className="goal-tabs" aria-label="整理台导航">
        {(
          [
            ["inbox", "收集与整理"],
            ["goals", "目标与行动"],
            ["review", "复盘与节奏"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
            {id === "inbox" && (
              <small>
                {s.thoughts.filter((t) => t.status === "inbox").length}
              </small>
            )}
          </button>
        ))}
        <span>{c.busy ? "正在保存…" : "本机记录"}</span>
      </nav>
      {(c.error || message || job.message || raw.error) && (
        <p role={c.error ? "alert" : "status"} className="goal-message">
          {c.error || raw.error || job.message || message}
        </p>
      )}
      {c.error && isTauri() && (
        <div className="goal-buttons">
          <button disabled={c.busy} onClick={() => void c.retry()}>
            重试待写请求
          </button>
          <button disabled={c.busy} onClick={() => void c.recoverLatest()}>
            保留恢复副本并重读数据
          </button>
        </div>
      )}
      {tab === "inbox" && (
        <div className="goal-organizer">
          <aside className="goal-paper goal-inbox">
            <span className="goal-kicker">先放下来，再慢慢理清</span>
            <h2>此刻，脑海里有什么？</h2>
            <p>工作、生活、担心的事，都可以直接写。暂时不用决定顺序。</p>
            <label className="sr-only" htmlFor="goal-thought">
              原始想法与补充
            </label>
            <textarea
              id="goal-thought"
              maxLength={12000}
              value={raw.value}
              onChange={(e) => raw.set(e.target.value)}
              placeholder="例如：发布还没验收，想恢复训练，周末要买菜……我现在不知道先做什么。"
            />
            <div className="goal-buttons">
              <button
                className="secondary-button"
                disabled={c.busy || !raw.value.trim()}
                onClick={() => void capture().catch(() => {})}
              >
                <Plus size={15} />
                存入收集箱
              </button>
              <button
                className="primary-button"
                disabled={job.busy || c.busy}
                onClick={() => void organize()}
              >
                <Sparkles size={15} />
                请小汐梳理
              </button>
            </div>
            {job.busy && (
              <button onClick={job.cancel}>停止等待，保留想法</button>
            )}
            <details className="goal-sharing">
              <summary>本次会分享什么</summary>
              <p>
                收集箱原文、目标关系、任务摘要及业务对象名称会发送给共用 AI
                服务。人物档案、项目源码和路径不包含在内。
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={shareNotes}
                  onChange={(e) => setShareNotes(e.target.checked)}
                />
                同时分享任务记事本（本次）
              </label>
              <pre>{JSON.stringify(context, null, 2)}</pre>
            </details>
            <div className="goal-thoughts">
              {[...s.thoughts].reverse().map((t) => (
                <article key={t.id}>
                  <small>
                    {new Date(t.createdAt).toLocaleDateString()} ·{" "}
                    {t.status === "inbox"
                      ? "待整理"
                      : t.status === "later"
                        ? "以后再说"
                        : "已有整理方案"}
                  </small>
                  <p>{t.text}</p>
                  <button
                    onClick={() =>
                      c.edit((s) => ({
                        ...s,
                        thoughts: s.thoughts.map((x) =>
                          x.id === t.id
                            ? {
                                ...x,
                                status:
                                  t.status === "inbox" ? "later" : "inbox",
                              }
                            : x,
                        ),
                      }))
                    }
                  >
                    {t.status === "inbox" ? "先放一放" : "放回收集箱"}
                  </button>
                </article>
              ))}
            </div>
          </aside>
          <div className="goal-plan-area">
            <header className="goal-section-head">
              <div>
                <span className="goal-kicker">从线索到方向</span>
                <h2>一起看清下一步</h2>
              </div>
              <button className="secondary-button" onClick={manualPlan}>
                <Plus size={15} />
                手动建一个目标
              </button>
            </header>
            {!proposal ? (
              <div className="goal-empty">
                <Compass size={38} />
                <h3>一个方向，也可以很轻。</h3>
                <p>
                  小汐会提出目标、完成标准和行动顺序。你可以调整后，一次并入应用。
                </p>
              </div>
            ) : (
              <>
                {pending.length > 1 && (
                  <label>
                    继续哪份方案
                    <select
                      value={proposal.id}
                      onChange={(e) => setProposalId(e.target.value)}
                    >
                      {pending.map((p) => (
                        <option key={p.id} value={p.id}>
                          {new Date(p.createdAt).toLocaleString()} ·{" "}
                          {p.plan.summary.slice(0, 24)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="goal-plan-summary">
                  <p>{proposal.plan.summary}</p>
                  {proposal.plan.assumptions.length > 0 && (
                    <details>
                      <summary>
                        采用了 {proposal.plan.assumptions.length} 项假设
                      </summary>
                      {proposal.plan.assumptions.map((a, i) => (
                        <p key={i}>{a}</p>
                      ))}
                    </details>
                  )}
                  {proposal.plan.questions.length > 0 && (
                    <div className="goal-questions">
                      <strong>先确认这几件事</strong>
                      {proposal.plan.questions.map((q, i) => (
                        <p key={i}>
                          {i + 1}. {q}
                        </p>
                      ))}
                      <p>
                        把回答补充到左侧，再请小汐梳理；确认前不会创建任务。
                      </p>
                    </div>
                  )}
                  {proposal.plan.later.length > 0 && (
                    <details>
                      <summary>这些可以暂时放下</summary>
                      {proposal.plan.later.map((x, i) => (
                        <p key={i}>{x}</p>
                      ))}
                    </details>
                  )}
                </div>
                {proposal.plan.goals.map((g) => (
                  <article
                    className={`goal-plan-node ${g.parentId ? "is-child" : ""}`}
                    key={g.id}
                  >
                    <div className="goal-node-label">
                      <span>
                        {s.goals.some((old) => old.id === g.id)
                          ? "调整已有目标"
                          : g.parentId
                            ? "子目标"
                            : "目标"}
                      </span>
                      <button
                        aria-label={`移除目标 ${g.title}`}
                        onClick={() =>
                          editPlan((p) => ({
                            ...p,
                            goals: p.goals.filter((x) => x.id !== g.id),
                            actions: p.actions.filter((a) => a.goalId !== g.id),
                          }))
                        }
                      >
                        移除
                      </button>
                    </div>
                    <label>
                      目标名称
                      <input
                        aria-label={`目标名称 ${g.id}`}
                        key={`${g.id}-title`}
                        defaultValue={g.title}
                        maxLength={200}
                        onBlur={(e) => {
                          if (e.target.value.trim())
                            editGoal(g.id, { title: e.target.value });
                        }}
                      />
                    </label>
                    <label>
                      做到什么算完成
                      <textarea
                        defaultValue={g.criterion}
                        maxLength={2000}
                        placeholder="例如：旧版数据能升级并恢复，真实 AI 调用通过"
                        onBlur={(e) =>
                          editGoal(g.id, { criterion: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      采用后的目标状态
                      <select
                        value={g.status}
                        onChange={(e) =>
                          editGoal(g.id, {
                            status: e.target.value as Goal["status"],
                          })
                        }
                      >
                        <option value="active">推进中</option>
                        <option value="paused">先暂停</option>
                        {s.goals.some((old) => old.id === g.id) && (
                          <option value="completed">完成标准已达成</option>
                        )}
                      </select>
                    </label>
                    <div className="goal-fields">
                      <label>
                        上级目标
                        <select
                          value={g.parentId}
                          onChange={(e) =>
                            editGoal(g.id, { parentId: e.target.value })
                          }
                        >
                          <option value="">独立目标</option>
                          {[
                            ...s.goals.filter(
                              (x) =>
                                !proposal.plan.goals.some((g) => g.id === x.id),
                            ),
                            ...proposal.plan.goals,
                          ]
                            .filter((x) => x.id !== g.id)
                            .map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.title}
                              </option>
                            ))}
                        </select>
                      </label>
                      <DatePicker
                        label="下次检查"
                        value={g.reviewDate}
                        onChange={(reviewDate) =>
                          editGoal(g.id, { reviewDate })
                        }
                      />
                    </div>
                    <div className="goal-buttons">
                      <button
                        onClick={() =>
                          editPlan((p) => ({
                            ...p,
                            goals: [
                              ...p.goals,
                              {
                                id: crypto.randomUUID(),
                                title: "子目标",
                                criterion: "",
                                parentId: g.id,
                                status: "active",
                                reviewDate: "",
                              },
                            ],
                          }))
                        }
                      >
                        ＋ 子目标
                      </button>
                      <button onClick={() => addAction(g.id)}>
                        ＋ 下一步行动
                      </button>
                    </div>
                  </article>
                ))}
                {proposal.plan.actions.map((a, index) => (
                  <article className="goal-action-editor" key={a.id}>
                    <header>
                      <span>行动 {index + 1}</span>
                      <button
                        onClick={() =>
                          editPlan((p) => ({
                            ...p,
                            actions: p.actions
                              .filter((x) => x.id !== a.id)
                              .map((x) => ({
                                ...x,
                                dependsOn: x.dependsOn.filter(
                                  (id) => id !== a.id,
                                ),
                              })),
                          }))
                        }
                      >
                        移除
                      </button>
                    </header>
                    <label>
                      关联已有任务
                      <select
                        value={a.existingTaskId}
                        onChange={(e) => {
                          const t = tasks.find((t) => t.id === e.target.value);
                          editAction(a.id, {
                            existingTaskId: e.target.value,
                            ...(t
                              ? {
                                  draft: {
                                    title: t.title,
                                    notes: t.notes,
                                    horizon: t.horizon,
                                    priority: t.priority,
                                    startDate: t.startDate,
                                    dueDate: t.dueDate,
                                  },
                                }
                              : {}),
                          });
                        }}
                      >
                        <option value="">创建新任务</option>
                        {tasks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                            {t.completedAt ? "（已完成）" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      具体做什么
                      <input
                        defaultValue={a.draft.title}
                        key={a.existingTaskId || "new"}
                        disabled={!!a.existingTaskId}
                        maxLength={200}
                        onBlur={(e) => {
                          if (e.target.value.trim())
                            editAction(a.id, {
                              draft: { ...a.draft, title: e.target.value },
                            });
                        }}
                      />
                    </label>
                    {!a.existingTaskId && (
                      <label>
                        行动说明
                        <textarea
                          defaultValue={a.draft.notes}
                          maxLength={4000}
                          onBlur={(e) =>
                            editAction(a.id, {
                              draft: { ...a.draft, notes: e.target.value },
                            })
                          }
                        />
                      </label>
                    )}
                    <div className="goal-fields">
                      <label>
                        所属目标
                        <select
                          value={a.goalId}
                          onChange={(e) =>
                            editAction(a.id, { goalId: e.target.value })
                          }
                        >
                          {mergedPlan(s, proposal.plan).goals.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        预计分钟
                        <input
                          type="number"
                          min={5}
                          max={1440}
                          defaultValue={a.minutes}
                          onBlur={(e) =>
                            editAction(a.id, {
                              minutes: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        所需精力
                        <select
                          value={a.energy}
                          onChange={(e) =>
                            editAction(a.id, {
                              energy: e.target.value as Action["energy"],
                            })
                          }
                        >
                          <option value="low">轻松</option>
                          <option value="normal">一般</option>
                          <option value="high">专注</option>
                        </select>
                      </label>
                    </div>
                    {!a.existingTaskId && (
                      <div className="goal-fields">
                        <DatePicker
                          label="安排开始"
                          value={a.draft.startDate}
                          onChange={(startDate) =>
                            editAction(a.id, {
                              draft: { ...a.draft, startDate },
                            })
                          }
                        />
                        <DatePicker
                          label="截止日期"
                          value={a.draft.dueDate}
                          onChange={(dueDate) =>
                            editAction(a.id, { draft: { ...a.draft, dueDate } })
                          }
                        />
                        <label>
                          重要程度
                          <select
                            value={a.draft.priority}
                            onChange={(e) =>
                              editAction(a.id, {
                                draft: {
                                  ...a.draft,
                                  priority: e.target.value as
                                    "normal" | "important",
                                },
                              })
                            }
                          >
                            <option value="normal">普通</option>
                            <option value="important">重要</option>
                          </select>
                        </label>
                      </div>
                    )}
                    <details>
                      <summary>先后关系与执行入口</summary>
                      {conditionLines(a.conditions).length > 0 && (
                        <div className="goal-conditions">
                          <strong>会带入业务页面的条件</strong>
                          {conditionLines(a.conditions).map((line, i) => (
                            <p key={i}>{line}</p>
                          ))}
                          <small>进入对应页面后仍可检查和修改。</small>
                        </div>
                      )}
                      <label>
                        等待哪些行动
                        <select
                          multiple
                          value={a.dependsOn}
                          onChange={(e) =>
                            editAction(a.id, {
                              dependsOn: Array.from(
                                e.target.selectedOptions,
                                (o) => o.value,
                              ),
                            })
                          }
                        >
                          {[
                            ...s.actions
                              .filter(
                                (x) =>
                                  !proposal.plan.actions.some(
                                    (a) => a.id === x.id,
                                  ),
                              )
                              .map((x) => ({
                                id: x.id,
                                title:
                                  tasks.find((t) => t.id === x.taskId)?.title ||
                                  x.id,
                              })),
                            ...proposal.plan.actions.map((x) => ({
                              id: x.id,
                              title: x.draft.title,
                            })),
                          ]
                            .filter((x) => x.id !== a.id)
                            .map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.title}
                              </option>
                            ))}
                        </select>
                      </label>
                      <small>按住 Ctrl 可多选或取消选择。</small>
                      <TargetFields
                        action={a}
                        targets={targets}
                        onChange={(patch) => editAction(a.id, patch)}
                      />
                      <label>
                        当前阻碍
                        <input
                          defaultValue={a.blocker}
                          maxLength={1000}
                          onBlur={(e) =>
                            editAction(a.id, { blocker: e.target.value })
                          }
                        />
                      </label>
                    </details>
                  </article>
                ))}
                <div className="goal-apply">
                  <p>
                    {mergedPlan(s, proposal.plan).error ||
                      `${proposal.plan.goals.length} 个目标节点 · ${proposal.plan.actions.filter((a) => !a.existingTaskId).length} 项新任务 · ${proposal.plan.actions.filter((a) => a.existingTaskId).length} 项复用任务`}
                  </p>
                  <button
                    className="primary-button"
                    disabled={
                      c.busy ||
                      job.busy ||
                      !!proposal.plan.questions.length ||
                      !!mergedPlan(s, proposal.plan).error ||
                      (!proposal.plan.goals.length &&
                        !proposal.plan.actions.length)
                    }
                    onClick={() =>
                      void c
                        .apply(proposal.id)
                        .then(() => {
                          setMessage(
                            "方案已采用，目标和行动已保存。现在可以开始第一步。",
                          );
                          setTab("goals");
                        })
                        .catch(() => {})
                    }
                  >
                    <Check size={16} />
                    采用整份方案
                  </button>
                  <button
                    disabled={c.busy || job.busy}
                    onClick={() =>
                      c.edit((s) => ({
                        ...s,
                        proposals: s.proposals.filter(
                          (p) => p.id !== proposal.id,
                        ),
                      }))
                    }
                  >
                    移除这份草案，保留原文
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {tab === "goals" && (
        <>
          <GoalFocus
            state={s}
            tasks={tasks}
            life={life}
            purchases={purchases}
            onOpen={onOpen}
            onOrganize={() => setTab(s.goals.length ? "review" : "inbox")}
          />
          {s.undo && s.undo.revision === s.revision && (
            <div className="goal-undo">
              最近一份方案已保存。
              <button onClick={() => setUndoConfirm(!undoConfirm)}>
                撤销这次采用
              </button>
              {undoConfirm && (
                <span>
                  将移除本次新建目标关系及 {s.undo.createdTasks.length}{" "}
                  项尚未修改的新任务。
                  <button
                    onClick={() =>
                      void c
                        .undo()
                        .then(() => {
                          setUndoConfirm(false);
                          setMessage("已撤销本次方案，原始想法已放回收集箱。");
                        })
                        .catch(() => {})
                    }
                  >
                    确认撤销
                  </button>
                </span>
              )}
            </div>
          )}
          <div className="goal-tree">
            {s.goals.map((g) => (
              <article
                key={g.id}
                className={`goal-paper ${g.parentId ? "is-child" : ""}`}
              >
                <header className="goal-section-head">
                  <div>
                    <small>
                      {g.parentId
                        ? s.goals.find((p) => p.id === g.parentId)?.title
                        : "目标"}
                    </small>
                    <h3>{g.title}</h3>
                  </div>
                  <select
                    aria-label={`${g.title}的状态`}
                    value={g.status}
                    onChange={(e) =>
                      c.edit((s) => ({
                        ...s,
                        goals: s.goals.map((x) =>
                          x.id === g.id
                            ? { ...x, status: e.target.value as Goal["status"] }
                            : x,
                        ),
                      }))
                    }
                  >
                    <option value="active">推进中</option>
                    <option value="paused">先暂停</option>
                    <option value="completed">完成标准已达成</option>
                  </select>
                </header>
                <p className="goal-criterion">
                  完成标准：{g.criterion || "尚未明确，可重新整理补充"}
                </p>
                <small>
                  行动{" "}
                  {
                    s.actions.filter(
                      (a) =>
                        a.goalId === g.id &&
                        actionDone(a, tasks, life, purchases),
                    ).length
                  }
                  /{s.actions.filter((a) => a.goalId === g.id).length}{" "}
                  已记录完成 ·{" "}
                  {g.reviewDate ? `检查日期 ${g.reviewDate}` : "未设检查日期"}
                </small>
                {s.actions
                  .filter((a) => a.goalId === g.id)
                  .map((a) => {
                    const t = tasks.find((t) => t.id === a.taskId),
                      blocked = next.blocked.find((b) => b.action.id === a.id);
                    return (
                      <div className="goal-live-action" key={a.id}>
                        <div className="goal-live-title">
                          <button
                            className="goal-check"
                            disabled={!t}
                            aria-label={`${t?.title || "任务缺失"}的完成状态`}
                            onClick={() => t && onComplete(t.id)}
                          >
                            {actionDone(a, tasks, life, purchases) ? (
                              <Check size={18} />
                            ) : (
                              <span />
                            )}
                          </button>
                          <button onClick={() => onOpen(a)}>
                            <strong>
                              {t?.title || "任务已删除，请重新关联"}
                            </strong>
                            <small>
                              {a.minutes} 分钟 · {destinations[a.destination]}
                              {blocked ? ` · ${blocked.reason}` : ""}
                            </small>
                          </button>
                          <button
                            aria-label={`打开${t?.title || "行动"}记事本`}
                            disabled={!t}
                            onClick={() => t && onTask(t)}
                          >
                            <ChevronRight size={18} />
                          </button>
                        </div>
                        <details>
                          <summary>调整阻碍、暂缓与入口</summary>
                          <label>
                            阻碍说明
                            <input
                              defaultValue={a.blocker}
                              maxLength={1000}
                              onBlur={(e) =>
                                patchAction(a.id, { blocker: e.target.value })
                              }
                            />
                          </label>
                          <DatePicker
                            label="暂缓至"
                            value={a.deferredUntil}
                            onChange={(deferredUntil) =>
                              patchAction(a.id, { deferredUntil })
                            }
                          />
                          <TargetFields
                            action={a}
                            targets={targets}
                            onChange={(patch) => patchAction(a.id, patch)}
                          />
                        </details>
                      </div>
                    );
                  })}
                <div className="goal-buttons">
                  <button
                    className="goal-rethink"
                    onClick={() => {
                      raw.set(
                        `请调整目标“${g.title}”（id: ${g.id}）。我的补充：`,
                      );
                      setTab("inbox");
                    }}
                  >
                    和小汐重新整理这个目标 <ArrowRight size={14} />
                  </button>
                  <button onClick={() => adjustGoal(g)}>
                    编辑目标与行动关系
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!s.goals.length && (
            <button
              className="secondary-button"
              onClick={() => setTab("inbox")}
            >
              开始整理第一个目标
            </button>
          )}
        </>
      )}
      {tab === "review" && (
        <div className="goal-review-grid">
          <section className="goal-paper">
            <h2>按今天的状态来</h2>
            <div className="goal-fields">
              <label>
                可用时间（分钟）
                <input
                  type="number"
                  min={5}
                  max={1440}
                  defaultValue={s.preferences.minutes}
                  onBlur={(e) => {
                    const minutes = Number(e.target.value);
                    c.edit((s) => ({
                      ...s,
                      preferences: { ...s.preferences, minutes },
                    }));
                  }}
                />
              </label>
              <label>
                现在的精力
                <select
                  value={s.preferences.energy}
                  onChange={(e) => {
                    const energy = e.target.value as Action["energy"];
                    c.edit((s) => ({
                      ...s,
                      preferences: { ...s.preferences, energy },
                    }));
                  }}
                >
                  <option value="low">只想做轻松的事</option>
                  <option value="normal">一般</option>
                  <option value="high">可以集中精力</option>
                </select>
              </label>
              <label>
                最多推荐几件
                <input
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={s.preferences.dailyLimit}
                  onBlur={(e) => {
                    const dailyLimit = Number(e.target.value);
                    c.edit((s) => ({
                      ...s,
                      preferences: { ...s.preferences, dailyLimit },
                    }));
                  }}
                />
              </label>
            </div>
            <p>
              建议总时长不超过可用时间。截止日期、重要程度和能解锁的后续行动会影响推荐顺序。
            </p>
            <h3>告诉小汐实际发生了什么</h3>
            <textarea
              aria-label="复盘补充"
              maxLength={4000}
              value={note.value}
              onChange={(e) => note.set(e.target.value)}
              placeholder="今天完成了什么？哪里卡住了？有什么决定需要记住？"
            />
            <div className="goal-buttons">
              <button onClick={() => void review("morning").catch(() => {})}>
                晨间安排
              </button>
              <button onClick={() => void review("evening").catch(() => {})}>
                晚间清点
              </button>
              <button
                className="primary-button"
                disabled={job.busy}
                onClick={() => void review("weekly", true)}
              >
                请小汐复盘
              </button>
            </div>
            <p>
              AI
              复盘发送当前摘要和这段补充，只提出建议。需要改计划时，将建议送回收集箱继续整理。
            </p>
            <details>
              <summary>自动化与提醒范围</summary>
              <label>
                <input
                  type="checkbox"
                  checked={s.preferences.checkins}
                  onChange={(e) => {
                    const checkins = e.target.checked;
                    c.edit((s) => ({
                      ...s,
                      preferences: { ...s.preferences, checkins },
                    }));
                  }}
                />
                随每日提醒生成本机晨间安排 / 晚间清点
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={s.preferences.autoReview}
                  onChange={(e) => {
                    const autoReview = e.target.checked;
                    c.edit((s) => ({
                      ...s,
                      preferences: { ...s.preferences, autoReview },
                    }));
                  }}
                />
                每周自动生成本机进展清点
              </label>
              <div className="goal-fields">
                <label>
                  每周
                  <select
                    value={s.preferences.reviewWeekday}
                    onChange={(e) => {
                      const reviewWeekday = Number(e.target.value);
                      c.edit((s) => ({
                        ...s,
                        preferences: { ...s.preferences, reviewWeekday },
                      }));
                    }}
                  >
                    {["日", "一", "二", "三", "四", "五", "六"].map((d, i) => (
                      <option key={i} value={i}>
                        星期{d}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  时间
                  <input
                    type="time"
                    value={s.preferences.reviewTime}
                    onChange={(e) => {
                      const reviewTime = e.target.value;
                      c.edit((s) => ({
                        ...s,
                        preferences: { ...s.preferences, reviewTime },
                      }));
                    }}
                  />
                </label>
              </div>
              <p>
                自动清点在应用运行时执行，错过两小时以上不补发。不后台调用付费
                AI，不自动修改目标或向 GWorkspace 同步。
              </p>
            </details>
          </section>
          <section>
            <h2>留下进展，也留下决定</h2>
            {[...s.reviews].reverse().map((r) => (
              <article className="goal-paper goal-review" key={r.id}>
                <small>
                  {r.date} · {r.source === "ai" ? "小汐复盘" : "本机清点"}
                </small>
                <p>{r.text}</p>
                {r.note && <blockquote>{r.note}</blockquote>}
                <DatePicker
                  label="下次检查"
                  value={r.nextCheck}
                  onChange={(nextCheck) =>
                    c.edit((s) => ({
                      ...s,
                      reviews: s.reviews.map((x) =>
                        x.id === r.id ? { ...x, nextCheck } : x,
                      ),
                    }))
                  }
                />
                <button
                  onClick={() => {
                    raw.set(
                      `根据 ${r.date} 的复盘调整计划：\n${r.text}\n我的决定：${r.note}`,
                    );
                    setTab("inbox");
                  }}
                >
                  把建议带回整理台 <ArrowRight size={14} />
                </button>
              </article>
            ))}
            {!s.reviews.length && <p>完成一次清点后，记录会保留在这里。</p>}
          </section>
        </div>
      )}
    </section>
  );
}

function TargetFields({
  action: a,
  targets,
  onChange,
}: {
  action: Pick<Action, "destination" | "targetId" | "targetDate">;
  targets: Target[];
  onChange: (p: Partial<Action>) => void;
}) {
  return (
    <div className="goal-fields">
      <label>
        在哪里做
        <select
          value={a.destination}
          onChange={(e) =>
            onChange({
              destination: e.target.value as Action["destination"],
              targetId: "",
              targetDate: "",
            })
          }
        >
          {Object.entries(destinations).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {["fitness", "travel", "shopping-list", "work-monitor"].includes(
        a.destination,
      ) && (
        <label>
          具体对象
          <select
            value={a.targetId}
            onChange={(e) => {
              const t = targets.find(
                (t) =>
                  t.id === e.target.value && t.destination === a.destination,
              );
              onChange({ targetId: e.target.value, targetDate: t?.date || "" });
            }}
          >
            <option value="">带着行动条件开始新流程</option>
            {targets
              .filter((t) => t.destination === a.destination)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </label>
      )}
      {["fitness", "travel"].includes(a.destination) && a.targetId && (
        <DatePicker
          label="对应日期"
          value={a.targetDate}
          onChange={(targetDate) => onChange({ targetDate })}
        />
      )}
    </div>
  );
}
