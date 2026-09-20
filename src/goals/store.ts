import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { assertAppWritable, registerStateFlusher } from "../appDataStore";
import { replacePreviewTasks, toTask, type TaskRecord } from "../taskStore";
import type { Task } from "../types";
import {
  applyProposal,
  emptyGoals,
  GOAL_KEY,
  isGoalState,
  type GoalState,
} from "./model";
const PENDING_KEY = "tideplan.goals.pending.v1";

function record(t: Task): TaskRecord {
  return {
    schema_version: t.schemaVersion,
    id: t.id,
    title: t.title,
    notes: t.notes,
    horizon: t.horizon,
    priority: t.priority,
    start_date: t.startDate || null,
    due_date: t.dueDate || null,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    completed_at: t.completedAt,
    origin: t.origin,
  };
}
export function useGoals(
  ready: boolean,
  tasks: Task[],
  onTasks: (tasks: Task[]) => void,
) {
  const [state, setState] = useState(emptyGoals),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const current = useRef(state),
    taskRef = useRef(tasks),
    queue = useRef(Promise.resolve()),
    mounted = useRef(true);
  taskRef.current = tasks;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void (async () => {
      try {
        const raw = isTauri()
          ? await invoke<GoalState | null>("get_goal_state")
          : JSON.parse(localStorage.getItem(GOAL_KEY) || "null");
        const value = raw ?? emptyGoals();
        if (!isGoalState(value))
          throw Error("目标记录格式异常，原数据已保留，请恢复有效备份");
        if (active) {
          current.current = value;
          setState(value);
          setLoaded(true);
          if (isTauri() && localStorage.getItem(PENDING_KEY))
            setError(
              "有一笔保存尚未取得回执，请重试待写请求。原始请求已保留在本机。",
            );
        }
      } catch (e) {
        if (active) setError(String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [ready]);
  useEffect(
    () =>
      registerStateFlusher(async () => {
        await queue.current;
        if (isTauri() && localStorage.getItem(PENDING_KEY))
          throw Error("目标仍有未完成的保存，请到想法与目标重试后备份");
      }),
    [],
  );
  type Change = {
    next: GoalState;
    created?: Task[];
    checks?: { id: string; updatedAt: string }[];
    undo?: boolean;
  };
  function commit(
    build: (s: GoalState, t: Task[], op: string) => Change,
  ): Promise<GoalState> {
    try {
      assertAppWritable();
    } catch (error) {
      return Promise.reject(error);
    }
    if (!loaded) return Promise.reject(Error("目标数据尚未读取完成"));
    const operationId = crypto.randomUUID();
    const work = queue.current.then(async () => {
      if (mounted.current) {
        setBusy(true);
        setError("");
      }
      const old = current.current,
        {
          next,
          created = [],
          checks = [],
          undo = false,
        } = build(old, taskRef.current, operationId);
      next.revision = old.revision + 1;
      next.operations = [...old.operations.slice(-1999), operationId];
      if (
        !isGoalState(next) ||
        new TextEncoder().encode(JSON.stringify(next)).length > 2 * 1024 * 1024
      )
        throw Error("目标数据无效或超过容量限制，请导出备份后整理历史记录");
      let value = next;
      if (isTauri()) {
        if (localStorage.getItem(PENDING_KEY))
          throw Error("上一笔保存尚未取得回执，请先重试待写请求");
        const request = {
          expectedRevision: old.revision,
          operationId,
          next,
          createTasks: created.map(record),
          checks,
          undo,
        };
        localStorage.setItem(PENDING_KEY, JSON.stringify(request));
        const reply = await invoke<{ state: GoalState; tasks: TaskRecord[] }>(
          "commit_goal_changes",
          { request },
        );
        if (!isGoalState(reply.state))
          throw Error("目标保存回执异常，请重新载入");
        value = reply.state;
        localStorage.removeItem(PENDING_KEY);
        const saved = reply.tasks.map(toTask);
        taskRef.current = saved;
        onTasks(saved);
      } else {
        if (
          checks.some(
            (c) =>
              !taskRef.current.some(
                (t) => t.id === c.id && t.updatedAt === c.updatedAt,
              ),
          )
        )
          throw Error("关联任务已变化，请重新整理");
        let updated = [...taskRef.current, ...created];
        if (undo) {
          if (
            !old.undo ||
            old.undo.revision !== old.revision ||
            old.undo.createdTasks.some(
              (snapshot) =>
                !taskRef.current.some(
                  (t) =>
                    t.id === snapshot.id &&
                    JSON.stringify(record(t)) ===
                      JSON.stringify(record(snapshot)),
                ),
            )
          )
            throw Error("方案或任务已变化，无法整批撤销");
          const remove = new Set(old.undo.createdTasks.map((t) => t.id));
          updated = updated.filter((t) => !remove.has(t.id));
        }
        localStorage.setItem(GOAL_KEY, JSON.stringify(value));
        replacePreviewTasks(updated);
        taskRef.current = updated;
        onTasks(updated);
      }
      current.current = value;
      if (mounted.current) setState(value);
      return value;
    });
    queue.current = work.then(
      () => undefined,
      () => undefined,
    );
    void work
      .catch((e) => {
        if (mounted.current) setError(String(e).replace(/^Error: /, ""));
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
    return work;
  }
  const update = (fn: (s: GoalState) => GoalState) =>
    commit((s) => ({ next: fn(s) }));
  const edit = (fn: (s: GoalState) => GoalState) => {
    void update(fn).catch(() => {});
  };
  const apply = (id: string) =>
    commit((s, t, op) => {
      const p = s.proposals.find((p) => p.id === id);
      if (!p) throw Error("方案不存在");
      return applyProposal(s, p, t, op);
    });
  const undo = () =>
    commit((s) => {
      const u = s.undo;
      if (!u || u.revision !== s.revision)
        throw Error("方案之后的目标已修改，请逐项调整");
      return {
        next: {
          ...s,
          goals: u.goals,
          actions: u.actions,
          thoughts: u.thoughts,
          undo: null,
          proposals: s.proposals.map((p) =>
            p.id === u.proposalId ? { ...p, status: "undone" } : p,
          ),
        },
        undo: true,
      };
    });
  async function retry() {
    try {
      assertAppWritable();
      await queue.current;
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return;
      setBusy(true);
      const request = JSON.parse(raw);
      if (!isGoalState(request.next))
        throw Error("待写请求格式异常，原文件已保留");
      const reply = await invoke<{ state: GoalState; tasks: TaskRecord[] }>(
        "commit_goal_changes",
        { request },
      );
      if (!isGoalState(reply.state)) throw Error("保存回执异常");
      localStorage.removeItem(PENDING_KEY);
      current.current = reply.state;
      setState(reply.state);
      const saved = reply.tasks.map(toTask);
      taskRef.current = saved;
      onTasks(saved);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function recoverLatest() {
    try {
      assertAppWritable();
      await queue.current;
      setBusy(true);
      const value = isTauri()
        ? await invoke<GoalState | null>("get_goal_state")
        : JSON.parse(localStorage.getItem(GOAL_KEY) || "null");
      if (value && !isGoalState(value)) throw Error("目标数据格式异常");
      const savedTasks = isTauri()
        ? (await invoke<TaskRecord[]>("list_tasks")).map(toTask)
        : taskRef.current;
      const pending = localStorage.getItem(PENDING_KEY);
      if (pending) {
        localStorage.setItem(`tideplan.goals.recovery.${Date.now()}`, pending);
        localStorage.removeItem(PENDING_KEY);
      }
      current.current = value ?? emptyGoals();
      setState(current.current);
      taskRef.current = savedTasks;
      onTasks(savedTasks);
      setLoaded(true);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return {
    state,
    loaded,
    busy,
    error,
    update,
    edit,
    apply,
    undo,
    retry,
    recoverLatest,
  };
}
export type GoalController = ReturnType<typeof useGoals>;
