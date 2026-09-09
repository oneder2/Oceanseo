import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Clock3, Edit3, Plus, Trash2, X } from "lucide-react";
import DatePicker from "./DatePicker";
import { countdownDays, countdownLabel, createCountdown, updateCountdown } from "./countdownStore";
import { dateFromKey, dateKey } from "./dateUtils";
import type { Countdown, CountdownDraft } from "./types";

interface CountdownViewProps {
  countdowns: Countdown[];
  selectedCountdownId: string | null;
  onChange: (countdowns: Countdown[]) => void;
  onSelectionHandled: () => void;
  onToast: (message: string) => void;
}

const emptyDraft: CountdownDraft = { title: "", targetDate: dateKey(), notes: "" };

function formatTargetDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(dateFromKey(value));
}

function directionClass(days: number) {
  if (days === 0) return "is-today";
  return days > 0 ? "is-future" : "is-past";
}

export default function CountdownView({ countdowns, selectedCountdownId, onChange, onSelectionHandled, onToast }: CountdownViewProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CountdownDraft>(emptyDraft);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sortedCountdowns = useMemo(() => [...countdowns].sort((a, b) => {
    const dayDifference = Math.abs(countdownDays(a.targetDate)) - Math.abs(countdownDays(b.targetDate));
    return dayDifference || a.targetDate.localeCompare(b.targetDate) || b.updatedAt.localeCompare(a.updatedAt);
  }), [countdowns]);

  function openNew() {
    setEditingId(null);
    setDraft({ ...emptyDraft, targetDate: dateKey() });
    setConfirmDelete(false);
    setEditorOpen(true);
  }

  function openEditor(countdown: Countdown) {
    setEditingId(countdown.id);
    setDraft({ title: countdown.title, targetDate: countdown.targetDate, notes: countdown.notes });
    setConfirmDelete(false);
    setEditorOpen(true);
  }

  useEffect(() => {
    if (!selectedCountdownId) return;
    const selected = countdowns.find((countdown) => countdown.id === selectedCountdownId);
    if (selected) openEditor(selected);
    onSelectionHandled();
  }, [selectedCountdownId, countdowns, onSelectionHandled]);

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (editingId) {
      const current = countdowns.find((countdown) => countdown.id === editingId);
      const updated = current ? updateCountdown(current, draft) : null;
      if (!updated) return;
      onChange(countdowns.map((countdown) => countdown.id === editingId ? updated : countdown));
      onToast("关键日期已更新");
    } else {
      const created = createCountdown(draft);
      if (!created) return;
      onChange([created, ...countdowns]);
      onToast("关键日期已添加");
    }
    setEditorOpen(false);
  }

  function remove() {
    if (!editingId) return;
    onChange(countdowns.filter((countdown) => countdown.id !== editingId));
    setEditorOpen(false);
    onToast("关键日期已删除");
  }

  const futureCount = countdowns.filter((countdown) => countdownDays(countdown.targetDate) > 0).length;
  const pastCount = countdowns.filter((countdown) => countdownDays(countdown.targetDate) < 0).length;
  const todayCount = countdowns.length - futureCount - pastCount;

  return (
    <section className="countdown-view" aria-label="日期倒计时">
      <div className="countdown-summary">
        <div className="countdown-dial" aria-hidden="true">
          <Clock3 size={23} />
          <span>{countdowns.length}</span>
        </div>
        <div>
          <span className="countdown-summary-kicker">TIME MARKERS</span>
          <strong>把重要日子放在视线里</strong>
          <p>{countdowns.length ? `${futureCount} 个正在靠近，${todayCount} 个就在今天，${pastCount} 个值得回望。` : "从一个日期开始，记录期待与已经走过的路。"}</p>
        </div>
        <button className="primary-button" type="button" onClick={openNew}><Plus size={17} />添加关键日期</button>
      </div>

      {sortedCountdowns.length ? (
        <div className="countdown-list">
          {sortedCountdowns.map((countdown) => {
            const days = countdownDays(countdown.targetDate);
            return (
              <article className={`countdown-row ${directionClass(days)}`} key={countdown.id}>
                <div className="countdown-distance">
                  <span>{days === 0 ? "TODAY" : days > 0 ? "TO GO" : "SINCE"}</span>
                  <strong>{days === 0 ? "今" : Math.abs(days)}</strong>
                  <small>天</small>
                </div>
                <div className="countdown-copy">
                  <span className="countdown-state">{countdownLabel(days)}</span>
                  <h2>{countdown.title}</h2>
                  <p><CalendarDays size={14} />{formatTargetDate(countdown.targetDate)}</p>
                  {countdown.notes && <small>{countdown.notes}</small>}
                </div>
                <button className="countdown-edit" type="button" onClick={() => openEditor(countdown)} aria-label={`编辑${countdown.title}`}>
                  <Edit3 size={16} /><span>编辑</span>
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <button className="countdown-empty" type="button" onClick={openNew}>
          <span><Plus size={20} /></span>
          <strong>添加第一个关键日期</strong>
          <small>纪念日、目标日、考试或任何你在意的时间节点</small>
        </button>
      )}

      {editorOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditorOpen(false)}>
          <section className="modal countdown-modal" role="dialog" aria-modal="true" aria-labelledby="countdown-editor-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-head">
              <div>
                <span>{editingId ? "编辑关键日期" : "新的关键日期"}</span>
                <h2 id="countdown-editor-title">{editingId ? "调整这枚时间标记" : "记住一个重要日子"}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setEditorOpen(false)} aria-label="关闭" title="关闭"><X size={18} /></button>
            </header>
            <form onSubmit={save}>
              <label className="form-field">
                <span>名称</span>
                <input autoFocus maxLength={80} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：项目发布日" />
              </label>
              <DatePicker label="关键日期" value={draft.targetDate} onChange={(targetDate) => setDraft({ ...draft, targetDate })} />
              <label className="form-field">
                <span>备注 <em>可选</em></span>
                <textarea rows={4} maxLength={1000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="记录这个日期为什么重要……" />
              </label>
              <footer className="modal-actions">
                {editingId && (confirmDelete ? (
                  <div className="delete-confirm">
                    <span>确定删除？</span>
                    <button type="button" onClick={() => setConfirmDelete(false)}>取消</button>
                    <button className="danger" type="button" onClick={remove}>删除</button>
                  </div>
                ) : (
                  <button className="delete-button" type="button" onClick={() => setConfirmDelete(true)} aria-label="删除关键日期" title="删除关键日期"><Trash2 size={17} /></button>
                ))}
                <span className="action-spacer" />
                <button className="secondary-button" type="button" onClick={() => setEditorOpen(false)}>取消</button>
                <button className="primary-button" type="submit" disabled={!draft.title.trim() || !draft.targetDate}><Check size={16} />保存日期</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
