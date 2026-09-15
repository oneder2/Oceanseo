import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Place, RouteLeg } from "./model";
export interface MapSettings {
  configured: boolean;
  keyHint: string | null;
}
export async function getMapSettings(): Promise<MapSettings> {
  return isTauri()
    ? invoke("get_map_settings")
    : { configured: false, keyHint: null };
}
export async function saveMapSettings(
  key: string,
  clear = false,
): Promise<MapSettings> {
  if (!isTauri()) throw Error("地图 Key 请在桌面应用中保存");
  return invoke("save_map_settings", { key: key.trim() || null, clear });
}
export async function searchPlaces(
  query: string,
  city: string,
): Promise<Place[]> {
  if (!isTauri()) throw Error("地点检索请在桌面应用中使用并配置高德 Key");
  return invoke("search_places", { query, city });
}
export async function mapRoute(
  a: Place,
  b: Place,
  mode: string,
): Promise<Pick<RouteLeg, "distance" | "duration" | "points">> {
  if (!isTauri()) throw Error("路线规划请在桌面应用中使用");
  return invoke("plan_map_route", {
    origin: [a.lng, a.lat],
    destination: [b.lng, b.lat],
    mode,
  });
}
/** AMap uses GCJ-02. OSM uses WGS-84. Approximate inverse, not a survey/navigation datum. */
export function gcjToWgs(lng: number, lat: number): [number, number] {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271)
    return [lat, lng];
  const x = lng - 105,
    y = lat - 35,
    pi = Math.PI;
  let dlat =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  dlat += ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3;
  dlat += ((20 * Math.sin(y * pi) + 40 * Math.sin((y / 3) * pi)) * 2) / 3;
  dlat +=
    ((160 * Math.sin((y / 12) * pi) + 320 * Math.sin((y * pi) / 30)) * 2) / 3;
  let dlng =
    300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  dlng += ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3;
  dlng += ((20 * Math.sin(x * pi) + 40 * Math.sin((x / 3) * pi)) * 2) / 3;
  dlng +=
    ((150 * Math.sin((x / 12) * pi) + 300 * Math.sin((x / 30) * pi)) * 2) / 3;
  const rad = (lat / 180) * pi,
    magic = 1 - 0.00669342162296594323 * Math.sin(rad) ** 2,
    sqrt = Math.sqrt(magic);
  dlat =
    (dlat * 180) /
    (((6378245 * (1 - 0.00669342162296594323)) / (magic * sqrt)) * pi);
  dlng = (dlng * 180) / ((6378245 / sqrt) * Math.cos(rad) * pi);
  return [lat - dlat, lng - dlng];
}
