import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { platform } from "../platform";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  GitBranch,
  ListChecks,
  Settings2,
  Square,
  RotateCcw,
  Check,
} from "lucide-react";
import type { PurchaseItem, Task } from "../types";
import type { LifeData } from "../life/model";
import type { GoalController } from "./store";
import type { useAssistantState } from "../assistant/useAssistantState";
import { makeContext, type AssistantData } from "../assistant/context";
import { useDraft } from "../drafts";
import TideSprite from "../assistant/TideSprite";
import { planningContext, type Target } from "./context";
import { destinations, localReview, nextActions, type Action } from "./model";
import {
  acceptDialogue,
  conversationFor,
  currentProposal,
  deliveryRows,
  dialogueContext,
  executableKeys,
  parseDialogueReply,
} from "./dialogue";
import { addMessage, type Conversation } from "./conversationData";
import GoalOverlay from "./GoalOverlay";
import UnderstandingMap from "./UnderstandingMap";
import DeliveryDrawer from "./DeliveryDrawer";
import ConversationSettings from "./ConversationSettings";
import "./conversation.css";

export interface ConversationProps {
  workspaceData?: AssistantData;
  controller: GoalController;
  tasks: Task[];
  life: LifeData;
  purchases?: PurchaseItem[];
  targets: Target[];
  assistant: ReturnType<typeof useAssistantState>;
  configured: boolean;
  onSettings: () => void;
  onOpen: (a: Action) => void;
}
export default function GoalConversation(props: ConversationProps) {
  const {
    controller: c,
    tasks,
    life,
    purchases = [],
    targets,
    assistant,
    configured,
    onSettings,
    onOpen,
  } = props;
  const [overlay, setOverlay] = useState<
      "map" | "delivery" | "settings" | null
    >(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [shareNotes, setShareNotes] = useState(false),
    [scrolled, setScrolled] = useState(false);
  const raw = useDraft<string>("goal-input", () => c.state.draft);
  const rawRef = useRef(raw);
  rawRef.current = raw;
  const input = useRef<HTMLTextAreaElement>(null),
    thread = useRef<HTMLDivElement>(null),
    running = useRef(false),
    token = useRef(0),
    initializing = useRef(false),
    nearBottom = useRef(true);
  const latest = useRef({ c, tasks, targets, assistant });
  latest.current = { c, tasks, targets, assistant };
  const s = c.state,
    chat = conversationFor(s),
    p = currentProposal(s),
    rows = p ? deliveryRows(s, p) : [],
    ready = executableKeys(rows);
  const persona = assistant.state.persona;
  const next = nextActions(s, tasks, life, undefined, purchases).ready[0];
  const sharing = {
    ...planningContext(s, tasks, targets, shareNotes),
    dialogue: dialogueContext(s, tasks),
    persona,
    actualProgress: localReview(s, tasks, life, "evening", purchases).text,
    workspace: props.workspaceData
      ? makeContext(props.workspaceData, assistant.state.scopes)
      : undefined,
  };
  useEffect(() => {
    if (
      !c.loaded ||
      !assistant.loaded ||
      s.conversation ||
      initializing.current
    )
      return;
    initializing.current = true;
    void c
      .update((current) => {
        if (current.conversation) return current;
        const inherited = conversationFor(current);
        let migrated: Conversation = {
          ...inherited,
          messages: [
            ...assistant.state.messages.map((m) => ({
              id: m.id,
              role: m.role,
              text: m.content,
              createdAt: m.createdAt,
            })),
            ...inherited.messages,
          ].slice(-160),
        };
        const drafts = assistant.state.messages
          .flatMap((m) =>
            m.actions
              .filter((a) => a.type === "task_draft" && a.status === "pending")
              .map((a) => (a.type === "task_draft" ? a.draft : null)),
          )
          .filter(Boolean);
        if (drafts.length)
          migrated = addMessage(
            migrated,
            "system",
            `此前对话还有未保存的事项建议：${drafts.map((d) => `${d!.title}（${d!.dueDate || "未设截止日期"}）`).join("；")}。可以继续对话，将它们加入交付清单。`,
          );
        return { ...current, conversation: migrated };
      })
      .then(() => {
        if (!raw.value && assistant.state.draft) raw.set(assistant.state.draft);
      })
      .catch((e) => setError(String(e)))
      .finally(() => {
        initializing.current = false;
      });
  }, [c.loaded, assistant.loaded]);
  useEffect(
    () => () => {
      token.current++;
      running.current = false;
    },
    [],
  );
  useEffect(() => {
    if (nearBottom.current)
      thread.current?.scrollTo({
        top: thread.current.scrollHeight,
        behavior: "auto",
      });
  }, [chat.messages.length, busy]);
  useEffect(() => {
    if (input.current) {
      input.current.style.height = "auto";
      input.current.style.height = `${Math.min(160, Math.max(52, input.current.scrollHeight))}px`;
    }
  }, [raw.value]);
  function discuss(text: string) {
    setOverlay(null);
    raw.set(raw.value ? raw.value + "\n" + text : text);
    setTimeout(() => input.current?.focus(), 0);
  }
  async function send(retry = false) {
    if (
      running.current ||
      c.busy ||
      !c.loaded ||
      !assistant.loaded ||
      (!retry && !raw.value.trim())
    )
      return;
    if (!configured && isTauri()) {
      onSettings();
      return;
    }
    running.current = true;
    setBusy(true);
    setError("");
    nearBottom.current = true;
    const turn = ++token.current;
    const submitted = rawRef.current.value.trim();
    try {
      const snapshot = retry
        ? latest.current.c.state
        : await c.update((current) => {
            const text = submitted;
            return {
              ...current,
              thoughts: [
                ...current.thoughts,
                {
                  id: crypto.randomUUID(),
                  text,
                  status: "inbox",
                  createdAt: new Date().toISOString(),
                },
              ],
              conversation: {
                ...addMessage(conversationFor(current), "user", text),
                needsReply: true,
              },
            };
          });
      if (!retry && rawRef.current.value.trim() === submitted) {
        rawRef.current.set("");
        rawRef.current.clear("");
      }
      if (turn !== token.current) return;
      if (!isTauri())
        throw Error(
          "消息已保存在本机。浏览器预览不连接 AI，请在桌面应用中继续对话。",
        );
      const snapshotTasks = [...latest.current.tasks];
      const result = await invoke<unknown>("run_planning_agent", {
        kind: "goal_dialogue",
        context: {
          ...planningContext(
            snapshot,
            snapshotTasks,
            latest.current.targets,
            shareNotes,
          ),
          dialogue: dialogueContext(snapshot, snapshotTasks),
          persona: latest.current.assistant.state.persona,
          actualProgress: localReview(
            snapshot,
            snapshotTasks,
            life,
            "evening",
            purchases,
          ).text,
          workspace: props.workspaceData
            ? makeContext(props.workspaceData, assistant.state.scopes)
            : undefined,
        },
      });
      if (turn !== token.current) return;
      const reply = parseDialogueReply(result);
      await c.update((current) => {
        if (turn !== token.current) return current;
        return acceptDialogue(current, reply, snapshot, snapshotTasks);
      });
    } catch (e) {
      if (turn === token.current) setError(String(e).replace(/^Error: /, ""));
    } finally {
      if (turn === token.current) {
        running.current = false;
        setBusy(false);
        input.current?.focus();
      }
    }
  }
  function cancel() {
    token.current++;
    running.current = false;
    setBusy(false);
    setError(
      "已停止等待。消息已保留，可以继续补充或重试；不会应用迟到的回复。",
    );
  }
  if (!c.loaded)
    return (
      <div className="gc-empty">
        <p role="status">{c.error || "正在读取对话与目标…"}</p>
        {c.error && (
          <button onClick={() => void c.recoverLatest()}>
            重新读取目标数据
          </button>
        )}
      </div>
    );
  return (
    <section className="goal-chat" aria-label="小汐目标对话">
      <header className="gc-header">
        <div className="gc-identity">
          <TideSprite color={persona.color} active={busy} />
          <div>
            <h1>{persona.name}</h1>
            <p>{busy ? "正在把线索理清…" : "从一个念头，到下一步"}</p>
          </div>
        </div>
        <div className="gc-tools">
          <button
            className="gc-icon"
            title="查看理解图"
            aria-label="查看理解图"
            onClick={() => setOverlay("map")}
          >
            <GitBranch size={20} />
            {chat.understanding.some((n) => n.status !== "clear") && <i />}
          </button>
          <button
            className="gc-delivery-trigger"
            aria-label="打开交付清单"
            onClick={() => setOverlay("delivery")}
          >
            <ListChecks size={19} />
            <span>交付清单</span>
            <b>{rows.length}</b>
          </button>
          <button
            className="gc-icon"
            title="对话与节奏设置"
            aria-label="对话与节奏设置"
            onClick={() => setOverlay("settings")}
          >
            <Settings2 size={19} />
          </button>
        </div>
      </header>
      <div
        ref={thread}
        className="gc-thread"
        role="log"
        aria-label="目标推进对话"
        aria-live="polite"
        onScroll={() => {
          const el = thread.current!;
          nearBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          setScrolled(!nearBottom.current);
        }}
      >
        {!chat.messages.length ? (
          <div className="gc-welcome">
            <span className="goal-kicker">不必先整理好，再开口</span>
            <h2>现在，脑海里有什么？</h2>
            <p>
              一个念头，几件挤在一起的事，或者还说不清的担心。
              <br />
              先聊一聊，我们一起找到能迈出的那一步。
            </p>
            <div className="gc-starters">
              {[
                "事情有点多，帮我理清先做什么",
                "我有一个目标，但不知道怎么开始",
                "看看最近的进展，帮我调整下一步",
              ].map((text) => (
                <button key={text} onClick={() => discuss(text)}>
                  {text}
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="gc-messages">
            {chat.messages.map((m) => (
              <article key={m.id} className={`gc-message is-${m.role}`}>
                <div className="gc-message-label">
                  {m.role === "assistant"
                    ? persona.name
                    : m.role === "user"
                      ? "你"
                      : "应用记录"}
                  <time>
                    {new Date(m.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <div className="gc-message-text">
                  {m.role === "system" && <Check size={15} />}
                  <span>{m.text}</span>
                </div>
              </article>
            ))}
            {busy && (
              <div className="gc-thinking" role="status">
                <span />
                <span />
                <span />
                正在理解你的补充
              </div>
            )}
            {!busy && p && (
              <div className="gc-inline-summary">
                <button onClick={() => setOverlay("map")}>
                  <GitBranch size={15} />
                  查看当前理解
                </button>
                <button onClick={() => setOverlay("delivery")}>
                  <ListChecks size={15} />
                  {ready.length
                    ? `${ready.length} 项更改可执行`
                    : rows.length
                      ? `${rows.length} 项更改待检查`
                      : "查看执行记录"}
                  <ArrowUpRight size={14} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="gc-compose-area">
        {scrolled && (
          <button
            className="gc-latest"
            onClick={() => {
              nearBottom.current = true;
              thread.current?.scrollTo({
                top: thread.current.scrollHeight,
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
              });
            }}
          >
            <ArrowDown size={14} />
            最新消息
          </button>
        )}
        {(error ||
          c.error ||
          raw.error ||
          assistant.loadError ||
          assistant.saveError) && (
          <div className="gc-error" role="alert">
            <span>
              {error ||
                c.error ||
                raw.error ||
                assistant.loadError ||
                assistant.saveError}
            </span>
            {c.error && (
              <>
                <button onClick={() => void c.retry()}>重试保存</button>
                <button onClick={() => void c.recoverLatest()}>重读数据</button>
              </>
            )}
          </div>
        )}
        {!busy && chat.needsReply && (
          <div className="gc-pending">
            <span>最新补充已保存，等待小汐继续理解。旧清单暂不执行。</span>
            <button disabled={c.busy} onClick={() => void send(true)}>
              <RotateCcw size={14} />
              继续 / 重试
            </button>
          </div>
        )}
        {next && !busy && (
          <div className="gc-next">
            <span>现在先做</span>
            <button onClick={() => onOpen(next.action)}>
              {next.task?.title}
              <small>
                {next.action.minutes} 分钟 ·{" "}
                {destinations[next.action.destination]}
              </small>
              <ArrowUpRight size={15} />
            </button>
          </div>
        )}
        <form
          className="gc-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={input}
            aria-label="给小汐的消息"
            placeholder="直接说说你的想法，或继续补充…"
            rows={2}
            maxLength={12000}
            value={raw.value}
            onChange={(e) => raw.set(e.target.value)}
            onKeyDown={(e) => {
              if (
                !platform.mobile && e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (!busy) void send();
              }
            }}
          />
          {busy ? (
            <button
              className="gc-send"
              type="button"
              aria-label="停止回复"
              key="stop"
              onClick={(e) => {
                e.preventDefault();
                cancel();
              }}
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              className="gc-send"
              aria-label="发送消息"
              key="send"
              type="submit"
              disabled={!raw.value.trim() || c.busy || !assistant.loaded}
            >
              <ArrowUp size={21} />
            </button>
          )}
        </form>
        <div className="gc-composer-hint">
          <span>{platform.mobile ? "换行继续补充 · 点击箭头发送" : "Enter 发送 · Shift + Enter 换行"}</span>
          <span>
            {busy
              ? "回复生成中，仍可准备下一条补充"
              : "对话自动保存 · 更改由你执行"}
          </span>
        </div>
      </div>
      {overlay && (
        <GoalOverlay
          title={
            overlay === "map"
              ? "理解图"
              : overlay === "delivery"
                ? "最终交付清单"
                : "对话与节奏设置"
          }
          drawer={overlay === "delivery"}
          onClose={() => setOverlay(null)}
        >
          {overlay === "map" ? (
            <>
              <p className="gc-map-caption">
                {chat.needsReply
                  ? "有新补充等待梳理，以下为上一轮理解。"
                  : "已明确、待确认和尚缺信息，在这里一眼看清。"}
              </p>
              <UnderstandingMap
                nodes={chat.understanding}
                state={s}
                tasks={tasks}
                onDiscuss={discuss}
              />
            </>
          ) : overlay === "delivery" ? (
            <DeliveryDrawer
              controller={c}
              tasks={tasks}
              locked={busy}
              onOpen={(a) => {
                setOverlay(null);
                onOpen(a);
              }}
              onDiscuss={discuss}
            />
          ) : (
            <ConversationSettings
              {...props}
              sharing={sharing}
              shareNotes={shareNotes}
              setShareNotes={setShareNotes}
              onDiscuss={discuss}
              onClose={() => setOverlay(null)}
            />
          )}
        </GoalOverlay>
      )}
    </section>
  );
}
