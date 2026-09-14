export function dateKey(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(2000, month - 1, day);
  date.setFullYear(year);
  return date;
}

export function completedDateKey(value: string | null) {
  return value ? dateKey(new Date(value)) : "";
}
