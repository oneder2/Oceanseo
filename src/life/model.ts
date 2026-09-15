import { dateFromKey, dateKey } from "../dateUtils";

export interface Person {
  id: string;
  name: string;
  birthday: string;
  relationship: string;
  dietary: string;
  preferences: string;
  hobbies: string;
  strengths: string;
  healthNotes: string;
  notes: string;
  archived: boolean;
}
export interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  unit: string;
}
export interface TrainingPlan {
  id: string;
  title: string;
  personId: string;
  startDate: string;
  intervalDays: number;
  cycles: number;
  exercises: Exercise[];
  goal: string;
  advice: string;
  archived: boolean;
  review?: string;
}
export interface Workout {
  id: string;
  planId: string;
  date: string;
  actual: Record<string, number[]>;
  notes: string;
  completed: boolean;
  updatedAt: string;
}
export interface Place {
  name: string;
  address: string;
  lng: number;
  lat: number;
}
export interface Stop {
  id: string;
  date: string;
  time: string;
  kind: string;
  name: string;
  address: string;
  notes: string;
  cost: number;
  place?: Place;
}
export interface RouteLeg {
  fromId: string;
  toId: string;
  mode: string;
  distance: number;
  duration: number;
  points: [number, number][];
}
export interface Trip {
  id: string;
  title: string;
  origin: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  purpose: string;
  preferences: string;
  transport: string;
  accommodation: string;
  participantIds: string[];
  summary: string;
  stops: Stop[];
  routes: RouteLeg[];
}
export interface LifeData {
  version: 1;
  people: Person[];
  training: TrainingPlan[];
  workouts: Workout[];
  trips: Trip[];
}
export const emptyLife = (): LifeData => ({
  version: 1,
  people: [],
  training: [],
  workouts: [],
  trips: [],
});
export const uid = () => crypto.randomUUID();
export function validDate(s: unknown): s is string {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    s >= "0100-01-01" &&
    s <= "9999-12-31" &&
    dateKey(dateFromKey(s)) === s
  );
}
export function addDays(s: string, n: number) {
  const d = dateFromKey(s);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
export function daysBetween(a: string, b: string) {
  const epoch = (s: string) => {
    const d = dateFromKey(s);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return Math.round((epoch(b) - epoch(a)) / 86400000);
}
export function ageAt(birthday: string, today = dateKey()) {
  if (!validDate(birthday) || birthday > today) return null;
  return (
    Number(today.slice(0, 4)) -
    Number(birthday.slice(0, 4)) -
    (today.slice(5) < birthday.slice(5) ? 1 : 0)
  );
}
export function birthdayInfo(birthday: string, today = dateKey()) {
  const age = ageAt(birthday, today);
  if (age === null) return { age: null, zodiac: "未录入", sign: "未录入" };
  const d = dateFromKey(birthday),
    month = d.getMonth(),
    day = d.getDate();
  const edges = [20, 19, 21, 20, 21, 22, 23, 23, 23, 24, 23, 22];
  const signs = [
    "摩羯座",
    "水瓶座",
    "双鱼座",
    "白羊座",
    "金牛座",
    "双子座",
    "巨蟹座",
    "狮子座",
    "处女座",
    "天秤座",
    "天蝎座",
    "射手座",
    "摩羯座",
  ];
  let zodiac = "当前系统不支持农历换算";
  try {
    const parts = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
      year: "numeric",
      timeZone: "Asia/Shanghai",
    }).formatToParts(new Date(`${birthday}T12:00:00+08:00`));
    const lunarYear = Number(
      parts.find((p) => (p.type as string) === "relatedYear")?.value,
    );
    if (lunarYear)
      zodiac =
        Array.from("鼠牛虎兔龙蛇马羊猴鸡狗猪")[
          (((lunarYear - 4) % 12) + 12) % 12
        ];
  } catch {
    /* Display unavailable rather than an incorrect Gregorian approximation. */
  }
  return { age, zodiac, sign: signs[month + (day >= edges[month] ? 1 : 0)] };
}
export function trainingDates(plan: TrainingPlan) {
  return Array.from({ length: plan.cycles }, (_, i) =>
    addDays(plan.startDate, i * plan.intervalDays),
  );
}
export function trainingError(p: TrainingPlan) {
  if (!p.title.trim() || !validDate(p.startDate))
    return "请填写计划名称和有效开始日期";
  if (
    !Number.isInteger(p.intervalDays) ||
    p.intervalDays < 1 ||
    p.intervalDays > 90 ||
    !Number.isInteger(p.cycles) ||
    p.cycles < 1 ||
    p.cycles > 104
  )
    return "训练间隔应为 1–90 天，训练次数为 1–104 次";
  if (!validDate(addDays(p.startDate, (p.cycles - 1) * p.intervalDays)))
    return "周期结束日期超出支持范围";
  if (
    !p.exercises.length ||
    p.exercises.length > 30 ||
    p.exercises.some(
      (e) =>
        !e.name.trim() ||
        !e.unit.trim() ||
        !Number.isInteger(e.sets) ||
        e.sets < 1 ||
        e.sets > 30 ||
        !Number.isInteger(e.reps) ||
        e.reps < 1 ||
        e.reps > 1000,
    )
  )
    return "请录入 1–30 个项目，每项 1–30 组，每组 1–1000 次/秒等";
  return "";
}
export function trainingStats(
  p: TrainingPlan,
  workouts: Workout[],
  today = dateKey(),
) {
  const scheduled = trainingDates(p),
    due = scheduled.filter((d) => d <= today);
  const done = due.filter((d) =>
    workouts.some((w) => w.planId === p.id && w.date === d && w.completed),
  ).length;
  return {
    scheduled: scheduled.length,
    due: due.length,
    done,
    rate: due.length ? Math.round((done / due.length) * 100) : 0,
  };
}
export function tripError(t: Trip) {
  if (!t.title.trim() || !t.origin.trim() || !t.destination.trim())
    return "请填写名称、出发地和目的地";
  if (
    !validDate(t.startDate) ||
    !validDate(t.endDate) ||
    t.endDate < t.startDate ||
    daysBetween(t.startDate, t.endDate) > 29
  )
    return "行程应为连续 1–30 天";
  if (!Number.isFinite(t.budget) || t.budget < 1 || t.budget > 10000000)
    return "总预算应为 1–10000000 元";
  if (!t.participantIds.length)
    return "请选择至少一位参与人（可先建立自己的档案）";
  if (
    t.stops.length > 180 ||
    t.stops.some(
      (s) =>
        !s.name.trim() ||
        !validDate(s.date) ||
        s.date < t.startDate ||
        s.date > t.endDate ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) ||
        !Number.isFinite(s.cost) ||
        s.cost < 0,
    )
  )
    return "地点须有名称、有效时间及费用，并处于行程日期内（最多 180 站）";
  return "";
}
export function profileContext(people: Person[], ids: string[]) {
  return people
    .filter((p) => ids.includes(p.id))
    .map((p) => ({
      name: p.name,
      age: ageAt(p.birthday),
      dietary: p.dietary,
      preferences: p.preferences,
      hobbies: p.hobbies,
      strengths: p.strengths,
      healthNotes: p.healthNotes,
    }));
}
export function tripWarnings(t: Trip) {
  const span = daysBetween(t.startDate, t.endDate);
  if (!Number.isFinite(span) || span < 0 || span > 29) return [];
  const warnings: string[] = [];
  for (let i = 0; i <= span; i++) {
    const date = addDays(t.startDate, i),
      stops = t.stops.filter((s) => s.date === date);
    if (!stops.length) {
      warnings.push(`${date} 尚未安排活动、餐饮或住宿`);
      continue;
    }
    const missing = [
      "早餐",
      "午餐",
      "晚餐",
      ...(i < span ? ["住宿"] : []),
    ].filter((kind) => !stops.some((s) => s.kind === kind));
    if (missing.length) warnings.push(`${date} 待检查：${missing.join("、")}`);
  }
  if (t.stops.reduce((n, s) => n + s.cost, 0) > t.budget)
    warnings.unshift("当前费用估算超过总预算，请调整安排");
  return warnings;
}
export interface LifeEvent {
  id: string;
  date: string;
  title: string;
  kind: "training" | "travel";
  targetId: string;
  done?: boolean;
}
export function lifeEvents(data: LifeData): LifeEvent[] {
  return [
    ...data.training
      .filter((p) => !p.archived)
      .flatMap((p) =>
        trainingDates(p).map((date) => ({
          id: `${p.id}:${date}`,
          date,
          title: p.title,
          kind: "training" as const,
          targetId: p.id,
          done: data.workouts.some(
            (w) => w.planId === p.id && w.date === date && w.completed,
          ),
        })),
      ),
    ...data.trips.flatMap((t) =>
      Array.from(
        { length: daysBetween(t.startDate, t.endDate) + 1 },
        (_, i) => ({
          id: `${t.id}:${i}`,
          date: addDays(t.startDate, i),
          title: t.title,
          kind: "travel" as const,
          targetId: t.id,
        }),
      ),
    ),
  ];
}

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: Record<string, unknown>, keys: string[]) =>
  keys.every(
    (k) => typeof v[k] === "string" && (v[k] as string).length <= 12000,
  );
