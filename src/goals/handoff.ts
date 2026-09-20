import type { Exercise } from "../life/model";
export interface GoalConditions {
  training: null | {
    intervalDays: number | null;
    cycles: number | null;
    exercises: Omit<Exercise, "id">[];
  };
  travel: null | {
    origin: string | null;
    destination: string | null;
    budget: number | null;
    purpose: string | null;
    transport: string | null;
    accommodation: string | null;
  };
  shopping: null | { name: string; amount: string; category: string };
  meals: null | {
    people: number | null;
    budget: number | null;
    dietaryPreference: string | null;
    allergies: string | null;
    healthGoal: string | null;
  };
}
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number) =>
  typeof v === "string" && v.length <= max;
const integer = (v: unknown, min: number, max: number) =>
  Number.isInteger(v) && Number(v) >= min && Number(v) <= max;
const keys = (v: Record<string, any>, names: string[]) =>
  Object.keys(v).length === names.length &&
  names.every((k) => Object.hasOwn(v, k));
export function validConditions(v: unknown): boolean {
  if (v === undefined) return true;
  if (!object(v) || !keys(v, ["training", "travel", "shopping", "meals"]))
    return false;
  const t = v.training,
    r = v.travel,
    s = v.shopping,
    m = v.meals;
  return (
    (t === null ||
      (object(t) &&
        keys(t, ["intervalDays", "cycles", "exercises"]) &&
        (t.intervalDays === null || integer(t.intervalDays, 1, 90)) &&
        (t.cycles === null || integer(t.cycles, 1, 104)) &&
        Array.isArray(t.exercises) &&
        t.exercises.length <= 30 &&
        t.exercises.every(
          (e: unknown) =>
            object(e) &&
            keys(e, ["name", "sets", "reps", "unit"]) &&
            text(e.name, 200) &&
            !!e.name.trim() &&
            integer(e.sets, 1, 30) &&
            integer(e.reps, 1, 1000) &&
            text(e.unit, 40) &&
            !!e.unit.trim(),
        ))) &&
    (r === null ||
      (object(r) &&
        keys(r, [
          "origin",
          "destination",
          "budget",
          "purpose",
          "transport",
          "accommodation",
        ]) &&
        [
          r.origin,
          r.destination,
          r.purpose,
          r.transport,
          r.accommodation,
        ].every((x) => x === null || text(x, 1000)) &&
        (r.budget === null || integer(r.budget, 0, 10000000)))) &&
    (s === null ||
      (object(s) &&
        keys(s, ["name", "amount", "category"]) &&
        text(s.name, 80) &&
        !!s.name.trim() &&
        text(s.amount, 40) &&
        text(s.category, 40))) &&
    (m === null ||
      (object(m) &&
        keys(m, [
          "people",
          "budget",
          "dietaryPreference",
          "allergies",
          "healthGoal",
        ]) &&
        (m.people === null || integer(m.people, 1, 12)) &&
        (m.budget === null || integer(m.budget, 1, 1000000)) &&
        [m.dietaryPreference, m.allergies, m.healthGoal].every(
          (x) => x === null || text(x, 1000),
        )))
  );
}
export function conditionLines(v?: GoalConditions): string[] {
  if (!v) return [];
  const out: string[] = [];
  if (v.training) {
    const t = v.training;
    if (t.intervalDays !== null) out.push(`训练间隔：${t.intervalDays} 天`);
    if (t.cycles !== null) out.push(`训练周期：${t.cycles} 次`);
    out.push(
      ...t.exercises.map(
        (e) => `${e.name}：${e.sets} 组 × ${e.reps} ${e.unit}`,
      ),
    );
  }
  if (v.travel) {
    const t = v.travel;
    for (const [label, value] of [
      ["出发地", t.origin],
      ["目的地", t.destination],
      ["预算（元）", t.budget],
      ["旅行目的", t.purpose],
      ["交通", t.transport],
      ["住宿", t.accommodation],
    ])
      if (value !== null) out.push(`${label}：${value}`);
  }
  if (v.shopping)
    out.push(
      `采购：${v.shopping.name} · ${v.shopping.amount || "数量待补充"} · ${v.shopping.category}`,
    );
  if (v.meals) {
    const m = v.meals;
    for (const [label, value] of [
      ["用餐人数", m.people],
      ["每周预算（元）", m.budget],
      ["饮食偏好", m.dietaryPreference],
      ["忌口", m.allergies],
      ["饮食目标", m.healthGoal],
    ])
      if (value !== null) out.push(`${label}：${value}`);
  }
  return out;
}
