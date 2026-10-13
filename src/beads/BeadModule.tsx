import { lazy, Suspense, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { flushAppData } from "../appDataStore";
import { platform } from "../platform";
import { pendingHandoff } from "./transfer";
import PageLoadBoundary from "../PageLoadBoundary";
import "./module.css";

const Editor = lazy(() => import("./BeadWorkbench"));
const Works = lazy(() => import("./WorksHome"));
const Progress = lazy(() => import("../BeadMobileView"));
export type BeadSection = "editor" | "works" | "progress";

export default function BeadModule({ onSettings }: { onSettings: () => void }) {
  const [section, setSection] = useState<BeadSection>(platform.mobile ? "progress" : "editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    void pendingHandoff().then(pending => { if (active && pending) setSection("works"); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  async function open(next: BeadSection) {
    if (busy || section === next) return;
    setBusy(true); setError("");
    try {
      await flushAppData();
      setSection(next);
    } catch { setError("当前作品尚未保存，请重试后再切换。"); }
    finally { setBusy(false); }
  }
  return <section className="bead-module" aria-label="拼豆图纸工具">
    <nav className="bead-module-nav" aria-label="拼豆工具内容">
      {([ ["editor", "图纸编辑"], ["works", "作品管理"], ["progress", "拼放进度"] ] as const)
        .filter(([id]) => !platform.mobile || id !== "editor")
        .map(([id, label]) => <button type="button" key={id} aria-current={section === id ? "page" : undefined} disabled={busy} onClick={() => void open(id)}>{label}</button>)}
    </nav>
    {error && <p role="alert">{error}</p>}
    <PageLoadBoundary><Suspense fallback={<p role="status">正在打开拼豆工具…</p>}>
      {section === "editor" ? <Editor onSettings={onSettings}/> : section === "works" ? <Works onNavigate={next => void open(next)}/> : <Progress/>}
    </Suspense></PageLoadBoundary>
  </section>;
}
