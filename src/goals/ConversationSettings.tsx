import type { ConversationProps } from "./GoalConversation";
import { localReview, type Action } from "./model";
import { addMessage } from "./conversationData";
import { conversationFor } from "./dialogue";
import { SCOPES, type Scope } from "../assistant/model";
export default function ConversationSettings({
  controller: c,
  tasks,
  life,
  purchases = [],
  assistant,
  onSettings,
  sharing,
  shareNotes,
  setShareNotes,
  onDiscuss,
  onClose,
}: ConversationProps & {
  sharing: unknown;
  shareNotes: boolean;
  setShareNotes: (v: boolean) => void;
  onDiscuss: (s: string) => void;
  onClose: () => void;
}) {
  const s = c.state,
    persona = assistant.state.persona;
  return (
    <div className="gc-scroll gc-settings">
      <h3>小汐的交流方式</h3>
      <div className="gc-fields">
        <label>
          名字
          <input
            maxLength={24}
            defaultValue={persona.name}
            onBlur={(e) => {
              const name = e.target.value;
              if (name.trim())
                assistant.change((s) => ({
                  ...s,
                  persona: { ...s.persona, name },
                }));
            }}
          />
        </label>
        <label>
          风格
          <select
            value={persona.tone}
            onChange={(e) =>
              assistant.change((s) => ({
                ...s,
                persona: {
                  ...s.persona,
                  tone: e.target.value as typeof persona.tone,
                },
              }))
            }
          >
            <option value="gentle">安静温和</option>
            <option value="concise">简洁直接</option>
            <option value="coach">循序引导</option>
          </select>
        </label>
      </div>
      <label>
        明确偏好
        <textarea
          maxLength={1200}
          value={persona.preferences}
          onChange={(e) =>
            assistant.change((s) => ({
              ...s,
              persona: { ...s.persona, preferences: e.target.value },
            }))
          }
        />
      </label>
      <button
        className="gc-text-button"
        onClick={() => {
          onClose();
          onSettings();
        }}
      >
        配置共用 AI 服务 ↗
      </button>
      <h3>分享给 AI 的内容</h3>
      <p className="gc-muted">
        对话、目标、任务摘要、业务入口和执行回执用于持续梳理。人物档案、项目源码与路径不在其中。
      </p>
      <label className="gc-checkbox">
        <input
          type="checkbox"
          checked={shareNotes}
          onChange={(e) => setShareNotes(e.target.checked)}
        />
        本次也分享任务记事本
      </label>
      <details>
        <summary>预览本次上下文</summary>
        <pre>{JSON.stringify(sharing, null, 2)}</pre>
      </details>
      <details><summary>补充分享其他业务摘要</summary><p className="gc-muted">目标推进所需的目标和任务摘要始终包含；以下范围按你的选择补充。</p>{(["calendar","meals","work"] as Scope[]).map(scope=><label className="gc-checkbox" key={scope}><input type="checkbox" checked={assistant.state.scopes.includes(scope)} onChange={e=>{const checked=e.target.checked;assistant.change(s=>({...s,scopes:checked?[...s.scopes.filter(x=>x!==scope),scope]:s.scopes.filter(x=>x!==scope)}));}}/>{SCOPES[scope]}</label>)}</details>
      <h3>此刻可用的时间与精力</h3>
      <div className="gc-fields">
        <label>
          可用分钟
          <input
            type="number"
            min={5}
            max={1440}
            defaultValue={s.preferences.minutes}
            onBlur={(e) => {
              const minutes = Number(e.target.value);
              c.edit((s) => ({
                ...s,
                preferences: { ...s.preferences, minutes },
              }));
            }}
          />
        </label>
        <label>
          现在的精力
          <select
            value={s.preferences.energy}
            onChange={(e) => {
              const energy = e.target.value as Action["energy"];
              c.edit((s) => ({
                ...s,
                preferences: { ...s.preferences, energy },
              }));
            }}
          >
            <option value="low">轻松一点</option>
            <option value="normal">一般</option>
            <option value="high">可以集中精力</option>
          </select>
        </label>
        <label>
          最多推荐几件
          <input
            type="number"
            min={1}
            max={10}
            defaultValue={s.preferences.dailyLimit}
            onBlur={(e) => {
              const dailyLimit = Number(e.target.value);
              c.edit((s) => ({
                ...s,
                preferences: { ...s.preferences, dailyLimit },
              }));
            }}
          />
        </label>
      </div>
      <details>
        <summary>本机清点与提醒</summary>
        <label className="gc-checkbox">
          <input
            type="checkbox"
            checked={s.preferences.checkins}
            onChange={(e) => {
              const checkins = e.target.checked;
              c.edit((s) => ({
                ...s,
                preferences: { ...s.preferences, checkins },
              }));
            }}
          />
          随每日提醒清点进度
        </label>
        <label className="gc-checkbox">
          <input
            type="checkbox"
            checked={s.preferences.autoReview}
            onChange={(e) => {
              const autoReview = e.target.checked;
              c.edit((s) => ({
                ...s,
                preferences: { ...s.preferences, autoReview },
              }));
            }}
          />
          每周生成本机清点
        </label>
        <div className="gc-fields">
          <label>
            每周哪一天
            <select
              value={s.preferences.reviewWeekday}
              onChange={(e) => {
                const reviewWeekday = Number(e.target.value);
                c.edit((s) => ({
                  ...s,
                  preferences: { ...s.preferences, reviewWeekday },
                }));
              }}
            >
              {["周日", "周一", "周二", "周三", "周四", "周五", "周六"].map(
                (label, value) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            清点时间
            <input
              type="time"
              value={s.preferences.reviewTime}
              onChange={(e) => {
                const reviewTime = e.target.value;
                c.edit((s) => ({
                  ...s,
                  preferences: { ...s.preferences, reviewTime },
                }));
              }}
            />
          </label>
        </div>
        <p>应用运行时进行本机清点；AI 只在发送消息时调用。</p>
        <button
          className="gc-text-button"
          onClick={() => {
            const review = localReview(s, tasks, life, "evening", purchases);
            void c
              .update((s) => ({
                ...s,
                reviews: [...s.reviews.slice(-199), review],
                conversation: addMessage(
                  conversationFor(s),
                  "system",
                  review.text,
                ),
              }))
              .then(onClose)
              .catch(() => {});
          }}
        >
          现在清点一次
        </button>
      </details>
      {!!s.reviews.length && (
        <details>
          <summary>历史复盘 · {s.reviews.length}</summary>
          {[...s.reviews].reverse().map((r) => (
            <article key={r.id}>
              <small>{r.date}</small>
              <p>{r.text}</p>
              {r.note && <p>{r.note}</p>}
              <button
                onClick={() =>
                  onDiscuss(`请根据这次复盘调整下一步：\n${r.text}\n${r.note}`)
                }
              >
                在对话中继续
              </button>
            </article>
          ))}
        </details>
      )}
      {!!s.thoughts.filter((t) => t.status === "later").length && (
        <details>
          <summary>之前暂时放下的想法</summary>
          {s.thoughts
            .filter((t) => t.status === "later")
            .map((t) => (
              <p key={t.id}>
                {t.text}
                <button onClick={() => onDiscuss(`重新考虑这件事：${t.text}`)}>
                  继续聊
                </button>
              </p>
            ))}
        </details>
      )}
    </div>
  );
}
