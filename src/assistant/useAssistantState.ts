import { profileLocalStorage as localStorage } from "../profileStorage";
import { useEffect, useRef, useState } from "react";
import { requireModule } from "../modules/capabilities";
import {
  APP_STATE_KEYS,
  persistAppState,
  registerStateFlusher,
} from "../appDataStore";
import {
  defaultAssistant,
  isAssistantState,
  type AssistantState,
} from "./model";

export function useAssistantState(ready: boolean) {
  const [state, setState] = useState(defaultAssistant);
  const [loaded, setLoaded] = useState(false),
    [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const current = useRef(state);
  current.current = state;
  useEffect(() => {
    if (!ready) return;
    try {
      const raw = localStorage.getItem(APP_STATE_KEYS.assistant);
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        if (!isAssistantState(saved))
          throw Error("助手记录格式异常，已保留原数据。请从有效备份恢复。");
        current.current = saved;
        setState(saved);
      }
      setLoaded(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "助手记录读取失败");
    }
  }, [ready]);
  useEffect(() => {
    if (!loaded) return;
    return registerStateFlusher(() => {
      void persistAppState(APP_STATE_KEYS.assistant, current.current).catch(
        () => undefined,
      );
    });
  }, [loaded]);
  function change(update: (s: AssistantState) => AssistantState) {
    if (!loaded) return;
    const next = update(current.current);
    try { requireModule("goals"); } catch (error) { setSaveError(String(error)); return; }
    if (!isAssistantState(next)) {
      setSaveError("助手记录未保存：内容超出限制或格式无效");
      return;
    }
    current.current = next;
    setState(next);
    void persistAppState(APP_STATE_KEYS.assistant, next)
      .then(() => setSaveError(""))
      .catch(() =>
        setSaveError("保存暂未完成，本地副本已保留；可在顶栏重试。"),
      );
  }
  return { state, change, loaded, loadError, saveError };
}
