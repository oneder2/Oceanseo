import { useEffect, useReducer, useRef, useState } from "react";
import { APP_STATE_KEYS, persistAppState } from "../appDataStore";
import { blankPattern, isPattern } from "./model";
import { createDocument, documentReducer } from "./document";

function loadDocument() {
  try {
    const p: unknown = JSON.parse(
      localStorage.getItem(APP_STATE_KEYS.beads) ?? "null",
    );
    return createDocument(isPattern(p) ? p : blankPattern());
  } catch {
    return createDocument(blankPattern());
  }
}
export function useBeadDocument() {
  const [state, dispatch] = useReducer(
    documentReducer,
    undefined,
    loadDocument,
  );
  const [saveStatus, setSaveStatus] = useState("正在保存…");
  const latest = useRef(state.present);
  latest.current = state.present;
  useEffect(() => {
    let active = true;
    setSaveStatus("正在保存…");
    const timer = window.setTimeout(() => {
      void persistAppState(APP_STATE_KEYS.beads, state.present)
        .then(() => {
          if (active) setSaveStatus("已保存到本机");
        })
        .catch(() => {
          if (active) setSaveStatus("保存失败，本地副本已保留");
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [state.present]);
  useEffect(
    () => () => {
      void persistAppState(APP_STATE_KEYS.beads, latest.current).catch(
        () => undefined,
      );
    },
    [],
  );
  return { state, dispatch, saveStatus };
}
