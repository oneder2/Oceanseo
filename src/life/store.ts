import { APP_STATE_KEYS } from "../appDataStore";
import { emptyLife, isLifeData } from "./model";
export function loadLife() {
  const raw = localStorage.getItem(APP_STATE_KEYS.life);
  if (!raw) return emptyLife();
  const parsed: unknown = JSON.parse(raw);
  if (!isLifeData(parsed))
    throw new Error(
      "人物与生活计划数据格式异常，请从有效备份恢复；原数据未改写",
    );
  return parsed;
}
