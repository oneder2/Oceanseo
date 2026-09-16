import { dateKey } from "./dateUtils";
// Local calendar dates preserve wall-clock schedules across DST. Catch up for
// two hours after sleep/restart, without replaying obsolete notifications.
export function dueReminder(
  now: Date,
  times: string[],
  delivered: string[],
  catchupMinutes = 120,
) {
  return (
    [...new Set(times)]
      .flatMap((time) => {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return [];
        return [0, -1].flatMap((offset) => {
          const when = new Date(now);
          when.setDate(when.getDate() + offset);
          const [hour, minute] = time.split(":").map(Number);
          when.setHours(hour, minute, 0, 0);
          const age = now.getTime() - when.getTime(),
            key = `${dateKey(when)}-${time}`;
          return age >= 0 &&
            age <= catchupMinutes * 60000 &&
            !delivered.includes(key)
            ? [{ key, time, at: when.getTime() }]
            : [];
        });
      })
      .sort((a, b) => b.at - a.at)[0] ?? null
  );
}
