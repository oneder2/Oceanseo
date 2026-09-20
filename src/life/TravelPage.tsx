import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { MapPin, Plus, Sparkles } from "lucide-react";
import DatePicker from "../DatePicker";
import { dateKey } from "../dateUtils";
import {
  addDays,
  daysBetween,
  profileContext,
  tripError,
  tripWarnings,
  type LifeData,
  type Place,
  type Stop,
  type Trip,
  uid,
} from "./model";
import type { UpdateLife } from "./PeoplePage";
import { Choice, PeoplePicker } from "./Fields";
import { runAgent, travelResult, useJob } from "./agent";
import { mapRoute, searchPlaces } from "./maps";
import { useDraft, DraftNotice } from "../drafts";
import type { GoalSeed } from "../goals/model";
const TripMap = lazy(() => import("./TripMap"));
const blank = (): Trip => ({
  id: uid(),
  title: "新的旅行",
  origin: "",
  destination: "",
  startDate: dateKey(),
  endDate: addDays(dateKey(), 2),
  budget: 3000,
  purpose: "休闲度假",
  preferences: "轻松、不赶路",
  transport: "公共交通",
  accommodation: "舒适酒店",
  participantIds: [],
  summary: "",
  stops: [],
  routes: [],
});
export default function TravelPage({
  data,
  update,
  selected,
  onSettings,
  seed,
}: {
  data: LifeData;
  update: UpdateLife;
  selected?: { id: string; date: string };
  onSettings: () => void;
  seed?: GoalSeed;
}) {
  const editor = useDraft<Trip>(
    "travel",
    () =>
      data.trips.find((t) => t.id === selected?.id) ?? data.trips[0] ?? blank(),
    (t) => t.id,
    (t) => data.trips.find((saved) => saved.id === t.id) ?? blank(),
  );
  const { value: trip, set: setTrip } = editor;
  const [day, setDay] = useState(
      selected?.id === trip.id ? selected.date : trip.startDate,
    ),
    [message, setMessage] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false),
    [routeMode, setRouteMode] = useState("步行");
  const [matches, setMatches] = useState<{
    id: string;
    places: Place[];
  } | null>(null);
  const job = useJob();
  useEffect(()=>{if(seed){const start=seed.startDate||dateKey(),conditions=seed.conditions?.travel;const restored=editor.open({...blank(),id:seed.id,title:seed.title,purpose:seed.title,preferences:seed.notes,startDate:start,endDate:seed.dueDate||addDays(start,2),...(conditions?Object.fromEntries(Object.entries(conditions).filter(([,v])=>v!==null)): {})});setDay(restored.startDate);}},[seed?.id]);
  useEffect(() => {
    if (selected) {
      const t = data.trips.find((t) => t.id === selected.id);
      if (t) {
        editor.open(t);
        setDay(selected.date);
      }
    }
  }, [selected]);
  const stops = useMemo(
    () =>
      trip.stops
        .filter((s) => s.date === day)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [trip.stops, day],
  );
  const dayIds = new Set(stops.map((s) => s.id)),
    routes = trip.routes.filter(
      (r) => dayIds.has(r.fromId) && dayIds.has(r.toId),
    );
  const total = trip.stops.reduce((n, s) => n + s.cost, 0),
    remaining = trip.budget - total;
  const warnings = tripWarnings(trip);
  const span = daysBetween(trip.startDate, trip.endDate),
    days =
      Number.isFinite(span) && span >= 0 && span < 30
        ? Array.from({ length: span + 1 }, (_, i) => addDays(trip.startDate, i))
        : [];
  function editStop(id: string, patch: Partial<Stop>) {
    setMatches(null);
    setTrip((t) => ({
      ...t,
      routes: [],
      stops: t.stops.map((s) =>
        s.id === id
          ? {
              ...s,
              ...patch,
              ...("address" in patch || "name" in patch
                ? { place: undefined }
                : {}),
            }
          : s,
      ),
    }));
  }
  function save() {
    const err = tripError(trip);
    if (err) {
      setMessage(err);
      return;
    }
    if (
      !update((d) => ({
        ...d,
        trips: d.trips.some((t) => t.id === trip.id)
          ? d.trips.map((t) => (t.id === trip.id ? trip : t))
          : [...d.trips, trip],
      }))
    )
      return;
    editor.clear();
    setMessage("行程已提交并同步日历，写入结果见顶部保存状态");
  }
  async function generate() {
    const error = tripError({ ...trip, stops: [] });
    if (error) {
      setMessage(error);
      return;
    }
    setMatches(null);
    void job.run(
      "读取参与人画像 → 制定住宿、三餐与路线草稿…",
      async () => {
        const result = travelResult(
          await runAgent("travel", {
            ...trip,
            routes: [],
            stops: [],
            people: profileContext(data.people, trip.participantIds),
            budgetMeaning: "全部参与人全程合计人民币预算",
          }),
        );
        const candidate = { ...trip, ...result, routes: [] };
        const invalid = tripError(candidate);
        if (invalid) throw Error(`Agent 结果未通过检查：${invalid}`);
        return candidate;
      },
      (t) => {
        setTrip(t);
        setDay(t.startDate);
        setMessage("草稿已生成，尚未保存；请检查费用和日期，再逐站确认地点");
      },
    );
  }
  function routeDay() {
    if (stops.length < 2 || stops.some((s) => !s.place)) {
      setMessage("请先检索并确认当天每个地点，至少需要两个地点");
      return;
    }
    if (stops.length > 20) {
      setMessage("单次最多规划 20 站，请减少当天地点");
      return;
    }
    void job.run(
      "正在逐段检索真实路线…",
      async (isCurrent) => {
        const result = [];
        for (let i = 1; i < stops.length; i++) {
          if (!isCurrent()) break;
          const r = await mapRoute(
            stops[i - 1].place!,
            stops[i].place!,
            routeMode,
          );
          result.push({
            ...r,
            fromId: stops[i - 1].id,
            toId: stops[i].id,
            mode: routeMode,
          });
        }
        return result;
      },
      (r) =>
        setTrip((t) => ({
          ...t,
          routes: [...t.routes.filter((leg) => !dayIds.has(leg.fromId)), ...r],
        })),
    );
  }
  return (
    <section className="life-page travel-page" aria-label="旅行规划">
      <DraftNotice draft={editor} label={(t) => t.title} />
      <div className="life-intro">
        <MapPin />
        <div>
          <strong>从同行的人，规划要走的路</strong>
          <p>
            预算按全体参与人的全程总额计算。AI
            给出建议，地点和路线由地图服务核实。
          </p>
        </div>
        <button className="secondary-button" onClick={onSettings}>
          AI 与地图配置
        </button>
      </div>
      <div className="life-actions">
        <label className="trip-switch">
          已保存行程
          <select
            value={data.trips.some((t) => t.id === trip.id) ? trip.id : ""}
            disabled={job.busy}
            onChange={(e) => {
              const t = data.trips.find((t) => t.id === e.target.value);
              if (t) {
                editor.open(t);
                setDay(t.startDate);
                setMatches(null);
                setMessage("");
                setConfirmDelete(false);
              }
            }}
          >
            <option value="">未保存草稿</option>
            {data.trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          disabled={job.busy}
          onClick={() => {
            const t = blank();
            editor.open(t);
            setDay(t.startDate);
            setMatches(null);
            setMessage("");
            setConfirmDelete(false);
          }}
        >
          <Plus size={16} />
          新行程
        </button>
        <button className="primary-button" disabled={job.busy} onClick={save}>
          保存行程并同步日历
        </button>
        {data.trips.some((t) => t.id === trip.id) && (
          <button
            className="secondary-button"
            disabled={job.busy}
            onClick={() => setConfirmDelete(!confirmDelete)}
          >
            删除行程
          </button>
        )}
      </div>
      {confirmDelete && (
        <div className="life-message" role="alert">
          删除此行程及对应日历标记？
          <button
            className="secondary-button"
            onClick={() => {
              update((d) => ({
                ...d,
                trips: d.trips.filter((t) => t.id !== trip.id),
              }));
              editor.clear();
              const t = blank();
              editor.open(t);
              setDay(t.startDate);
              setConfirmDelete(false);
            }}
          >
            确认删除
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="life-message">
          {message}
        </p>
      )}
      <div className="travel-layout">
        <aside className="life-card travel-brief">
          <h2>旅行条件</h2>
          <fieldset disabled={job.busy}>
            <label>
              行程名称
              <input
                maxLength={120}
                value={trip.title}
                onChange={(e) => setTrip({ ...trip, title: e.target.value })}
              />
            </label>
            <label>
              出发地
              <input
                maxLength={200}
                placeholder="城市 / 车站 / 机场"
                value={trip.origin}
                onChange={(e) => setTrip({ ...trip, origin: e.target.value })}
              />
            </label>
            <label>
              目的地
              <input
                maxLength={200}
                placeholder="例如：杭州"
                value={trip.destination}
                onChange={(e) =>
                  setTrip({ ...trip, destination: e.target.value })
                }
              />
            </label>
            <DatePicker
              label="出发日期"
              value={trip.startDate}
              onChange={(s) => {
                setTrip({ ...trip, startDate: s });
                setDay(s);
              }}
            />
            <DatePicker
              label="返回日期"
              value={trip.endDate}
              onChange={(s) => setTrip({ ...trip, endDate: s })}
            />
            <label>
              全程总预算（元）
              <input
                type="number"
                min={1}
                max={10000000}
                value={trip.budget}
                onChange={(e) =>
                  setTrip({ ...trip, budget: Number(e.target.value) })
                }
              />
            </label>
            <PeoplePicker
              people={data.people}
              ids={trip.participantIds}
              onChange={(ids) => setTrip({ ...trip, participantIds: ids })}
            />
            <Choice
              label="旅行目的"
              value={trip.purpose}
              options={[
                "休闲度假",
                "亲子陪伴",
                "美食探索",
                "文化历史",
                "自然徒步",
                "纪念日",
                "商务出行",
              ]}
              onChange={(s) => setTrip({ ...trip, purpose: s })}
            />
            <Choice
              label="交通偏好"
              value={trip.transport}
              options={[
                "公共交通",
                "自驾",
                "步行优先",
                "高铁 + 当地交通",
                "飞机 + 当地交通",
              ]}
              onChange={(s) => setTrip({ ...trip, transport: s })}
            />
            <Choice
              label="住宿偏好"
              value={trip.accommodation}
              options={[
                "经济酒店",
                "舒适酒店",
                "民宿",
                "亲子酒店",
                "无障碍住宿",
              ]}
              onChange={(s) => setTrip({ ...trip, accommodation: s })}
            />
            <label>
              节奏与其他偏好
              <textarea
                maxLength={2000}
                rows={3}
                value={trip.preferences}
                onChange={(e) =>
                  setTrip({ ...trip, preferences: e.target.value })
                }
              />
            </label>
            <button className="primary-button" onClick={() => void generate()}>
              <Sparkles size={16} />
              Agent 制定行程
            </button>
            <p className="life-muted">
              会发送已选人物的年龄、忌口、喜好、爱好、特长和出行注意；不发送生日原文及私人备注。生成会替换当前未保存草稿。
            </p>
          </fieldset>
        </aside>
        <div className="travel-content">
          <div className="life-metrics">
            <span>
              <strong>{trip.participantIds.length}</strong>位同行者
            </span>
            <span>
              <strong>¥{total.toLocaleString()}</strong>已列费用估算
            </span>
            <span className={remaining < 0 ? "over-budget" : ""}>
              <strong>¥{Math.abs(remaining).toLocaleString()}</strong>
              {remaining < 0 ? "超出预算" : "预算余量"}
            </span>
          </div>
          <div className="training-dates" aria-label="选择旅行日期">
            {days.map((d) => (
              <button
                key={d}
                disabled={job.busy}
                className={d === day ? "selected" : ""}
                onClick={() => {
                  setDay(d);
                  setMatches(null);
                }}
              >
                {d.slice(5)}
              </button>
            ))}
          </div>
          {trip.stops.length > 0 && warnings.length > 0 && (
            <details className="life-message">
              <summary>行程检查 · {warnings.length} 项待补充或确认</summary>
              {warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </details>
          )}
          <Suspense
            fallback={
              <div className="life-empty" role="status">
                正在加载地图…
              </div>
            }
          >
            <TripMap stops={stops} routes={routes} />
          </Suspense>
          <div className="life-actions">
            <label className="trip-switch">
              当地路线方式
              <select
                value={routeMode}
                disabled={job.busy}
                onChange={(e) => setRouteMode(e.target.value)}
              >
                <option>步行</option>
                <option>驾车</option>
              </select>
            </label>
            <button
              className="secondary-button"
              disabled={job.busy}
              onClick={routeDay}
            >
              规划当天地图路线
            </button>
            <button
              className="secondary-button"
              disabled={
                job.busy || !days.includes(day) || trip.stops.length >= 180
              }
              onClick={() =>
                setTrip({
                  ...trip,
                  stops: [
                    ...trip.stops,
                    {
                      id: uid(),
                      date: day,
                      time: "09:00",
                      kind: "游览",
                      name: "",
                      address: "",
                      cost: 0,
                      notes: "",
                    },
                  ],
                  routes: [],
                })
              }
            >
              添加地点
            </button>
          </div>
          {routes.length > 0 && (
            <p className="life-muted">
              已检索 {routes.length} 段路线 · 约{" "}
              {(routes.reduce((n, r) => n + r.distance, 0) / 1000).toFixed(1)}{" "}
              km · {Math.ceil(routes.reduce((n, r) => n + r.duration, 0) / 60)}{" "}
              分钟（不含停留，非实时交通承诺）
            </p>
          )}
          {!stops.length && (
            <div className="life-empty">
              <MapPin />
              <h3>把这一天的安排放到地图上</h3>
              <p>先用 Agent 生成草稿，或添加住宿、餐厅、景点和车站。</p>
            </div>
          )}
          <fieldset disabled={job.busy} className="travel-stops">
            {stops.map((s, i) => (
              <article className="trip-stop" key={s.id}>
                <header>
                  <span className="stop-index">{i + 1}</span>
                  <strong>
                    {s.time} · {s.name || "新地点"}
                  </strong>
                  <span>
                    {s.kind} · ¥{s.cost}
                  </span>
                </header>
                <details open={!s.name}>
                  <summary>
                    编辑安排{!s.place ? " · 待定位" : " · 地点已确认"}
                  </summary>
                  <div className="life-form-grid">
                    <label>
                      地点名称
                      <input
                        maxLength={200}
                        value={s.name}
                        onChange={(e) =>
                          editStop(s.id, { name: e.target.value })
                        }
                      />
                    </label>
                    <Choice
                      label="安排类型"
                      value={s.kind}
                      options={[
                        "出发",
                        "交通",
                        "游览",
                        "早餐",
                        "午餐",
                        "晚餐",
                        "住宿",
                        "返程",
                      ]}
                      onChange={(v) => editStop(s.id, { kind: v })}
                    />
                    <DatePicker
                      label={`第 ${i + 1} 站日期`}
                      value={s.date}
                      onChange={(v) => editStop(s.id, { date: v })}
                    />
                    <label>
                      时间
                      <input
                        type="time"
                        value={s.time}
                        onChange={(e) =>
                          editStop(s.id, { time: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      具体地址
                      <input
                        maxLength={500}
                        value={s.address}
                        onChange={(e) =>
                          editStop(s.id, { address: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      此站全体费用（元）
                      <input
                        type="number"
                        min={0}
                        max={10000000}
                        step="any"
                        value={s.cost}
                        onChange={(e) =>
                          editStop(s.id, { cost: Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    安排说明
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={s.notes}
                      onChange={(e) =>
                        editStop(s.id, { notes: e.target.value })
                      }
                    />
                  </label>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      setTrip({
                        ...trip,
                        stops: trip.stops.filter((x) => x.id !== s.id),
                        routes: [],
                      })
                    }
                  >
                    移除此站
                  </button>
                </details>
                {s.notes && <p>{s.notes}</p>}
                <div className="life-actions">
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setMatches(null);
                      void job.run(
                        `检索 ${s.name || s.address}…`,
                        () =>
                          searchPlaces(
                            s.address || s.name,
                            ["出发", "返程"].includes(s.kind)
                              ? ""
                              : trip.destination,
                          ),
                        (places) => setMatches({ id: s.id, places }),
                      );
                    }}
                  >
                    检索并确认地点
                  </button>
                  <small>
                    {s.place
                      ? `${s.place.name} · ${s.place.address}`
                      : "未核实地点，不显示虚构坐标"}
                  </small>
                </div>
                {matches?.id === s.id && (
                  <div className="place-results">
                    {!matches.places.length ? (
                      <p>未找到地点，请补充城市与具体地址再试。</p>
                    ) : (
                      matches.places.map((p, j) => (
                        <button
                          key={j}
                          onClick={() => {
                            editStop(s.id, { place: p });
                            setMatches(null);
                          }}
                        >
                          <strong>{p.name}</strong>
                          <small>{p.address}</small>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </article>
            ))}
          </fieldset>
          <label className="life-card">
            行程概览与待核实事项
            <textarea
              disabled={job.busy}
              rows={5}
              maxLength={12000}
              value={trip.summary}
              onChange={(e) => setTrip({ ...trip, summary: e.target.value })}
            />
          </label>
          <p className="life-muted">
            住宿、餐饮和车票价格均为估算；本应用不代订。地图线段仅在实际查询成功后显示，跨城航班/高铁请另行核对时刻与票价。
          </p>
        </div>
      </div>
      {job.message && (
        <div className="life-job" role="status">
          {job.message}
          {!job.busy && (
            <button
              className="secondary-button"
              aria-label="关闭处理提示"
              onClick={() => job.setMessage("")}
            >
              关闭
            </button>
          )}
          {job.busy && (
            <button className="secondary-button" onClick={job.cancel}>
              取消处理
            </button>
          )}
        </div>
      )}
    </section>
  );
}
