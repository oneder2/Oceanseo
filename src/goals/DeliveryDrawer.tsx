import { useRef, useState } from "react";
import {
  Check,
  ArrowUpRight,
  CircleHelp,
  Play,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import DatePicker from "../DatePicker";
import type { Task } from "../types";
import type { GoalController } from "./store";
import {
  destinations,
  isPlan,
  type PlanAction,
  type Goal,
  type Action,
} from "./model";
import { addMessage } from "./conversationData";
import {
  conversationFor,
  currentProposal,
  deliveryRows,
  executableKeys,
} from "./dialogue";
import { conditionLines } from "./handoff";

export default function DeliveryDrawer({
  controller: c,
  tasks,
  onOpen,
  onDiscuss,
  locked = false,
}: {
  controller: GoalController;
  tasks: Task[];
  onOpen: (a: Action) => void;
  onDiscuss: (text: string) => void;
  locked?: boolean;
}) {
  const p = currentProposal(c.state),
    rows = p ? deliveryRows(c.state, p) : [],
    ready = executableKeys(rows);
  const [error, setError] = useState(""),
    [running, setRunning] = useState(false),
    [editing, setEditing] = useState(""),
    [undoConfirm, setUndoConfirm] = useState(false);
  const disabled = running || c.busy || locked;
  const executing=useRef(false);
  const [failedKeys,setFailedKeys]=useState<string[]>([]);
  async function execute(keys: string[]) {
    if (!p || disabled || executing.current) return;
    executing.current=true;
    setFailedKeys([]);
    setRunning(true);
    setError("");
    try {
      await c.execute(p.id, keys);
    } catch (e) {
      setFailedKeys(keys);
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      executing.current=false;
      setRunning(false);
    }
  }
  function save(key: string, value: Goal | PlanAction) {
    if (!p) return;
    const plan = {
      ...p.plan,
      goals: p.plan.goals.map((g) =>
        key === `g:${g.id}` ? (value as Goal) : g,
      ),
      actions: p.plan.actions.map((a) =>
        key === `a:${a.id}` ? (value as PlanAction) : a,
      ),
    };
    if (!isPlan(plan)) {
      setError("参数无效，请检查日期先后、文字长度和数值范围。");
      return;
    }
    const title = key.startsWith("g:") ? (value as Goal).title : (value as PlanAction).draft.title;
    const a=key.startsWith("a:")?value as PlanAction:undefined;
    const detail=a?`${a.minutes} 分钟；开始 ${a.draft.startDate||"未定"}；截止 ${a.draft.dueDate||"未定"}；${a.draft.priority==="important"?"重要":"普通"}；${conditionLines(a.conditions).join("；")}`:`完成标准：${(value as Goal).criterion}；检查日期：${(value as Goal).reviewDate||"未定"}`;
    void c
      .update((s) => {
        let conversation=addMessage(conversationFor(s),"system",`已微调「${title}」：${detail.slice(0,3000)}。尚未执行，后续沿用这些值。`);
        const node={id:`tuning-${key}`.slice(0,80),parentId:"",label:`最新微调 · ${title}`.slice(0,500),status:"clear" as const,evidence:detail.slice(0,1000)};
        const nodes=conversation.understanding.filter(n=>n.id!==node.id);
        if(nodes.length<80)conversation={...conversation,understanding:[...nodes,node]};
        return {
        ...s,
        proposals: s.proposals.map((x) => (x.id === p.id ? { ...x, plan } : x)),
        conversation,
      };})
      .then(() => {
        setEditing("");
        setError("");
      })
      .catch((e) => setError(String(e)));
  }
  return (
    <>
      <div className="delivery-intro">
        <p>
          检查将写入应用的更改。执行后会保存到对应目标与事项；业务计划的生成继续在对应入口完成。
        </p>
        <span>
          {ready.length} 项可执行 · {rows.length - ready.length}{" "}
          项等待确认或依赖
        </span>
      </div>
      <div className="gc-scroll delivery-list">
        {error && (
          <p className="gc-error" role="alert">
            {error}
          </p>
        )}
        {!rows.length && (
          <div className="gc-empty">
            <Check size={28} />
            <h3>
              {conversationFor(c.state).receipts.length
                ? "清单中的更改已处理"
                : "还没有待执行的更改"}
            </h3>
            <p>继续对话，小汐会把明确的目标和行动放到这里。</p>
          </div>
        )}
        {rows.map((r, index) => {
          const g = p!.plan.goals.find((g) => `g:${g.id}` === r.key),
            a = p!.plan.actions.find((a) => `a:${a.id}` === r.key),
            before = a
              ? tasks.find((t) => t.id === a.existingTaskId)
              : undefined,
            oldGoal = g ? c.state.goals.find((x) => x.id === g.id) : undefined;
          const dependency = r.dependencies.map(
            (k) => rows.find((x) => x.key === k)?.title ?? k,
          );
          const blocked =
            r.reason ||
            (!executableKeys(rows, r.key).length
              ? `先执行：${dependency.join("、")}`
              : "");
          return (
            <article
              className="delivery-row"
              key={`${p!.id}:${r.key}`}
              aria-label={r.title}
            >
              <div className="delivery-row-head">
                <span className="delivery-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <small>
                    {g
                      ? oldGoal
                        ? "更新目标"
                        : "添加目标"
                      : before
                        ? "调整 / 关联已有事项"
                        : "添加事项"}
                  </small>
                  <h3>{r.title}</h3>
                </div>
              </div>
              {g && (
                <>
                  <p>完成标准：{g.criterion || "尚未填写"}</p>
                  <p className="gc-muted">
                    状态：
                    {
                      {
                        active: "推进中",
                        paused: "已暂停",
                        completed: "已完成",
                      }[g.status]
                    }
                    {g.reviewDate ? ` · 下次检查 ${g.reviewDate}` : ""}
                  </p>
                  {oldGoal && (
                    <p className="delivery-before">
                      原目标：{oldGoal.title} ·{" "}
                      {oldGoal.status === "paused"
                        ? "暂停"
                        : oldGoal.status === "completed"
                          ? "完成"
                          : "推进中"}{" "}
                      · {oldGoal.criterion || "未设完成标准"}
                    </p>
                  )}
                </>
              )}
              {a && (
                <>
                  <p className="delivery-meta">
                    {a.minutes} 分钟 · {destinations[a.destination]} ·{" "}
                    {a.draft.dueDate ? `截止 ${a.draft.dueDate}` : "未设截止日"}
                  </p>
                  <p className="gc-muted">
                    {a.draft.startDate ? `开始 ${a.draft.startDate} · ` : ""}
                    {a.draft.priority === "important" ? "重要" : "普通"} ·{" "}
                    {
                      { short: "短期", mid: "中期", long: "长期" }[
                        a.draft.horizon
                      ]
                    }{" "}
                    ·{" "}
                    {
                      { low: "低精力", normal: "一般精力", high: "集中精力" }[
                        a.energy
                      ]
                    }
                  </p>
                  {before && (
                    <p className="delivery-before">
                      修改前：{before.title} ·{" "}
                      {before.startDate || "未设开始日"} →{" "}
                      {before.dueDate || "未设截止日"} ·{" "}
                      {before.priority === "important" ? "重要" : "普通"}
                      。记事本与完成记录保留。
                    </p>
                  )}
                  {!before && a.draft.notes && (
                    <p className="delivery-notes">{a.draft.notes}</p>
                  )}
                  {conditionLines(a.conditions).map((line, i) => (
                    <p className="delivery-condition" key={i}>
                      {line}
                    </p>
                  ))}
                  {a.destination !== "task" && (
                    <small>
                      同时保存「{destinations[a.destination]}」执行入口
                      {a.targetId ? "，关联已有对象" : "与条件草稿"}。
                    </small>
                  )}
                </>
              )}
              {blocked && (
                <p className="delivery-wait">
                  <CircleHelp size={15} />
                  {blocked}
                </p>
              )}
              {failedKeys.includes(r.key)&&<p className="gc-error">本条未执行：{error}</p>}
              {editing === r.key ? (
                <ParameterEditor
                  key={r.key}
                  goal={g}
                  action={a}
                  busy={disabled}
                  onSave={(v) => save(r.key, v)}
                  onCancel={() => setEditing("")}
                />
              ) : (
                <div className="delivery-row-actions">
                  <button disabled={disabled} onClick={() => setEditing(r.key)}>
                    <SlidersHorizontal size={14} />
                    微调参数
                  </button>
                  <button
                    onClick={() =>
                      onDiscuss(`关于「${r.title}」，我希望修改：`)
                    }
                  >
                    通过对话调整
                  </button>
                  <button
                    className="gc-execute"
                    disabled={disabled || !!blocked}
                    onClick={() => void execute([r.key])}
                  >
                    <Play size={13} />
                    执行本条
                  </button>
                </div>
              )}
            </article>
          );
        })}
        {!!conversationFor(c.state).receipts.length && (
          <details className="delivery-receipts" open={!rows.length}>
            <summary>
              已执行记录 · {conversationFor(c.state).receipts.length}
            </summary>
            {[...conversationFor(c.state).receipts].reverse().map((r) => {
              const a = c.state.actions.find((a) => a.taskId === r.taskId);
              return (
                <div key={r.id}>
                  <Check size={17} />
                  <div>
                    <strong>{r.title}</strong>
                    <small>
                      {r.description} · {new Date(r.createdAt).toLocaleString()}
                    </small>
                  </div>
                  {a && (
                    <button
                      aria-label={`打开${r.title}`}
                      onClick={() => onOpen(a)}
                    >
                      <ArrowUpRight size={17} />
                    </button>
                  )}
                </div>
              );
            })}
          </details>
        )}
      </div>
      <footer className="delivery-footer">
        {c.state.undo?.revision === c.state.revision && (
          <div className="delivery-undo">
            {undoConfirm ? (
              <>
                <span>撤销最近一次执行？</span>
                <button
                  disabled={disabled}
                  onClick={() =>
                    void c
                      .undo()
                      .then(() => setUndoConfirm(false))
                      .catch((e) => setError(String(e)))
                  }
                >
                  确认撤销
                </button>
                <button onClick={() => setUndoConfirm(false)}>取消</button>
              </>
            ) : (
              <button onClick={() => setUndoConfirm(true)}>
                <Undo2 size={15} />
                撤销最近一次执行
              </button>
            )}
          </div>
        )}
        <button
          className="gc-primary"
          disabled={disabled || !ready.length || !!editing}
          onClick={() => void execute(ready)}
        >
          {running
            ? "正在保存更改…"
            : `执行全部可执行项${ready.length ? `（${ready.length}）` : ""}`}
        </button>
        <small>依赖按顺序处理；等待确认的条目留在清单中。</small>
      </footer>
    </>
  );
}

function ParameterEditor({
  goal,
  action,
  busy,
  onSave,
  onCancel,
}: {
  goal?: Goal;
  action?: PlanAction;
  busy: boolean;
  onSave: (v: Goal | PlanAction) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<Goal | PlanAction>(() =>
    structuredClone((goal ?? action)!),
  );
  const g = goal ? (value as Goal) : undefined,
    a = action ? (value as PlanAction) : undefined;
  function patch(v: Record<string, unknown>) {
    setValue((x) => ({ ...x, ...v }));
  }
  function field(k: string, val: string | number) {
    if (a) patch({ draft: { ...a.draft, [k]: val } });
    else patch({ [k]: val });
  }
  return (
    <form
      className="delivery-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <label>
        名称
        <input
          required
          maxLength={200}
          value={g?.title ?? a!.draft.title}
          onChange={(e) => field("title", e.target.value)}
        />
      </label>
      {g ? (
        <>
          <label>
            完成标准
            <textarea
              maxLength={2000}
              value={g.criterion}
              onChange={(e) => patch({ criterion: e.target.value })}
            />
          </label>
          <DatePicker
            label="下次检查"
            value={g.reviewDate}
            onChange={(reviewDate) => patch({ reviewDate })}
          />
        </>
      ) : (
        <>
          <div className="gc-fields">
            <label>
              预计分钟
              <input
                type="number"
                min={5}
                max={1440}
                value={a!.minutes}
                onChange={(e) => patch({ minutes: Number(e.target.value) })}
              />
            </label>
            <label>
              重要程度
              <select
                value={a!.draft.priority}
                onChange={(e) => field("priority", e.target.value)}
              >
                <option value="normal">普通</option>
                <option value="important">重要</option>
              </select>
            </label>
          </div>
          <div className="gc-fields">
            <DatePicker
              label="开始日期"
              value={a!.draft.startDate}
              onChange={(v) => field("startDate", v)}
            />
            <DatePicker
              label="截止日期"
              value={a!.draft.dueDate}
              onChange={(v) => field("dueDate", v)}
            />
          </div>
          <div className="gc-fields">
            <label>
              周期
              <select
                value={a!.draft.horizon}
                onChange={(e) => field("horizon", e.target.value)}
              >
                <option value="short">短期</option>
                <option value="mid">中期</option>
                <option value="long">长期</option>
              </select>
            </label>
            <label>
              所需精力
              <select
                value={a!.energy}
                onChange={(e) => patch({ energy: e.target.value })}
              >
                <option value="low">轻松</option>
                <option value="normal">一般</option>
                <option value="high">集中</option>
              </select>
            </label>
          </div>
          {!a!.existingTaskId && (
            <label>
              事项说明
              <textarea
                maxLength={4000}
                value={a!.draft.notes}
                onChange={(e) => field("notes", e.target.value)}
              />
            </label>
          )}
          {a!.conditions &&
            Object.entries(a!.conditions)
              .filter(([, v]) => v !== null)
              .map(([section, values]) => (
                <fieldset key={section}>
                  <legend>
                    {
                      {
                        training: "训练条件",
                        travel: "旅行条件",
                        shopping: "采购条件",
                        meals: "食谱条件",
                      }[section as "training"]
                    }
                  </legend>
                  {Object.entries(values!).map(([key, v]) =>
                    key === "exercises" ? (
                      (
                        v as {
                          name: string;
                          sets: number;
                          reps: number;
                          unit: string;
                        }[]
                      ).map((exercise, i) => (
                        <div className="gc-fields" key={i}>
                          {Object.entries(exercise).map(([k, n]) => (
                            <label key={k}>
                              {
                                {
                                  name: "训练项目",
                                  sets: "组数",
                                  reps: "每组数量",
                                  unit: "单位",
                                }[k as "name"]
                              }
                              <input
                                type={typeof n === "number" ? "number" : "text"}
                                value={n}
                                onChange={(e) => {
                                  const list = [
                                    ...a!.conditions!.training!.exercises,
                                  ];
                                  list[i] = {
                                    ...list[i],
                                    [k]:
                                      typeof n === "number"
                                        ? Number(e.target.value)
                                        : e.target.value,
                                  };
                                  patch({
                                    conditions: {
                                      ...a!.conditions,
                                      training: {
                                        ...a!.conditions!.training,
                                        exercises: list,
                                      },
                                    },
                                  });
                                }}
                              />
                            </label>
                          ))}
                        </div>
                      ))
                    ) : (
                      <label key={key}>
                        {(
                          {
                            intervalDays: "间隔天数",
                            cycles: "周期次数",
                            origin: "出发地",
                            destination: "目的地",
                            budget: "预算（元）",
                            purpose: "目的",
                            transport: "交通",
                            accommodation: "住宿",
                            name: "物品名称",
                            amount: "数量",
                            category: "分类",
                            people: "人数",
                            dietaryPreference: "饮食偏好",
                            allergies: "忌口 / 过敏",
                            healthGoal: "健康目标",
                          } as Record<string, string>
                        )[key] ?? key}
                        <input
                          type={
                            [
                              "intervalDays",
                              "cycles",
                              "budget",
                              "people",
                            ].includes(key)
                              ? "number"
                              : "text"
                          }
                          value={typeof v === "number" || typeof v === "string" ? v : ""}
                          onChange={(e) => {
                            const numeric = [
                              "intervalDays",
                              "cycles",
                              "budget",
                              "people",
                            ].includes(key);
                            patch({
                              conditions: {
                                ...a!.conditions,
                                [section]: {
                                  ...values,
                                  [key]: numeric
                                    ? e.target.value
                                      ? Number(e.target.value)
                                      : null
                                    : e.target.value,
                                },
                              },
                            });
                          }}
                        />
                      </label>
                    ),
                  )}
                </fieldset>
              ))}
        </>
      )}
      <p className="gc-muted">
        参数会同步给后续对话。目标含义、状态与先后关系请通过对话调整。
      </p>
      <div className="delivery-row-actions">
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button className="gc-execute" disabled={busy}>
          保存微调
        </button>
      </div>
    </form>
  );
}
