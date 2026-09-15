import { useEffect, useState } from "react";
import { Dumbbell, Plus, Sparkles } from "lucide-react";
import DatePicker from "../DatePicker";
import { dateKey } from "../dateUtils";
import {
  type LifeData,
  type TrainingPlan,
  type Workout,
  profileContext,
  trainingDates,
  trainingError,
  trainingStats,
  uid,
} from "./model";
import type { UpdateLife } from "./PeoplePage";
import { Choice } from "./Fields";
import { reviewResult, runAgent, trainingResult, useJob } from "./agent";
const blank = (): TrainingPlan => ({
  id: uid(),
  title: "我的训练计划",
  personId: "",
  startDate: dateKey(),
  intervalDays: 2,
  cycles: 12,
  goal: "增强体能",
  exercises: [{ id: uid(), name: "深蹲", sets: 3, reps: 12, unit: "次" }],
  advice: "",
  archived: false,
});
export default function FitnessPage({
  data,
  update,
  selected,
  onSettings,
}: {
  data: LifeData;
  update: UpdateLife;
  selected?: { id: string; date: string };
  onSettings: () => void;
}) {
  const initialPlan =
    data.training.find((p) => p.id === selected?.id) ??
    data.training.find((p) => !p.archived);
  const initialDates = initialPlan ? trainingDates(initialPlan) : [];
  const [active, setActive] = useState(initialPlan?.id ?? ""),
    [date, setDate] = useState(
      selected && initialPlan?.id === selected.id
        ? selected.date
        : (initialDates.find((d) => d >= dateKey()) ??
            initialDates.at(-1) ??
            dateKey()),
    );
  const [draft, setDraft] = useState(blank),
    [editing, setEditing] = useState(!data.training.length),
    [message, setMessage] = useState("");
  const [actual, setActual] = useState<Record<string, number[]>>({}),
    [notes, setNotes] = useState(""),
    [review, setReview] = useState("");
  const job = useJob();
  const plan = data.training.find((p) => p.id === active),
    record = data.workouts.find((w) => w.planId === active && w.date === date);
  const dates = plan ? trainingDates(plan) : [],
    stats = plan ? trainingStats(plan, data.workouts) : null;
  useEffect(() => {
    if (selected && data.training.some((p) => p.id === selected.id)) {
      setActive(selected.id);
      setDate(selected.date);
      setEditing(false);
    }
  }, [selected]);
  useEffect(() => {
    setActual(record?.actual ?? {});
    setNotes(record?.notes ?? "");
    setReview(plan?.review ?? "");
  }, [active, date, record, plan?.review]);
  function choose(p: TrainingPlan) {
    job.cancel();
    setActive(p.id);
    setDate(
      trainingDates(p).find((d) => d >= dateKey()) ?? trainingDates(p).at(-1)!,
    );
    setEditing(false);
    setMessage("");
  }
  function savePlan() {
    const error = trainingError(draft);
    if (error) {
      setMessage(error);
      return;
    }
    update((d) => ({
      ...d,
      training: d.training.some((p) => p.id === draft.id)
        ? d.training.map((p) => (p.id === draft.id ? draft : p))
        : [...d.training, draft],
    }));
    setActive(draft.id);
    setDate(draft.startDate);
    setEditing(false);
    setMessage("计划已保存并显示在日历中");
  }
  function saveRecord(completed: boolean) {
    if (!dates.includes(date)) {
      setMessage("请选择本周期中的训练日");
      return;
    }
    if (!plan || date > dateKey()) {
      setMessage("未来训练日不能提前录入完成情况");
      return;
    }
    if (
      plan.exercises.some(
        (e) =>
          !actual[e.id] ||
          actual[e.id].length !== e.sets ||
          actual[e.id].some((n) => !Number.isFinite(n) || n < 0 || n > 10000),
      )
    ) {
      setMessage("请填写每组的实际完成量；未完成请填 0");
      return;
    }
    const w: Workout = {
      id: record?.id ?? uid(),
      planId: plan.id,
      date,
      actual,
      notes,
      completed,
      updatedAt: new Date().toISOString(),
    };
    update((d) => ({
      ...d,
      training: d.training.map((p) =>
        p.id === plan.id ? { ...p, review: undefined } : p,
      ),
      workouts: [
        ...d.workouts.filter((r) => !(r.planId === plan.id && r.date === date)),
        w,
      ],
    }));
    setMessage(
      completed ? "已标记完成，日历同步更新" : "记录已保存，当前未标记完成",
    );
  }
  return (
    <section className="life-page" aria-label="训练计划">
      <div className="life-intro">
        <Dumbbell />
        <div>
          <strong>训练有计划，完成有记录</strong>
          <p>按项目记录每组实际完成量，日历同步显示每个训练日。</p>
        </div>
        <button className="secondary-button" onClick={onSettings}>
          AI 配置
        </button>
      </div>
      <div className="life-split">
        <aside className="life-list">
          <button
            className="primary-button"
            onClick={() => {
              job.cancel();
              setDraft(blank());
              setEditing(true);
              setMessage("");
            }}
          >
            <Plus size={16} />
            新建训练周期
          </button>
          {data.training.map((p) => (
            <button
              className={`life-list-item ${p.id === active && !editing ? "selected" : ""}`}
              key={p.id}
              onClick={() => choose(p)}
            >
              <span>
                <strong>{p.title}</strong>
                <small>
                  {p.archived
                    ? "已归档"
                    : `${p.cycles} 次 · 每 ${p.intervalDays} 天`}
                </small>
              </span>
            </button>
          ))}
        </aside>
        <div className="life-card">
          {editing ? (
            <>
              <h2>制定训练周期</h2>
              <fieldset disabled={job.busy}>
                <div className="life-form-grid">
                  <label>
                    计划名称
                    <input
                      maxLength={120}
                      value={draft.title}
                      onChange={(e) =>
                        setDraft({ ...draft, title: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    执行人
                    <select
                      value={draft.personId}
                      onChange={(e) =>
                        setDraft({ ...draft, personId: e.target.value })
                      }
                    >
                      <option value="">不关联人物</option>
                      {data.people
                        .filter((p) => !p.archived)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <DatePicker
                    label="训练开始日期"
                    value={draft.startDate}
                    onChange={(s) => setDraft({ ...draft, startDate: s })}
                  />
                  <Choice
                    label="训练目标"
                    value={draft.goal}
                    options={[
                      "增强体能",
                      "增肌",
                      "减脂",
                      "保持活动",
                      "提升耐力",
                    ]}
                    onChange={(s) => setDraft({ ...draft, goal: s })}
                  />
                  <label>
                    每隔多少天训练
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={draft.intervalDays}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          intervalDays: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    本周期训练次数
                    <input
                      type="number"
                      min={1}
                      max={104}
                      value={draft.cycles}
                      onChange={(e) =>
                        setDraft({ ...draft, cycles: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
                <h3>训练项目</h3>
                {draft.exercises.map((ex, i) => (
                  <div className="exercise-row" key={ex.id}>
                    <label>
                      项目 {i + 1}
                      <input
                        maxLength={100}
                        value={ex.name}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            exercises: draft.exercises.map((x) =>
                              x.id === ex.id
                                ? { ...x, name: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                    {(["sets", "reps"] as const).map((k) => (
                      <label key={k}>
                        {k === "sets" ? "组数" : "每组量"}
                        <input
                          type="number"
                          min={1}
                          max={k === "sets" ? 30 : 1000}
                          value={ex[k]}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              exercises: draft.exercises.map((x) =>
                                x.id === ex.id
                                  ? { ...x, [k]: Number(e.target.value) }
                                  : x,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      单位
                      <input
                        list="training-units"
                        maxLength={20}
                        value={ex.unit}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            exercises: draft.exercises.map((x) =>
                              x.id === ex.id
                                ? { ...x, unit: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      className="secondary-button"
                      aria-label={`删除项目 ${i + 1}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          exercises: draft.exercises.filter(
                            (x) => x.id !== ex.id,
                          ),
                        })
                      }
                    >
                      删除
                    </button>
                  </div>
                ))}
                <datalist id="training-units">
                  <option>次</option>
                  <option>秒</option>
                  <option>分钟</option>
                  <option>米</option>
                </datalist>
                <div className="life-actions">
                  <button
                    className="secondary-button"
                    disabled={draft.exercises.length >= 30}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        exercises: [
                          ...draft.exercises,
                          {
                            id: uid(),
                            name: "",
                            sets: 3,
                            reps: 10,
                            unit: "次",
                          },
                        ],
                      })
                    }
                  >
                    添加项目
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setMessage("");
                      void job.run(
                        "正在读取画像与周期约束，拟定训练草稿…",
                        async () =>
                          trainingResult(
                            await runAgent("training", {
                              plan: draft,
                              people: profileContext(data.people, [
                                draft.personId,
                              ]),
                            }),
                          ),
                        (r) => setDraft({ ...draft, ...r }),
                      );
                    }}
                  >
                    <Sparkles size={15} />
                    Agent 优化草稿
                  </button>
                  <button className="primary-button" onClick={savePlan}>
                    确认计划并加入日历
                  </button>
                </div>
                <p className="life-muted">
                  Agent
                  会接收所选人物的年龄、忌口、偏好和训练注意信息；私人备注不发送。生成后可编辑，确认前不写入日历。
                </p>
                {draft.advice && (
                  <div className="life-prose">{draft.advice}</div>
                )}
              </fieldset>
            </>
          ) : plan ? (
            <>
              <div className="life-section-head">
                <div>
                  <h2>{plan.title}</h2>
                  <p>
                    {data.people.find((p) => p.id === plan.personId)?.name ??
                      "未关联人物"}{" "}
                    · {plan.goal}
                  </p>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setDraft({
                      ...plan,
                      id: uid(),
                      review: undefined,
                      title: `${plan.title} · 新周期`,
                      startDate: dateKey(),
                      archived: false,
                    });
                    setEditing(true);
                  }}
                >
                  复制为新周期
                </button>
              </div>
              <div className="life-metrics">
                <span>
                  <strong>
                    {stats?.done}/{stats?.due}
                  </strong>
                  截至今天完成
                </span>
                <span>
                  <strong>{stats?.rate}%</strong>到期完成率
                </span>
                <span>
                  <strong>{plan.cycles}</strong>周期训练日
                </span>
              </div>
              <div className="training-dates" aria-label="选择训练日">
                {dates.map((d) => (
                  <button
                    key={d}
                    className={d === date ? "selected" : ""}
                    onClick={() => {
                      job.cancel();
                      setDate(d);
                    }}
                    aria-label={`训练日 ${d}`}
                  >
                    <span>{d.slice(5)}</span>
                    <small>
                      {data.workouts.some(
                        (w) =>
                          w.planId === plan.id && w.date === d && w.completed,
                      )
                        ? "已完成"
                        : d > dateKey()
                          ? "待开始"
                          : "待清点"}
                    </small>
                  </button>
                ))}
              </div>
              <h3>{date} · 实际完成量</h3>
              <p className="life-muted">
                目标仅作参考，完成量由你填写；0
                表示该组未完成。不能提前完成未来训练。
              </p>
              <fieldset disabled={date > dateKey() || job.busy}>
                {plan.exercises.map((ex) => (
                  <div className="workout-exercise" key={ex.id}>
                    <strong>{ex.name}</strong>
                    <span>
                      目标 {ex.sets} 组 × {ex.reps} {ex.unit}
                    </span>
                    <div className="set-inputs">
                      {Array.from({ length: ex.sets }, (_, i) => (
                        <label key={i}>
                          第 {i + 1} 组（{ex.unit}）
                          <input
                            type="number"
                            min={0}
                            max={10000}
                            step="any"
                            aria-label={`${ex.name} 第 ${i + 1} 组`}
                            value={
                              Number.isFinite(actual[ex.id]?.[i])
                                ? actual[ex.id][i]
                                : ""
                            }
                            onChange={(e) => {
                              const values = Array.from(
                                { length: ex.sets },
                                (_, j) => actual[ex.id]?.[j] ?? NaN,
                              );
                              values[i] =
                                e.target.value === ""
                                  ? NaN
                                  : Number(e.target.value);
                              setActual({ ...actual, [ex.id]: values });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <label>
                  训练感受与备注
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </label>
                <div className="life-actions">
                  <button
                    className="secondary-button"
                    onClick={() => saveRecord(false)}
                  >
                    {record?.completed ? "取消完成并保存" : "保存未完成记录"}
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => saveRecord(true)}
                  >
                    标记训练完成
                  </button>
                </div>
              </fieldset>
              <div className="life-actions">
                <button
                  className="secondary-button"
                  disabled={job.busy}
                  onClick={() =>
                    void job.run(
                      "正在按实际记录清点本周期…",
                      async () =>
                        reviewResult(
                          await runAgent("review", {
                            today: dateKey(),
                            plan,
                            stats,
                            records: data.workouts.filter(
                              (w) => w.planId === plan.id,
                            ),
                            people: profileContext(data.people, [
                              plan.personId,
                            ]),
                          }),
                        ),
                      (text) => {
                        const reviewText = `${dateKey()} · 周期复盘\n${text}`;
                        setReview(reviewText);
                        update((d) => ({
                          ...d,
                          training: d.training.map((p) =>
                            p.id === plan.id ? { ...p, review: reviewText } : p,
                          ),
                        }));
                      },
                    )
                  }
                >
                  <Sparkles size={15} />
                  Agent 周期复盘
                </button>
                <button
                  className="secondary-button"
                  disabled={job.busy}
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      training: d.training.map((p) =>
                        p.id === plan.id ? { ...p, archived: !p.archived } : p,
                      ),
                    }))
                  }
                >
                  {plan.archived ? "恢复到日历" : "归档周期"}
                </button>
              </div>
              {review && (
                <article className="life-prose" aria-label="训练复盘">
                  {review}
                </article>
              )}
              {plan.advice && (
                <details>
                  <summary>计划建议</summary>
                  <p className="life-prose">{plan.advice}</p>
                </details>
              )}
            </>
          ) : (
            <p>新建一个训练周期，或选择已有计划。</p>
          )}
          {message && (
            <p role="status" className="life-message">
              {message}
            </p>
          )}
          {job.message && (
            <p role="status" className="life-message">
              {job.message}{" "}
              {job.busy && (
                <button className="secondary-button" onClick={job.cancel}>
                  取消生成
                </button>
              )}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
