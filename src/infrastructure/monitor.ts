import { invoke, isTauri } from "../personal/invoke";
import { useEffect, useRef, useState } from "react";
import { requireModule } from "../modules/capabilities";
import type { Host, Infrastructure, Metrics, Sample } from "./model";
import { latestSample, validMetrics } from "./model";

export function useHostMonitor(
  data: Infrastructure,
  ready: boolean,
  update: (fn: (d: Infrastructure) => Infrastructure) => Promise<void>,
) {
  const current = useRef(data),
    save = useRef(update),
    active = useRef(new Set<string>()),
    attempts = useRef(new Map<string, number>());
  const [busy, setBusy] = useState<string[]>([]),
    [error, setError] = useState("");
  current.current = data;
  save.current = update;
  async function check(host: Host) {
    requireModule("infrastructure");
    if (active.current.has(host.id)) return;
    if (!isTauri()) throw Error("请在安装版检查服务；浏览器预览不发起探测");
    active.current.add(host.id);
    setBusy([...active.current]);
    attempts.current.set(host.id, Date.now());
    setError("");
    try {
      const samples: Sample[] = [];
      for (const source of ["http", "collector"] as const) {
        const url = source === "http" ? host.monitorUrl : host.collectorUrl;
        if (!url) continue;
        const started = Date.now();
        try {
          const reply = await invoke<{
            ok: boolean;
            detail: string;
            metrics?: Metrics;
          }>("check_host_endpoint", { hostId: host.id, url, source });
          if (reply.metrics && !validMetrics(reply.metrics))
            throw Error("采集数据格式不完整");
          samples.push({
            id: crypto.randomUUID(),
            checkedAt: new Date().toISOString(),
            target: url,
            source,
            ok: reply.ok,
            detail: reply.detail,
            latencyMs: Math.min(60000, Date.now() - started),
            ...(reply.metrics ? { metrics: reply.metrics } : {}),
          });
        } catch (e) {
          samples.push({
            id: crypto.randomUUID(),
            checkedAt: new Date().toISOString(),
            target: url,
            source,
            ok: false,
            detail: String(e).slice(0, 500),
            latencyMs: Math.min(60000, Date.now() - started),
          });
        }
      }
      if (samples.length)
        await save.current((d) => ({
          ...d,
          hosts: d.hosts.map((h) =>
            h.id === host.id
              ? {
                  ...h,
                  samples: [
                    ...h.samples,
                    ...samples.filter(
                      (s) =>
                        s.target ===
                        (s.source === "http" ? h.monitorUrl : h.collectorUrl),
                    ),
                  ].slice(-120),
                }
              : h,
          ),
        }));
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      active.current.delete(host.id);
      setBusy([...active.current]);
    }
  }
  const run = useRef(check);
  run.current = check;
  useEffect(() => {
    if (!ready || !isTauri()) return;
    let cancelled = false,
      running = false;
    const tick = async () => {
      if (cancelled || running || document.visibilityState !== "visible")
        return;
      running = true;
      try {
        for (const h of current.current.hosts) {
          if (cancelled) break;
          if (
            h.archived ||
            !h.intervalMinutes ||
            (!h.monitorUrl && !h.collectorUrl)
          )
            continue;
          const last = Math.max(
            attempts.current.get(h.id) || 0,
            ...(["http", "collector"] as const).map(
              (s) => Date.parse(latestSample(h, s)?.checkedAt || "") || 0,
            ),
          );
          if (Date.now() - last >= h.intervalMinutes * 60000)
            await run.current(h).catch(() => {});
        }
      } finally {
        running = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ready]);
  return { check, busy, error };
}
