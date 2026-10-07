import { profileLocalStorage as localStorage } from "./profileStorage";
import { useRef, useState, type SetStateAction } from "react";
const PREFIX = "tideplan.draft.v1:";
export function encodeDraft(value: unknown) {
  return JSON.stringify(value, (_key, v) =>
    typeof v === "number" && Number.isNaN(v) ? { $draftNaN: true } : v,
  );
}
export function decodeDraft(raw: string): unknown {
  return JSON.parse(raw, (_key, v) =>
    v && typeof v === "object" && v.$draftNaN === true ? NaN : v,
  );
}
interface Entry<T> {
  value: T;
  date: string;
}
interface Envelope<T> {
  version: 1;
  current: string;
  entries: Record<string, Entry<T>>;
}
function read<T>(key: string): Envelope<T> {
  try {
    const data = decodeDraft(
      localStorage.getItem(PREFIX + key) ?? "null",
    ) as Envelope<T>;
    if (
      data?.version === 1 &&
      data.entries &&
      typeof data.entries === "object" &&
      typeof data.current === "string"
    )
      return data;
  } catch {
    /* Preserve malformed storage until the next explicit edit. */
  }
  return { version: 1, current: "", entries: {} };
}
export function useDraft<T>(
  key: string,
  initial: () => T,
  identify: (value: T) => string = () => "current",
  reset?: (value: T) => T,
) {
  const [state, setState] = useState(() => {
    const saved = read<T>(key);
    return {
      key,
      value: saved.entries[saved.current]?.value ?? initial(),
      saved,
      error: "",
    };
  });
  const ref = useRef(state);
  ref.current = state;
  if (state.key !== key) {
    const saved = read<T>(key);
    const next = {
      key,
      value: saved.entries[saved.current]?.value ?? initial(),
      saved,
      error: "",
    };
    ref.current = next;
    setState(next);
  }
  function setValue(action: SetStateAction<T>) {
    const current = ref.current;
    const value =
      typeof action === "function"
        ? (action as (v: T) => T)(current.value)
        : action;
    const id = identify(value);
    const saved: Envelope<T> = {
      version: 1,
      current: id,
      entries: {
        ...current.saved.entries,
        [id]: { value, date: new Date().toISOString() },
      },
    };
    let error = "";
    try {
      localStorage.setItem(PREFIX + key, encodeDraft(saved));
    } catch {
      error = "草稿未能写入本机，请保持页面打开并尽快保存，检查磁盘空间。";
    }
    const next = { key, value, saved, error };
    ref.current = next;
    setState(next);
  }
  function clear(value = ref.current.value) {
    const current = ref.current;
    const entries = { ...current.saved.entries };
    delete entries[identify(value)];
    const saved = { ...current.saved, entries };
    try {
      localStorage.setItem(PREFIX + key, encodeDraft(saved));
    } catch {
      return;
    }
    const next = { ...current, saved };
    ref.current = next;
    setState(next);
  }
  function open(value: T) {
    const current = ref.current;
    const restored = current.saved.entries[identify(value)]?.value ?? value;
    const saved = { ...current.saved, current: identify(value) };
    let error = "";
    try {
      localStorage.setItem(PREFIX + key, encodeDraft(saved));
    } catch {
      error = "无法记录当前草稿位置，请检查磁盘空间";
    }
    const next = { key, value: restored, saved, error };
    ref.current = next;
    setState(next);
    return restored;
  }
  return {
    value: ref.current.value,
    set: setValue,
    clear,
    error: ref.current.error,
    open,
    entries: Object.values(ref.current.saved.entries),
    dirty: !!ref.current.saved.entries[identify(ref.current.value)],
    discard: () => {
      const value = reset ? reset(ref.current.value) : initial();
      clear();
      const next = { ...ref.current, value };
      ref.current = next;
      setState(next);
    },
  };
}
export function DraftNotice<T>({
  draft,
  label,
}: {
  draft: ReturnType<typeof useDraft<T>>;
  label?: (value: T) => string;
}) {
  if (!draft.dirty && !draft.entries.length && !draft.error) return null;
  return (
    <div className="draft-notice" role="status">
      <span>
        {draft.error ||
          (draft.dirty
            ? "编辑草稿已暂存本机，切换页面或重启可继续；尚未提交到正式计划。"
            : "有其他暂存草稿可继续编辑。")}
      </span>
      {label && (
        <select
          aria-label="恢复暂存草稿"
          value=""
          onChange={(e) => {
            const entry = draft.entries[Number(e.target.value)];
            if (entry) draft.set(entry.value);
          }}
        >
          <option value="">恢复暂存草稿（{draft.entries.length}）</option>
          {draft.entries.map((entry, i) => (
            <option value={i} key={i}>
              {label(entry.value) || "未命名"} ·{" "}
              {new Date(entry.date).toLocaleDateString()}
            </option>
          ))}
        </select>
      )}
      {draft.dirty && (
        <button type="button" onClick={draft.discard}>
          放弃当前草稿
        </button>
      )}
    </div>
  );
}
