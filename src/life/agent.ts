import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { type Exercise, type Stop, uid } from "./model";
export async function runAgent(
  kind: "training" | "review" | "travel",
  context: unknown,
): Promise<unknown> {
  if (!isTauri())
    throw new Error(
      "请在桌面应用中运行 Agent；浏览器预览仍可手动管理档案与计划",
    );
  return invoke("run_planning_agent", { kind, context });
}
export function errorText(e: unknown) {
  const s = e instanceof Error ? e.message : String(e);
  return s.includes("ai_settings_missing")
    ? "请先在偏好设置配置 AI 的 API_KEY 和 BASE_URL"
    : s;
}
export function useJob() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const token = useRef(0),
    running = useRef(false);
  useEffect(
    () => () => {
      token.current++;
      running.current = false;
    },
    [],
  );
  const cancel = () => {
    token.current++;
    running.current = false;
    setBusy(false);
    setMessage("已取消，迟到结果不会应用");
  };
  async function run<T>(
    label: string,
    work: (isCurrent: () => boolean) => Promise<T>,
    accept: (v: T) => void,
  ) {
    if (running.current) return;
    running.current = true;
    const id = ++token.current;
    setBusy(true);
    setMessage(label);
    try {
      const v = await work(() => id === token.current);
      if (id === token.current) {
        accept(v);
        setMessage("处理完成，请检查结果");
      }
    } catch (e) {
      if (id === token.current) setMessage(errorText(e));
    } finally {
      if (id === token.current) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  return { busy, message, setMessage, cancel, run };
}
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" && v.length <= 12000;
export function trainingResult(v: unknown): {
  title: string;
  advice: string;
  exercises: Exercise[];
} {
  if (
    !obj(v) ||
    !str(v.title) ||
    !str(v.advice) ||
    !Array.isArray(v.exercises) ||
    !v.exercises.length ||
    v.exercises.length > 30 ||
    v.exercises.some(
      (e) =>
        !obj(e) ||
        !str(e.name) ||
        !str(e.unit) ||
        !Number.isInteger(e.sets) ||
        Number(e.sets) < 1 ||
        Number(e.sets) > 30 ||
        !Number.isInteger(e.reps) ||
        Number(e.reps) < 1 ||
        Number(e.reps) > 1000,
    )
  )
    throw Error("Agent 返回的训练项目不完整，请重新生成");
  return {
    title: v.title as string,
    advice: v.advice as string,
    exercises: v.exercises.map((e) => ({ ...e, id: uid() })) as Exercise[],
  };
}
export function travelResult(v: unknown): {
  title: string;
  summary: string;
  stops: Stop[];
} {
  if (
    !obj(v) ||
    !str(v.title) ||
    !str(v.summary) ||
    !Array.isArray(v.stops) ||
    !v.stops.length ||
    v.stops.length > 180 ||
    v.stops.some(
      (s) =>
        !obj(s) ||
        ![s.date, s.time, s.kind, s.name, s.address, s.notes].every(str) ||
        typeof s.cost !== "number" ||
        !Number.isFinite(s.cost) ||
        s.cost < 0,
    )
  )
    throw Error("Agent 返回的行程不完整，请重新生成");
  return {
    title: v.title as string,
    summary: v.summary as string,
    stops: v.stops.map((s) => ({
      id: uid(),
      date: s.date,
      time: s.time,
      kind: s.kind,
      name: s.name,
      address: s.address,
      notes: s.notes,
      cost: s.cost,
    })),
  };
}
export function reviewResult(v: unknown) {
  if (
    !obj(v) ||
    !str(v.summary) ||
    !Array.isArray(v.observations) ||
    !Array.isArray(v.nextSteps) ||
    ![...v.observations, ...v.nextSteps].every(str)
  )
    throw Error("复盘结果格式无效，请重试");
  return `${v.summary}\n\n观察\n${v.observations.join("\n")}\n\n下一步\n${v.nextSteps.join("\n")}`;
}
