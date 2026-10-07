import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowUp,
  ArrowUpRight,
  ChevronLeft,
  CircleCheck,
  LoaderCircle,
  MessageCircle,
  Settings2,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { AiSettings } from "../aiSettingsStore";
import type { TaskDraft, View } from "../types";
import { makeContext, type AssistantData } from "./context";
import {
  historyForRequest,
  isScope,
  PAGES,
  SCOPES,
  validAction,
  type AgentAction,
  type Message,
  type Scope,
} from "./model";
import { useAssistantState } from "./useAssistantState";
import TideSprite from "./TideSprite";
import "./assistant.css";

interface Props {
  data: AssistantData;
  storageReady: boolean;
  ai: AiSettings | null;
  onNavigate: (view: View) => void;
  onDraft: (draft: TaskDraft, name: string) => void;
  onSettings: () => void;
  onOrganize: (text: string) => Promise<void>;
}
const stages: Record<string, string> = {
  thinking: "在听，也在整理思路…",
  reading: "正在查看你分享的摘要…",
  drafting: "正在整理可操作的下一步…",
  summarizing: "正在把线索整理成回复…",
};
export default function Assistant({
  data,
  storageReady,
  ai,
  onNavigate,
  onDraft,
  onSettings,
  onOrganize,
}: Props) {
  const { state, change, loaded, loadError, saveError } =
    useAssistantState(storageReady);
  const [open, setOpen] = useState(false),
    [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false),
    [stage, setStage] = useState("thinking");
  const [error, setError] = useState(""),
    [clearConfirm, setClearConfirm] = useState(false);
  const [contextPreview, setContextPreview] = useState(false);
  const acting = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    thread = useRef<HTMLDivElement>(null);
  const running = useRef<string | null>(null),
    mounted = useRef(true),
    busyRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const { persona } = state;
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (running.current && isTauri())
        void invoke("cancel_assistant", { requestId: running.current }).catch(
          () => undefined,
        );
    };
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let active = true,
      stop: (() => void) | undefined;
    void listen<{ requestId: string; stage: string }>(
      "assistant-progress",
      (e) => {
        if (
          e.payload.requestId === running.current &&
          Object.hasOwn(stages, e.payload.stage)
        )
          setStage(e.payload.stage);
      },
    )
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if (
        e.ctrlKey &&
        e.shiftKey &&
        e.code === "Space" &&
        !document.querySelector('[aria-modal="true"]')
      ) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (open && !settings) input.current?.focus();
  }, [open, settings]);
  useEffect(() => {
    if (open && thread.current && state.messages.length)
      thread.current.scrollTop = thread.current.scrollHeight;
  }, [state.messages.length, open, busy, settings]);
  async function send() {
    const snapshot = stateRef.current,
      message = snapshot.draft.trim();
    if (!message || busyRef.current || !loaded || !data.ready) return;
    if (!isTauri()) {
      setError("浏览器预览不连接 AI。请在已安装的桌面应用中使用助手。");
      return;
    }
    if (!ai?.apiKeyConfigured) {
      setError("先配置共用 AI 服务，小汐就能开始工作。");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    setStage("thinking");
    const requestId = crypto.randomUUID();
    running.current = requestId;
    const user: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
      reads: [],
      actions: [],
    };
    change((s) => ({
      ...s,
      messages: [...s.messages.slice(-38), user],
      draft: "",
    }));
    try {
      const result = await invoke<{
        content: string;
        actions: AgentAction[];
        reads: Scope[];
      }>("run_assistant", {
        request: {
          requestId,
          persona: snapshot.persona,
          history: historyForRequest(snapshot.messages),
          message,
          context: makeContext(data, snapshot.scopes),
        },
      });
      if (!mounted.current || running.current !== requestId) return;
      if (
        typeof result.content !== "string" ||
        !result.content.trim() ||
        result.content.length > 12000 ||
        !Array.isArray(result.actions) ||
        result.actions.length > 6 ||
        !result.actions.every(validAction) ||
        !Array.isArray(result.reads) ||
        result.reads.length > 5 ||
        !result.reads.every((s) => isScope(s) && snapshot.scopes.includes(s))
      )
        throw Error("助手返回格式无效，没有执行任何修改。");
      const answer: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.content,
        createdAt: new Date().toISOString(),
        reads: result.reads,
        actions: result.actions.map((a) => ({ ...a, status: "pending" })),
      };
      change((s) => ({ ...s, messages: [...s.messages.slice(-39), answer] }));
    } catch (e) {
      if (mounted.current && running.current === requestId) {
        setError(String(e).replace(/^Error: /, ""));
        change((s) => ({
          ...s,
          messages: snapshot.messages,
          draft: s.draft || message,
        }));
      }
    } finally {
      if (mounted.current && running.current === requestId) {
        running.current = null;
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  async function act(messageId: string, action: AgentAction) {
    if (acting.current) return;
    acting.current = true;
    try {
      if (action.type === "navigate") onNavigate(action.view);
      else if (action.type === "organize") await onOrganize(action.text);
      else onDraft(action.draft, persona.name);
      change((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id !== messageId
            ? m
            : {
                ...m,
                actions: m.actions.map((a) =>
                  a.id === action.id ? { ...a, status: "opened" } : a,
                ),
              },
        ),
      }));
      setError("");
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "暂时无法打开，请稍后重试");
    } finally {
      acting.current = false;
    }
  }
  const canSend = loaded && data.ready && !busy && !!state.draft.trim();
  const panel = (
    <section
      className={`assistant-panel assistant-${persona.color}`}
      role="dialog"
      aria-label={`${persona.name} · 潮汐助手`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <header className="assistant-head">
        <TideSprite color={persona.color} active={busy} />
        <div>
          <h2>{persona.name}</h2>
          <p>{busy ? "稍等，我在整理" : "陪你把事情慢慢理清"}</p>
        </div>
        <button
          className="assistant-icon"
          aria-label={settings ? "返回对话" : "助手设置"}
          onClick={() => setSettings((v) => !v)}
        >
          {settings ? <ChevronLeft size={18} /> : <Settings2 size={18} />}
        </button>
        <button
          className="assistant-icon"
          aria-label="收起助手"
          onClick={close}
        >
          <X size={19} />
        </button>
      </header>
      {loadError ? (
        <p className="assistant-error" role="alert">
          {loadError}
        </p>
      ) : !loaded ? (
        <p role="status" className="assistant-empty">
          正在读取助手记录…
        </p>
      ) : settings ? (
        <div className="assistant-settings">
          <span className="assistant-eyebrow">属于你的潮汐精灵</span>
          <label>
            怎么称呼我
            <input
              defaultValue={persona.name}
              maxLength={24}
              onBlur={(e) => {
                const name = e.target.value.trim() || "小汐";
                e.target.value = name;
                change((s) => ({ ...s, persona: { ...s.persona, name } }));
              }}
            />
          </label>
          <label>
            交流风格
            <select
              value={persona.tone}
              onChange={(e) =>
                change((s) => ({
                  ...s,
                  persona: {
                    ...s.persona,
                    tone: e.target.value as typeof persona.tone,
                  },
                }))
              }
            >
              <option value="gentle">温和陪伴 · 安静而具体</option>
              <option value="concise">简洁直接 · 先说重点</option>
              <option value="coach">循序引导 · 一起找下一步</option>
            </select>
          </label>
          <label>
            精灵配色
            <select
              value={persona.color}
              onChange={(e) =>
                change((s) => ({
                  ...s,
                  persona: {
                    ...s.persona,
                    color: e.target.value as typeof persona.color,
                  },
                }))
              }
            >
              <option value="sea">浅海青</option>
              <option value="sunset">落日杏</option>
            </select>
          </label>
          <label>
            希望我记住的偏好
            <textarea
              value={persona.preferences}
              maxLength={1200}
              rows={4}
              placeholder="例如：我喜欢每次只安排三件重要的事，周日晚上复盘。"
              onChange={(e) =>
                change((s) => ({
                  ...s,
                  persona: { ...s.persona, preferences: e.target.value },
                }))
              }
            />
          </label>
          <p className="assistant-help">
            这里只记住你明确填写的偏好，可以随时修改。不会自动从对话提取长期记忆。
          </p>
          <fieldset className="assistant-scopes">
            <legend>本轮允许读取的摘要</legend>
            {(Object.entries(SCOPES) as [Scope, string][]).map(
              ([scope, label]) => (
                <label key={scope}>
                  <input
                    type="checkbox"
                    checked={state.scopes.includes(scope)}
                    disabled={busy}
                    onChange={(e) =>
                      change((s) => ({
                        ...s,
                        scopes: e.target.checked
                          ? [...s.scopes, scope]
                          : s.scopes.filter((v) => v !== scope),
                      }))
                    }
                  />
                  {label}
                </label>
              ),
            )}
          </fieldset>
          <p className="assistant-help">
            发送消息时，对话、精灵设置和勾选摘要会交给共用 AI
            服务。任务笔记、人物档案、密钥、项目源码不包含在摘要里。
          </p>
          <button
            className="assistant-link"
            onClick={() => {
              close();
              onSettings();
            }}
          >
            共用 AI 服务 · {ai?.model ?? "尚未配置"}
            <ArrowUpRight size={14} />
          </button>
          <p className="assistant-help">
            本机保留最近 40 条消息；每次续聊最多发送最近 12
            条。取消分享摘要不会撤回之前对话里的内容；切换范围后可清空对话再开始。
          </p>
          {clearConfirm ? (
            <div className="assistant-clear">
              <p>清空这段本机对话与输入草稿？已有计划和精灵偏好会保留。</p>
              <button
                disabled={busy}
                onClick={() => {
                  change((s) => ({ ...s, messages: [], draft: "" }));
                  setClearConfirm(false);
                  setError("");
                }}
              >
                确认清空
              </button>
              <button onClick={() => setClearConfirm(false)}>保留对话</button>
            </div>
          ) : (
            <button
              className="assistant-link"
              disabled={busy}
              onClick={() => setClearConfirm(true)}
            >
              <Trash2 size={15} />
              清空对话
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            className="assistant-thread"
            ref={thread}
            role="log"
            aria-label="助手对话"
            aria-live="polite"
          >
            {!state.messages.length && (
              <div className="assistant-welcome">
                <span className="assistant-eyebrow">在这里，慢慢来</span>
                <h3>
                  事情很多，
                  <br />
                  我们一件件理清。
                </h3>
                <p>
                  我是{persona.name}
                  。可以陪你整理今天，也能把一个想法拆成接下来要做的事。
                </p>
                <div className="assistant-prompts">
                  {[
                    "帮我看看今天先做什么",
                    "根据近期记录，陪我做一次复盘",
                    "我有一个新目标，帮我拆成可执行的计划",
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => {
                        change((s) => ({ ...s, draft: prompt }));
                        input.current?.focus();
                      }}
                    >
                      {prompt}
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {state.messages.map((m) => (
              <article className={`assistant-message is-${m.role}`} key={m.id}>
                <div className="assistant-message-label">
                  {m.role === "user" ? "你" : persona.name}
                  <time dateTime={m.createdAt}>
                    {new Date(m.createdAt).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <p>{m.content}</p>
                {!!m.reads.length && (
                  <small className="assistant-sources">
                    本轮读取 · {m.reads.map((s) => SCOPES[s]).join(" / ")}
                  </small>
                )}
                {m.actions.map((a) => (
                  <div className="assistant-action" key={a.id}>
                    <span>
                      {a.type === "navigate" ? "功能入口" : a.type==="organize"?"交给目标整理台":"待检查的计划草稿"}
                    </span>
                    <strong>
                      {a.type === "navigate" ? PAGES[a.view] : a.type==="organize"?"把这些想法整理成目标":a.draft.title}
                    </strong>
                    {a.type === "task_draft" && (
                      <>
                        <small>
                          {
                            { short: "短期", mid: "中期", long: "长期" }[
                              a.draft.horizon
                            ]
                          }{" "}
                          · {a.draft.priority === "important" ? "重要" : "普通"}{" "}
                          · {a.draft.startDate || "未定开始日期"} →{" "}
                          {a.draft.dueDate || "未定截止日期"}
                        </small>
                        {a.draft.notes && (
                          <details>
                            <summary>查看计划说明</summary>
                            <p>{a.draft.notes}</p>
                          </details>
                        )}
                      </>
                    )}
                    {a.type === "organize" && <details><summary>查看交给整理台的内容</summary><p>{a.text}</p></details>}
                    {a.status === "pending" ? (
                      <div>
                        <button
                          disabled={!data.ready || busy}
                          onClick={() => act(m.id, a)}
                        >
                          {a.type === "navigate"
                            ? "打开这个页面"
                            : a.type==="organize"?"保存想法并继续整理":"打开草稿检查并保存"}
                          <ArrowUpRight size={14} />
                        </button>
                        <button
                          className="assistant-dismiss"
                          disabled={busy}
                          onClick={() =>
                            change((s) => ({
                              ...s,
                              messages: s.messages.map((v) =>
                                v.id === m.id
                                  ? {
                                      ...v,
                                      actions: v.actions.map((x) =>
                                        x.id === a.id
                                          ? { ...x, status: "dismissed" }
                                          : x,
                                      ),
                                    }
                                  : v,
                              ),
                            }))
                          }
                        >
                          忽略
                        </button>
                      </div>
                    ) : (
                      <small>
                        <CircleCheck size={13} />
                        {a.status === "opened"
                          ? a.type === "navigate"
                            ? "已打开页面"
                            : a.type==="organize"?"已送入收集箱，请在整理台继续":"已打开草稿，请在编辑器中完成保存"
                          : "已忽略"}
                      </small>
                    )}
                  </div>
                ))}
              </article>
            ))}
            {busy && (
              <div className="assistant-thinking" role="status">
                <TideSprite color={persona.color} active />
                <span>{stages[stage]}</span>
              </div>
            )}
          </div>
          <div className="assistant-compose">
            {!data.ready && (
              <p className="assistant-error" role="status">
                业务数据尚未就绪。请先确认本机数据读取成功，再发送消息。
              </p>
            )}
            {!ai?.apiKeyConfigured && (
              <button
                className="assistant-configure"
                onClick={() => {
                  close();
                  onSettings();
                }}
              >
                连接共用 AI 服务，让{persona.name}开始工作
                <ArrowUpRight size={15} />
              </button>
            )}
            <div className="assistant-sharing">
              <button onClick={() => setSettings(true)}>
                可读 ·{" "}
                {state.scopes.length
                  ? state.scopes.map((s) => SCOPES[s]).join("、")
                  : "仅本次对话"}
              </button>
              <button
                aria-expanded={contextPreview}
                onClick={() => setContextPreview((v) => !v)}
              >
                查看摘要
              </button>
            </div>
            {contextPreview && (
              <pre className="assistant-context">
                {JSON.stringify(makeContext(data, state.scopes), null, 2)}
              </pre>
            )}
            {error && (
              <p className="assistant-error" role="alert">
                {error}
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <textarea
                ref={input}
                aria-label="给助手的消息"
                value={state.draft}
                maxLength={4000}
                rows={3}
                placeholder="把想法告诉我…"
                disabled={!data.ready}
                onChange={(e) =>
                  change((s) => ({ ...s, draft: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="assistant-compose-footer">
                <span>Enter 发送 · Shift + Enter 换行</span>
                {busy ? (
                  <button
                    type="button"
                    aria-label="停止本轮对话"
                    onClick={() =>
                      void invoke("cancel_assistant", {
                        requestId: running.current,
                      }).catch(() => setError("停止请求失败，请等待本轮结束"))
                    }
                  >
                    <Square size={14} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!canSend}
                    aria-label="发送消息"
                  >
                    <ArrowUp size={19} />
                  </button>
                )}
              </div>
            </form>
            <p className="assistant-footnote">
              {busy
                ? "可以收起窗口，我会继续整理。"
                : "计划草稿由你检查并保存。AI 建议也需要你的判断。"}
            </p>
            <button className="assistant-organize" disabled={busy||!data.ready} onClick={()=>{const text=state.draft.trim()||[...state.messages].reverse().find(m=>m.role==="user")?.content||"";void onOrganize(text).then(()=>{change(s=>({...s,draft:""}));close();}).catch(e=>setError(String(e)));}}>把这些想法带到目标整理台 ↗</button>
          </div>
        </>
      )}
      {saveError && (
        <p className="assistant-error" role="alert">
          {saveError}
        </p>
      )}
    </section>
  );
  return (
    <div className="assistant-root" onMouseDown={(e) => e.stopPropagation()}>
      <button
        ref={trigger}
        className={`assistant-launcher${open ? " is-open" : ""}`}
        aria-label={`打开${persona.name}助手`}
        aria-expanded={open}
        aria-keyshortcuts="Control+Shift+Space"
        title="潮汐助手 · Ctrl + Shift + Space"
        onClick={() => setOpen((v) => !v)}
      >
        <TideSprite color={persona.color} active={busy} />
        <span>{persona.name}</span>
        {busy ? (
          <LoaderCircle className="assistant-spin" size={12} />
        ) : (
          <MessageCircle size={13} />
        )}
      </button>
      {open &&
        createPortal(
          panel,
          document.querySelector(".desktop-shell") ?? document.body,
        )}
    </div>
  );
}
