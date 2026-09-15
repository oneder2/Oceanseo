import test from "node:test";
import assert from "node:assert/strict";
import {
  ageAt,
  birthdayInfo,
  addDays,
  daysBetween,
  emptyLife,
  isLifeData,
  lifeEvents,
  profileContext,
  trainingDates,
  trainingError,
  trainingStats,
  tripError,
  tripWarnings,
  type TrainingPlan,
  type Trip,
  type Person,
} from "../src/life/model";
import { trainingResult, travelResult, reviewResult } from "../src/life/agent";
import { gcjToWgs } from "../src/life/maps";
const person: Person = {
  id: "p",
  name: "小林",
  birthday: "2000-02-04",
  relationship: "自己",
  dietary: "花生过敏",
  preferences: "安静",
  hobbies: "摄影",
  strengths: "驾驶",
  healthNotes: "避免长途步行",
  notes: "不应发送的私人记录",
  archived: false,
};
const plan: TrainingPlan = {
  id: "f",
  title: "体能周期",
  personId: "p",
  startDate: "2026-03-07",
  intervalDays: 2,
  cycles: 4,
  goal: "体能",
  advice: "",
  archived: false,
  exercises: [{ id: "e", name: "深蹲", sets: 3, reps: 12, unit: "次" }],
};
const trip: Trip = {
  id: "t",
  title: "杭州周末",
  origin: "上海",
  destination: "杭州",
  startDate: "2026-09-15",
  endDate: "2026-09-17",
  budget: 3000,
  purpose: "休闲",
  preferences: "",
  transport: "高铁",
  accommodation: "酒店",
  participantIds: ["p"],
  summary: "",
  stops: [],
  routes: [],
};
test("birthdays calculate age and lunar zodiac across Chinese New Year", () => {
  assert.equal(ageAt("2000-09-16", "2026-09-15"), 25);
  assert.equal(ageAt("2000-09-15", "2026-09-15"), 26);
  assert.equal(ageAt("2000-02-29", "2025-02-28"), 24);
  assert.equal(ageAt("2000-02-29", "2025-03-01"), 25);
  assert.equal(ageAt("2026-09-16", "2026-09-15"), null);
  assert.equal(ageAt("2000-02-30"), null);
  assert.equal(birthdayInfo("2000-02-04").zodiac, "兔");
  assert.equal(birthdayInfo("2000-02-05").zodiac, "龙");
  assert.equal(birthdayInfo("2000-03-20").sign, "双鱼座");
  assert.equal(birthdayInfo("2000-03-21").sign, "白羊座");
});
test("training uses calendar days across DST and counts only due explicit completions", () => {
  assert.deepEqual(trainingDates(plan), [
    "2026-03-07",
    "2026-03-09",
    "2026-03-11",
    "2026-03-13",
  ]);
  assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2);
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  const records = [
    {
      id: "w",
      planId: "f",
      date: "2026-03-07",
      actual: { e: [12, 12, 10] },
      notes: "",
      completed: true,
      updatedAt: "now",
    },
  ];
  assert.deepEqual(trainingStats(plan, records, "2026-03-09"), {
    scheduled: 4,
    due: 2,
    done: 1,
    rate: 50,
  });
  assert.equal(trainingStats(plan, records, "2026-03-06").done, 0);
  assert.ok(trainingError({ ...plan, intervalDays: 0 }));
  assert.ok(trainingError({ ...plan, cycles: 105 }));
});
test("profiles expose selected planning fields and omit raw birthday and private notes", () => {
  const context = profileContext(
    [person, { ...person, id: "other", name: "无关人物" }],
    ["p"],
  );
  assert.equal(context.length, 1);
  assert.equal(context[0].dietary, "花生过敏");
  assert.ok(!JSON.stringify(context).includes("不应发送"));
  assert.ok(!JSON.stringify(context).includes("2000-02-04"));
  assert.ok(!JSON.stringify(context).includes("无关人物"));
});
test("shared documents round trip with calendar links and reject malformed records", () => {
  const data = {
    ...emptyLife(),
    people: [person],
    training: [plan],
    trips: [trip],
  };
  assert.ok(isLifeData(JSON.parse(JSON.stringify(data))));
  assert.equal(lifeEvents(data).length, 7);
  assert.equal(
    lifeEvents({ ...data, training: [{ ...plan, archived: true }] }).length,
    3,
  );
  assert.ok(!isLifeData({ ...data, people: [null] }));
  assert.ok(!isLifeData({ ...data, people: [person, person] }));
  assert.ok(!isLifeData({ ...data, trips: [{ ...trip, stops: [null] }] }));
  assert.ok(
    !isLifeData({
      ...data,
      training: [{ ...plan, exercises: [{ ...plan.exercises[0], reps: NaN }] }],
    }),
  );
});
test("trip validation bounds dates, costs and participants without rejecting explicit over-budget drafts", () => {
  assert.equal(tripError(trip), "");
  assert.ok(tripError({ ...trip, participantIds: [] }));
  assert.ok(tripError({ ...trip, endDate: "2026-10-30" }));
  const stop = {
    id: "s",
    name: "西湖",
    address: "杭州西湖",
    kind: "游览",
    time: "09:00",
    date: trip.startDate,
    cost: 4000,
    notes: "估算",
  };
  assert.equal(tripError({ ...trip, stops: [stop] }), "");
  assert.ok(tripError({ ...trip, stops: [{ ...stop, date: "2026-09-18" }] }));
  assert.ok(tripError({ ...trip, stops: [{ ...stop, time: "25:00" }] }));
});
test("agent outputs are validated and cannot supply unverified map coordinates", () => {
  assert.throws(() =>
    trainingResult({
      title: "x",
      advice: "",
      exercises: [{ name: "x", sets: 0, reps: 12, unit: "次" }],
    }),
  );
  assert.throws(() =>
    travelResult({ title: "x", summary: "", stops: [{ cost: -1 }] }),
  );
  assert.throws(() =>
    reviewResult({ summary: "x", observations: "not-array", nextSteps: [] }),
  );
  const parsed = travelResult({
    title: "x",
    summary: "",
    stops: [
      {
        date: "2026-09-15",
        time: "09:00",
        kind: "游览",
        name: "x",
        address: "x",
        notes: "",
        cost: 0,
        place: { lng: 1, lat: 1 },
      },
    ],
  });
  assert.equal(parsed.stops[0].place, undefined);
});
test("AMap coordinates convert for OSM without moving overseas points", () => {
  const [lat, lng] = gcjToWgs(116.404, 39.915);
  assert.ok(Math.abs(lng - 116.39776) < 0.0001);
  assert.ok(Math.abs(lat - 39.9136) < 0.0001);
  assert.deepEqual(gcjToWgs(-74, 40.7), [40.7, -74]);
});
test("trip audit identifies missing meals, overnight stays and uncovered days", () => {
  assert.equal(tripWarnings(trip).length, 3);
  const t = {
    ...trip,
    stops: [
      {
        id: "s",
        date: trip.startDate,
        time: "09:00",
        kind: "游览",
        name: "西湖",
        address: "杭州",
        cost: 4000,
        notes: "",
      },
    ],
  };
  assert.ok(tripWarnings(t)[0].includes("超过总预算"));
  assert.ok(tripWarnings(t)[1].includes("早餐、午餐、晚餐、住宿"));
});
