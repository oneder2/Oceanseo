import { useId } from "react";
import type { Person } from "./model";
export function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (s: string) => void;
}) {
  const id = useId();
  return (
    <label>
      {label}
      <input
        aria-label={label}
        list={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={1000}
      />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <small>可选择常用项，也可直接输入</small>
    </label>
  );
}
export function PeoplePicker({
  people,
  ids,
  onChange,
}: {
  people: Person[];
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="life-people-picker">
      <legend>参与人</legend>
      {people
        .filter((p) => !p.archived || ids.includes(p.id))
        .map((p) => (
          <label key={p.id}>
            <input
              type="checkbox"
              checked={ids.includes(p.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...ids, p.id]
                    : ids.filter((id) => id !== p.id),
                )
              }
            />
            {p.name}
            {p.archived ? "（已归档）" : ""}
          </label>
        ))}
      {!people.length && <p>请先在「人物档案」添加参与人。</p>}
    </fieldset>
  );
}
