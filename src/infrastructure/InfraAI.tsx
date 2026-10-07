import { useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import GoalOverlay from "../goals/GoalOverlay";
import { useJob } from "../life/agent";
import {
  attention,
  eventReference,
  infrastructureContext,
  maintenanceDraft,
  newHost,
  validHost,
  validReport,
  type Host,
  type Infrastructure,
  type InfraReport,
} from "./model";
import type { Task, TaskDraft } from "../types";

export function importHostResult(value: unknown): Host {
  if (!value || typeof value !== "object") throw Error("订单识别结果不完整");
  const v = value as Record<string, unknown>,
    h = newHost();
  for (const k of [
    "name",
    "provider",
    "plan",
    "region",
    "os",
    "purpose",
    "source",
    "constraints",
    "currency",
  ] as const) {
    if (typeof v[k] !== "string") throw Error("订单识别缺少字段");
    h[k] = v[k];
  }
  for (const k of [
    "cpu",
    "ramGb",
    "diskGb",
    "bandwidthMbps",
    "trafficGb",
    "snapshots",
    "amount",
    "renewalAmount",
    "tax",
    "cycleMonths",
  ] as const) {
    if (typeof v[k] !== "number") throw Error("订单识别数值无效");
    h[k] = v[k];
  }
  if (!validHost(h)) throw Error("订单识别结果无效，请缩短内容或手动录入");
  h.source = `AI 识别待核实：${h.source}`.slice(0, 4000);
  return h;
}
export function InfraAI({
  data,
  update,
  onClose,
  onImport,
  onSettings,
  onTask,
  tasks,
}: {
  data: Infrastructure;
  update: (f: (d: Infrastructure) => Infrastructure) => Promise<void>;
  onClose: () => void;
  onImport: (h: Host) => void;
  onSettings: () => void;
  onTask: (d: TaskDraft, ref: string) => void;
  tasks: Task[];
}) {
  const [mode, setMode] = useState("review"),
    [text, setText] = useState(""),
    [image, setImage] = useState(""),
    [imageName, setImageName] = useState(""),
    [consent, setConsent] = useState(false),
    [result, setResult] = useState<InfraReport | null>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const job = useJob(),
    fileJob = useRef(0),
    context = infrastructureContext(data),
    alerts = attention(data);
  const close = () => {
    if (saving) return;
    fileJob.current++;
    job.cancel();
    onClose();
  };
  async function imageFile(file: File | undefined) {
    const token = ++fileJob.current;
    setImage("");
    setImageName("");
    setConsent(false);
    setError("");
    if (!file) return;
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      )
        throw Error("请选择 5 MB 内的 PNG、JPEG 或 WebP 订单截图");
      const raw = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(Error("图片读取失败"));
        reader.readAsDataURL(file);
      });
      if (token === fileJob.current) {
        setImage(raw);
        setImageName(file.name);
      }
    } catch (e) {
      if (token === fileJob.current) setError(String(e));
    }
  }
  function generate() {
    if (!isTauri()) {
      setError("请在安装版调用 AI；本地摘要与手动档案可直接使用");
      return;
    }
    setResult(null);
    void job.run(
      "正在生成，请稍候…",
      () =>
        invoke<unknown>("run_planning_agent", {
          kind: mode === "review" ? "host_review" : "host_import",
          context:
            mode === "review" ? context : { text, imageData: image || null },
        }),
      (v) => {
        if (mode === "import") {
          onImport(importHostResult(v));
          return;
        }
        const report = {
          ...(v as object),
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        };
        if (!validReport(report, data.hosts))
          throw Error("AI 摘要格式无效或引用了不存在的主机，请重试");
        setResult(report);
      },
    );
  }
  return (
    <GoalOverlay
      title="主机 AI 与周摘要"
      kicker="从运行记录找到下一步"
      onClose={close}
    >
      <section className="infra-ai">
        <nav className="infra-tabs" aria-label="主机 AI 功能">
          <button
            aria-pressed={mode === "review"}
            onClick={() => {
              job.cancel();
              setMode("review");
              setConsent(false);
            }}
          >
            运行摘要
          </button>
          <button
            aria-pressed={mode === "import"}
            onClick={() => {
              job.cancel();
              setMode("import");
              setConsent(false);
            }}
          >
            识别订单
          </button>
        </nav>
        {mode === "review" ? (
          <>
            <h3>本地概况 · 最近 7 天</h3>
            <p>
              {data.hosts.filter((h) => !h.archived).length} 台在用 ·{" "}
              {alerts.length} 项待留意 ·{" "}
              {context.hosts.reduce((n, h) => n + h.weekSamples.length, 0)}{" "}
              条近期样本（每台最多取 40 条）
            </p>
            <p>
              这些是应用采样记录，不是连续监控。没有样本的时间段不能推断为正常。
            </p>
            {alerts.slice(0, 6).map((a) => (
              <p key={a.id}>• {a.title}</p>
            ))}
            <details>
              <summary>查看将发送的摘要</summary>
              <pre>{JSON.stringify(context, null, 2)}</pre>
            </details>
            <p>
              仅发送主机名称、项目用途、费用、期限、备份日期与数值样本；不含
              IP、网址、路径、凭据引用、订单号或维护日志。名称和用途也请勿填写秘密。
            </p>
          </>
        ) : (
          <>
            <label>
              订单文本
              <textarea
                rows={6}
                maxLength={12000}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setConsent(false);
                }}
                placeholder="粘贴套餐说明或订单内容，也可选择截图。未注明的配置会标记待核实。"
              />
            </label>
            <label>
              订单截图
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void imageFile(e.target.files?.[0])}
              />
            </label>
            {image && (
              <>
                <img src={image} alt="待识别的订单截图" />
                <small>{imageName} · 识别后不保存图片</small>
                <button
                  className="secondary-button"
                  onClick={() => {
                    fileJob.current++;
                    setImage("");
                    setImageName("");
                    setConsent(false);
                  }}
                >
                  移除截图
                </button>
              </>
            )}
            <p>
              所选图片和文本会发送到你配置的 AI
              服务，请先遮盖姓名、邮箱、付款信息和密码。识别结果仅打开可编辑草稿，核实后再保存。
            </p>
          </>
        )}
        <label>
          <span>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{" "}
            我已检查上述内容，同意发送给已配置的 AI 服务
          </span>
        </label>
        <div className="infra-actions">
          <button
            className="primary-button"
            disabled={
              !consent ||
              job.busy ||
              saving ||
              (mode === "review"
                ? !data.hosts.some((h) => !h.archived)
                : !text.trim() && !image)
            }
            onClick={generate}
          >
            {job.busy
              ? "正在分析…"
              : mode === "review"
                ? "生成 AI 周摘要"
                : "识别并打开档案草稿"}
          </button>
          {job.busy && (
            <button className="secondary-button" onClick={job.cancel}>
              取消等待
            </button>
          )}
          <button
            className="secondary-button"
            onClick={() => {
              close();
              onSettings();
            }}
          >
            AI 配置
          </button>
        </div>
        {job.message && <p role="status">{job.message}</p>}
        {error && (
          <p role="alert" className="infra-error">
            {error}
          </p>
        )}
        {mode === "review" && (
          <>
            {result && (
              <>
                <Report report={result} tasks={tasks} onTask={onTask} />
                <button
                  className="secondary-button"
                  disabled={
                    saving || data.reports.some((r) => r.id === result.id)
                  }
                  onClick={async () => {
                    setSaving(true);
                    setError("");
                    try {
                      await update((d) => ({
                        ...d,
                        reports: [
                          ...d.reports.filter((r) => r.id !== result.id),
                          result,
                        ].slice(-30),
                      }));
                    } catch (e) {
                      setError(String(e));
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {data.reports.some((r) => r.id === result.id)
                    ? "摘要已保存"
                    : "保存摘要"}
                </button>
              </>
            )}
            <details>
              <summary>已保存摘要（最近 30 份）</summary>
              {data.reports
                .slice()
                .reverse()
                .map((r) => (
                  <Report key={r.id} report={r} tasks={tasks} onTask={onTask} />
                ))}
            </details>
          </>
        )}
        <small>
          AI
          只解释和提出建议，不会登录服务器、执行命令、付款或更改服务；任务也需要你检查并保存。摘要由你主动生成，不会定时消耗
          API 额度。
        </small>
      </section>
    </GoalOverlay>
  );
}
function Report({
  report: r,
  onTask,
  tasks,
}: {
  report: InfraReport;
  onTask: (d: TaskDraft, ref: string) => void;
  tasks: Task[];
}) {
  return (
    <article className="infra-subcard">
      <small>{new Date(r.createdAt).toLocaleString("zh-CN")}</small>
      <p className="infra-report">{r.summary}</p>
      {r.observations.map((s, i) => (
        <p key={i}>{s}</p>
      ))}
      {r.suggestions.map((s, i) => {
        const ref = eventReference(`report:${r.id}:${i}`);
        return (
          <div className="infra-subcard" key={i}>
            <strong>{s.title}</strong>
            <p>{s.reason}</p>
            <small>{s.dueDate || "日期待定"}</small>
            <button
              className="secondary-button"
              onClick={() =>
                onTask(maintenanceDraft(s.title, s.reason, s.dueDate), ref)
              }
            >
              {tasks.some((t) => t.origin?.reference === ref)
                ? "查看关联任务"
                : "打开任务草稿"}
            </button>
          </div>
        );
      })}
    </article>
  );
}
