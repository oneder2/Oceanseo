import { profileLocalStorage as localStorage } from "../profileStorage";
import { useEffect, useRef, useState } from "react";
import {
  APP_STATE_KEYS,
  assertAppWritable,
  persistAppState,
} from "../appDataStore";
import {
  emptyInfrastructure,
  validInfrastructure,
  type Infrastructure,
} from "./model";
export function useInfrastructure(ready: boolean) {
  const [data, setData] = useState(emptyInfrastructure),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  const current = useRef(data),
    busy = useRef(false);
  useEffect(() => {
    if (!ready) return;
    try {
      const raw = localStorage.getItem(APP_STATE_KEYS.infrastructure);
      const next = raw ? JSON.parse(raw) : emptyInfrastructure();
      if (!validInfrastructure(next))
        throw Error("主机档案格式无效，请保留原数据并从备份恢复");
      current.current = next;
      setData(next);
      setLoaded(true);
    } catch (e) {
      setError(String(e));
    }
  }, [ready]);
  async function update(fn: (d: Infrastructure) => Infrastructure) {
    if (!loaded) throw Error("主机档案尚未加载");
    if (busy.current) throw Error("正在保存，请稍后重试");
    assertAppWritable();
    const next = fn(current.current);
    if (!validInfrastructure(next))
      throw Error(
        "资料无效或超过容量：最多 100 台主机、每台 100 项服务/期限、300 条维护/付款记录及 2 MB 总量",
      );
    busy.current = true;
    try {
      await persistAppState(APP_STATE_KEYS.infrastructure, next);
      current.current = next;
      setData(next);
      setError("");
    } catch (e) {
      setLoaded(false);
      setError("保存未完成，待写入内容已保留，请重新载入后核对");
      throw e;
    } finally {
      busy.current = false;
    }
  }
  return { data, loaded, error, update, current };
}
