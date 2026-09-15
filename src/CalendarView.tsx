import { useMemo, useState } from "react";
import {
  CalendarCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flag,
  Hourglass,
  Plus,
} from "lucide-react";
import { completedDateKey, dateFromKey, dateKey } from "./dateUtils";
import type { Countdown, Task } from "./types";
import MonthJump from "./MonthJump";
import type { LifeEvent } from "./life/model";

interface CalendarViewProps {
  tasks: Task[];
  countdowns: Countdown[];
  onOpenTask: (task: Task) => void;
  onOpenCountdown: (countdown: Countdown) => void;
  onNewTask: (date: string) => void;
  lifeEvents?: LifeEvent[];
  onOpenLife?: (event: LifeEvent) => void;
}

type CalendarEvent =
  | { type: "task"; task: Task; kind: "start" | "due" | "completed"; label: string }
  | { type: "countdown"; countdown: Countdown; kind: "countdown"; label: string }
  | { type: "life"; event: LifeEvent; kind: "training" | "travel"; label: string };

const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function monthDays(month: Date) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) =>
    new Date(year, monthIndex, index - mondayOffset + 1),
  );
}

function eventsForDate(tasks: Task[], countdowns: Countdown[], day: string, life: LifeEvent[] = []): CalendarEvent[] {
  const taskEvents = tasks.flatMap((task) => {
    const events: CalendarEvent[] = [];
    if (task.startDate === day) events.push({ type: "task", task, kind: "start", label: "开始" });
    if (task.dueDate === day) events.push({ type: "task", task, kind: "due", label: "截止" });
    if (completedDateKey(task.completedAt) === day) {
      const completedTime = new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(task.completedAt!));
      events.push({ type: "task", task, kind: "completed", label: `完成 ${completedTime}` });
    }
    return events;
  });
  const countdownEvents: CalendarEvent[] = countdowns
    .filter((countdown) => countdown.targetDate === day)
    .map((countdown) => ({ type: "countdown", countdown, kind: "countdown", label: "关键日期" }));
  const extra: CalendarEvent[] = life.filter(e=>e.date===day).map(event=>({type:"life",event,kind:event.kind,label:event.kind==="training"?event.done?"训练已完成":"训练待清点":"旅行安排"}));
  return [...extra, ...countdownEvents, ...taskEvents];
}

export default function CalendarView({ tasks, countdowns, onOpenTask, onOpenCountdown, onNewTask, lifeEvents = [], onOpenLife }: CalendarViewProps) {
  const now = new Date();
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const days = useMemo(() => monthDays(month), [month]);
  const selectedEvents = useMemo(
    () => eventsForDate(tasks, countdowns, selectedDate, lifeEvents),
    [tasks, countdowns, selectedDate, lifeEvents],
  );

  const monthPrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const monthStarts = tasks.filter((task) => task.startDate?.startsWith(monthPrefix)).length;
  const monthCompleted = tasks.filter((task) => completedDateKey(task.completedAt).startsWith(monthPrefix)).length;
  const monthCountdowns = countdowns.filter((countdown) => countdown.targetDate.startsWith(monthPrefix)).length;

  function openEvent(event: CalendarEvent) {
    if (event.type === "task") onOpenTask(event.task);
    else if (event.type === "life") onOpenLife?.(event.event);
    else onOpenCountdown(event.countdown);
  }

  function eventTitle(event: CalendarEvent) {
    return event.type === "task" ? event.task.title : event.type === "life" ? `${event.event.done ? "✓ " : ""}${event.event.title}` : event.countdown.title;
  }

  function moveMonth(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    if (next.getFullYear() < 100 || next.getFullYear() > 9999) return;
    setMonth(next);
    setSelectedDate(dateKey(next));
  }

  function goToday() {
    const today = new Date();
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(dateKey(today));
  }

  return (
    <section className="calendar-view" aria-label="计划日历">
      <header className="calendar-toolbar">
        <MonthJump value={month} onChange={date => { setMonth(date); setSelectedDate(dateKey(date)); }} />
        <div className="calendar-stats" aria-label="本月概况">
          <span><Clock3 size={14} />{monthStarts} 项开始</span>
          <span><Hourglass size={14} />{monthCountdowns} 个关键日期</span>
          <span><CalendarCheck size={14} />{monthCompleted} 项完成</span>
        </div>
        <div className="calendar-controls">
          <button type="button" onClick={() => moveMonth(-1)} aria-label="上个月" title="上个月"><ChevronLeft size={17} /></button>
          <button className="today-button" type="button" onClick={goToday}>今天</button>
          <button type="button" onClick={() => moveMonth(1)} aria-label="下个月" title="下个月"><ChevronRight size={17} /></button>
        </div>
      </header>

      <div className="calendar-scroll">
        <div className="calendar-grid">
          {weekdays.map((weekday) => <div className="weekday" key={weekday}>{weekday}</div>)}
          {days.map((day) => {
            const key = dateKey(day);
            const events = eventsForDate(tasks, countdowns, key, lifeEvents);
            const isCurrentMonth = day.getMonth() === month.getMonth();
            return (
              <div
                className={`calendar-day ${!isCurrentMonth ? "outside" : ""} ${key === selectedDate ? "selected" : ""}`}
                key={key}
              >
                <button className={`day-number ${key === dateKey() ? "today" : ""}`} type="button" disabled={day.getFullYear() < 100 || day.getFullYear() > 9999} onClick={() => setSelectedDate(key)} aria-label={`选择${key}`}>
                  {day.getDate()}
                </button>
                <div className="day-events">
                  {events.slice(0, 3).map((event, index) => (
                    <button className={`calendar-event event-${event.kind}`} type="button" onClick={() => openEvent(event)} key={`${event.kind}-${index}`} title={`${event.label}：${eventTitle(event)}`}>
                      {event.kind === "completed" && <Check size={10} />}
                      {event.kind === "countdown" && <Hourglass size={9} />}
                      <span>{eventTitle(event)}</span>
                    </button>
                  ))}
                  {events.length > 3 && <span className="more-events">还有 {events.length - 3} 项</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <section className="day-agenda" aria-label={`${selectedDate}的日程`}>
        <header>
          <div>
            <span>{dateFromKey(selectedDate).getFullYear()}年{dateFromKey(selectedDate).getMonth() + 1}月</span>
            <h3>{dateFromKey(selectedDate).getDate()}日计划轨迹</h3>
          </div>
          <button className="secondary-button" type="button" onClick={() => onNewTask(selectedDate)}><Plus size={15} />添加计划</button>
        </header>
        <div className="agenda-list">
          {selectedEvents.map((event, index) => (
            <button className={`agenda-item event-${event.kind}`} type="button" key={`${event.kind}-${index}`} onClick={() => openEvent(event)}>
              <span className="agenda-kind">{event.label}</span>
              <strong>{eventTitle(event)}</strong>
              {event.type === "task" && event.task.priority === "important" && <Flag size={13} fill="currentColor" />}
              {event.type === "countdown" && <Hourglass size={13} />}
            </button>
          ))}
          {!selectedEvents.length && <p className="agenda-empty">这一天还没有计划轨迹。</p>}
        </div>
      </section>
    </section>
  );
}
