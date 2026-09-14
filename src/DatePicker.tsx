import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { dateFromKey, dateKey } from "./dateUtils";
import MonthJump from "./MonthJump";

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

function monthDays(month: Date) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) =>
    new Date(year, monthIndex, index - mondayOffset + 1),
  );
}

function formatDate(value: string) {
  if (!value) return "选择日期";
  const date = dateFromKey(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

interface DatePickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export default function DatePicker({ label, value, onChange }: DatePickerProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const initial = value ? dateFromKey(value) : new Date();
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });
  const [position, setPosition] = useState({ top: 0, left: 0, width: 296 });
  const days = useMemo(() => monthDays(month), [month]);

  useEffect(() => {
    if (!open) return;
    const selected = value ? dateFromKey(value) : new Date();
    setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(310, window.innerWidth - 20);
      const height = popoverRef.current?.offsetHeight ?? 326;
      const left = Math.min(Math.max(10, anchor.left), window.innerWidth - width - 10);
      const fitsBelow = window.innerHeight - anchor.bottom >= height + 8;
      const top = fitsBelow
        ? anchor.bottom + 6
        : Math.max(10, anchor.top - height - 6);
      setPosition({ top, left, width });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, month]);

  function moveMonth(offset: number) {
    setMonth((current) => {
      const next = new Date(current.getFullYear(), current.getMonth() + offset, 1);
      return next.getFullYear() >= 100 && next.getFullYear() <= 9999 ? next : current;
    });
  }

  function chooseDate(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <div className="form-field date-picker-field">
      <span>{label}</span>
      <button
        ref={buttonRef}
        className={`date-picker-trigger ${open ? "is-open" : ""} ${value ? "has-value" : ""}`}
        type="button"
        aria-label={`${label}：${formatDate(value)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarDays size={16} />
        <span>{formatDate(value)}</span>
        <ChevronDown size={15} />
      </button>

      {open && createPortal(
        <div
          ref={popoverRef}
          className="date-picker-popover"
          role="dialog"
          aria-modal="false"
          aria-label={`${label}选择器`}
          style={{ top: position.top, left: position.left, width: position.width }}
        >
          <header className="date-picker-head">
            <MonthJump value={month} onChange={setMonth} />
            <div>
              <button type="button" onClick={() => moveMonth(-1)} aria-label="上个月" title="上个月"><ChevronLeft size={17} /></button>
              <button type="button" onClick={() => moveMonth(1)} aria-label="下个月" title="下个月"><ChevronRight size={17} /></button>
            </div>
          </header>
          <div className="date-picker-weekdays" aria-hidden="true">
            {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="date-picker-grid">
            {days.map((day) => {
              const key = dateKey(day);
              const currentMonth = day.getMonth() === month.getMonth();
              return (
                <button
                  className={`${currentMonth ? "" : "outside"} ${key === dateKey() ? "today" : ""} ${key === value ? "selected" : ""}`}
                  type="button"
                  disabled={day.getFullYear() < 100 || day.getFullYear() > 9999}
                  onClick={() => chooseDate(key)}
                  aria-label={`${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日`}
                  aria-pressed={key === value}
                  key={key}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
          <footer className="date-picker-actions">
            <button type="button" onClick={() => chooseDate("")} disabled={!value}>清除</button>
            <button type="button" onClick={() => chooseDate(dateKey())}>今天</button>
          </footer>
        </div>,
        document.body,
      )}
    </div>
  );
}