/** Validate persisted data before rendering; no AI output is trusted as a document. */
export function isLifeData(v: unknown): v is LifeData {
  if (
    !object(v) ||
    v.version !== 1 ||
    ![v.people, v.training, v.workouts, v.trips].every(Array.isArray)
  )
    return false;
  const d = v as unknown as LifeData;
  if (
    d.people.length > 500 ||
    d.training.length > 500 ||
    d.workouts.length > 10000 ||
    d.trips.length > 500
  )
    return false;
  if (
    ![d.people, d.training, d.workouts, d.trips].every(
      (list) => new Set(list.map((x) => x?.id)).size === list.length,
    )
  )
    return false;
  if (
    !d.people.every(
      (p) =>
        object(p) &&
        strings(p, [
          "id",
          "name",
          "birthday",
          "relationship",
          "dietary",
          "preferences",
          "hobbies",
          "strengths",
          "healthNotes",
          "notes",
        ]) &&
        p.name.trim() &&
        (p.birthday === "" || validDate(p.birthday)) &&
        typeof p.archived === "boolean",
    )
  )
    return false;
  if (
    !d.training.every(
      (p) =>
        object(p) &&
        strings(p, [
          "id",
          "title",
          "personId",
          "startDate",
          "goal",
          "advice",
        ]) &&
        (p.review === undefined || typeof p.review === "string") &&
        typeof p.archived === "boolean" &&
        Array.isArray(p.exercises) &&
        p.exercises.every(
          (e) => object(e) && strings(e, ["id", "name", "unit"]),
        ) &&
        !trainingError(p),
    )
  )
    return false;
  if (
    !d.workouts.every(
      (w) =>
        object(w) &&
        strings(w, ["id", "planId", "date", "notes", "updatedAt"]) &&
        validDate(w.date) &&
        typeof w.completed === "boolean" &&
        object(w.actual) &&
        Object.values(w.actual).every(
          (a) =>
            Array.isArray(a) &&
            a.length <= 30 &&
            a.every((n) => Number.isFinite(n) && n >= 0 && n <= 10000),
        ),
    )
  )
    return false;
  return d.trips.every(
    (t) =>
      object(t) &&
      strings(t, [
        "id",
        "title",
        "origin",
        "destination",
        "startDate",
        "endDate",
        "purpose",
        "preferences",
        "transport",
        "accommodation",
        "summary",
      ]) &&
      Array.isArray(t.participantIds) &&
      t.participantIds.every((id) => typeof id === "string") &&
      Array.isArray(t.stops) &&
      Array.isArray(t.routes) &&
      t.stops.every(
        (s) =>
          object(s) &&
          strings(s, [
            "id",
            "name",
            "address",
            "date",
            "time",
            "kind",
            "notes",
          ]) &&
          (!s.place || validPlace(s.place)),
      ) &&
      t.routes.every(
        (r) =>
          object(r) &&
          strings(r, ["fromId", "toId", "mode"]) &&
          Number.isFinite(r.distance) &&
          Number.isFinite(r.duration) &&
          Array.isArray(r.points) &&
          r.points.length <= 50000 &&
          r.points.every(
            (p) =>
              Array.isArray(p) &&
              p.length === 2 &&
              validCoordinates(p[0], p[1]),
          ),
      ) &&
      !tripError(t),
  );
}
export function validCoordinates(lng: unknown, lat: unknown) {
  return (
    typeof lng === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90
  );
}
export function validPlace(p: unknown): p is Place {
  return (
    object(p) &&
    strings(p, ["name", "address"]) &&
    validCoordinates(p.lng, p.lat)
  );
}
