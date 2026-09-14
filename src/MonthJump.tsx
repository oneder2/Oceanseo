import { useEffect, useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

export function calendarMonth(year: number, month: number) {
  const date = new Date(2000, month, 1);
  date.setFullYear(year);
  return date;
}

export default function MonthJump({
  value,
  onChange,
}: {
  value: Date;
  onChange: (date: Date) => void;
}) {
  const year = value.getFullYear();
  const [input, setInput] = useState(String(year));
  useEffect(() => setInput(String(year)), [year]);
  function commit() {
    const next = Number(input);
    if (Number.isInteger(next) && next >= 100 && next <= 9999)
      onChange(calendarMonth(next, value.getMonth()));
    else setInput(String(year));
  }
  return (
    <div className="month-jump">
      <button
        type="button"
        aria-label="上一年"
        disabled={year <= 100}
        onClick={() => onChange(calendarMonth(year - 1, value.getMonth()))}
      >
        <ChevronsLeft size={16} />
      </button>
      <label>
        <span className="sr-only">跳转年份</span>
        <input
          aria-label="跳转年份"
          type="number"
          min="100"
          max="9999"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
        年
      </label>
      <select
        aria-label="跳转月份"
        value={value.getMonth()}
        onChange={(e) => onChange(calendarMonth(year, Number(e.target.value)))}
      >
        {Array.from({ length: 12 }, (_, i) => (
          <option key={i} value={i}>
            {i + 1}月
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="下一年"
        disabled={year >= 9999}
        onClick={() => onChange(calendarMonth(year + 1, value.getMonth()))}
      >
        <ChevronsRight size={16} />
      </button>
    </div>
  );
}
