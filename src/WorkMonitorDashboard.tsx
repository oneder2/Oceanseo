import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  FolderGit2,
  KeyRound,
  Link2,
  LoaderCircle,
  RefreshCw,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  generateWorkReport,
  getGWorkspaceCatalog,
  getWorkDashboard,
  rejectWorkDraft,
  saveWorkMonitorConfig,
  scanWorkspaces,
  setWorkProjectMapping,
  syncWorkDraft,
} from "./workMonitorStore";
import type { GWorkspaceProject, WorkDashboard, WorkDraft, WorkMonitorConfig } from "./workMonitorStore";

interface Props {
  aiConfigured: boolean;
  onOpenAiSettings: () => void;
  onToast: (message: string) => void;
}

const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function readableDate(value: string | null) {
  if (!value) return "尚未运行";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function errorMessage(error: unknown) {
  const code = String(error);
  if (code.includes("openai_api_key_invalid")) return "OpenAI API 密钥无效";
  if (code.includes("openai_rate_limited")) return "OpenAI 请求过于频繁或额度不足";
  if (code.includes("ai_settings_missing")) return "请先在偏好设置中配置 AI 服务";
  if (code.includes("ai_base_url_invalid")) return "AI 服务 BASE_URL 无效";
  if (code.includes("openai_connection_failed")) return "无法连接 AI 服务，请检查 BASE_URL 和网络";
  if (code.includes("gworkspace_catalog")) return "GWorkspace 项目目录暂不可用";
  if (code.includes("gworkspace_adapter")) return "GWorkspace 同步适配器不可用";
  if (code.includes("workspace_root_unavailable")) return "个人项目目录不可访问";
  if (code.includes("work_scan_already_running")) return "项目检查正在运行";
  if (code.includes("gworkspace_sync_failed")) return "GWorkspace 未接受本次更新，草稿仍保留";
  return "操作未完成，请检查配置后重试";
}

export default function WorkMonitorDashboard({ aiConfigured, onOpenAiSettings, onToast }: Props) {
  const [dashboard, setDashboard] = useState<WorkDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [catalog, setCatalog] = useState<GWorkspaceProject[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [configDraft, setConfigDraft] = useState<WorkMonitorConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [draftEdits, setDraftEdits] = useState<Record<string, Pick<WorkDraft, "targetPublicId" | "highlightZh" | "highlightEn">>>({});

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError("");
    try {
      const nextDashboard = await getWorkDashboard();
      setDashboard(nextDashboard);
      setConfigDraft(nextDashboard.config);
    } catch (error) {
      const message = errorMessage(error);
      setDashboardError(message);
      onToast(message);
    } finally {
      setDashboardLoading(false);
    }
  }, [onToast]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError("");
    try {
      setCatalog(await getGWorkspaceCatalog());
    } catch (error) {
      setCatalogError(errorMessage(error));
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    void loadCatalog();
  }, [loadCatalog, loadDashboard]);

  useEffect(() => {
    if (!dashboard) return;
    const nextEdits: typeof draftEdits = {};
    for (const draft of dashboard.drafts) {
      nextEdits[draft.id] = {
        targetPublicId: draft.targetPublicId,
        highlightZh: draft.highlightZh,
        highlightEn: draft.highlightEn,
      };
    }
    setDraftEdits(nextEdits);
  }, [dashboard]);

  const pendingDrafts = dashboard?.drafts.filter((draft) => draft.status === "pending") ?? [];
  const pipeline = useMemo(() => [
    { label: "扫描", note: dashboard?.latestScan ? readableDate(dashboard.latestScan.finishedAt) : "等待首次检查", done: Boolean(dashboard?.latestScan), icon: FolderGit2 },
    { label: "分析", note: dashboard?.latestReport ? "周报已生成" : "等待 AI 复盘", done: Boolean(dashboard?.latestReport), icon: Bot },
    { label: "审核", note: pendingDrafts.length ? `${pendingDrafts.length} 项待确认` : "队列已清空", done: Boolean(dashboard?.latestReport) && !pendingDrafts.length, icon: ShieldCheck },
    { label: "同步", note: dashboard?.drafts.some((draft) => draft.status === "synced") ? "已有同步回执" : "只在批准后执行", done: dashboard?.drafts.some((draft) => draft.status === "synced") ?? false, icon: Send },
  ], [dashboard, pendingDrafts.length]);

  async function perform(key: string, operation: () => Promise<WorkDashboard>, success: string) {
    if (busy) return;
    setBusy(key);
    try {
      const next = await operation();
      setDashboard(next);
      setConfigDraft(next.config);
      onToast(success);
    } catch (error) {
      onToast(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleMapping(projectId: string, publicId: string) {
    const target = catalog.find((project) => project.publicId === publicId) ?? null;
    await perform(`mapping-${projectId}`, () => setWorkProjectMapping(projectId, target), target ? "项目映射已保存" : "项目映射已清除");
  }

  function updateDraft(id: string, field: "targetPublicId" | "highlightZh" | "highlightEn", value: string) {
    setDraftEdits((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? { targetPublicId: null, highlightZh: "", highlightEn: "" }),
        [field]: field === "targetPublicId" ? value || null : value,
      },
    }));
  }

  if (dashboardLoading) {
    return <div className="work-loading"><LoaderCircle size={20} className="spin" />正在读取工作观察记录</div>;
  }

  if (dashboardError || !dashboard || !configDraft) {
    return (
      <div className="work-load-error" role="alert">
        <AlertTriangle size={22} />
        <strong>工作观察记录未能读取</strong>
        <span>{dashboardError || "本地观察数据库暂不可用"}</span>
        <button className="secondary-button" type="button" onClick={() => void loadDashboard()}><RefreshCw size={15} />重新读取</button>
      </div>
    );
  }

  const catalogUnavailable = catalogLoading || Boolean(catalogError);

  return (
    <div className="work-monitor">
      <section className="work-pipeline" aria-label="每周工作观察流程">
        {pipeline.map((step, index) => {
          const Icon = step.icon;
          return (
            <div className={`pipeline-step ${step.done ? "is-done" : ""}`} key={step.label}>
              <span className="pipeline-icon">{step.done ? <Check size={15} /> : <Icon size={16} />}</span>
              <div><strong>{step.label}</strong><small>{step.note}</small></div>
              {index < pipeline.length - 1 && <ArrowRight className="pipeline-arrow" size={15} />}
            </div>
          );
        })}
      </section>

      {(catalogLoading || catalogError) && (
        <section className={`work-catalog-status ${catalogError ? "has-error" : ""}`} aria-live="polite">
          {catalogLoading ? <LoaderCircle size={16} className="spin" /> : <AlertTriangle size={16} />}
          <span>
            <strong>{catalogLoading ? "正在读取 GWorkspace 项目目录" : "GWorkspace 项目目录暂不可用"}</strong>
            <small>{catalogLoading ? "工作观察数据已经独立加载。" : "项目检查与 AI 周报仍可使用，映射和同步暂时停用。"}</small>
          </span>
          {catalogError && <button className="secondary-button" type="button" onClick={() => void loadCatalog()}><RefreshCw size={14} />重试目录</button>}
        </section>
      )}

      <section className="work-overview" aria-label="本周观察概况">
        <div className="work-status-block">
          <div className="work-status-copy">
            <span><Activity size={15} />本周观察</span>
            <strong>{dashboard.latestScan?.summary ?? "尚未检查个人项目目录"}</strong>
            <p>下一次自动检查：{readableDate(dashboard.nextScheduledAt)}</p>
          </div>
          <div className="work-primary-actions">
            <button className="secondary-button" type="button" onClick={() => setConfigOpen((value) => !value)}>
              <Settings2 size={16} />配置
            </button>
            <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void perform("scan", scanWorkspaces, "项目检查已完成")}>
              {busy === "scan" ? <LoaderCircle size={17} className="spin" /> : <RefreshCw size={17} />}
              立即检查
            </button>
          </div>
        </div>
        <div className="work-metrics">
          <div><span>发现项目</span><strong>{dashboard.latestScan?.projectCount ?? 0}</strong></div>
          <div><span>近期活跃</span><strong>{dashboard.latestScan?.activeCount ?? 0}</strong></div>
          <div><span>明显变化</span><strong>{dashboard.latestScan?.significantCount ?? 0}</strong></div>
          <div><span>待审核</span><strong>{pendingDrafts.length}</strong></div>
        </div>
      </section>

      {configOpen && (
        <section className="work-config" aria-label="工作观察配置">
          <header><div><Settings2 size={17} /><span><strong>观察配置</strong><small>配置只保存在 Oceanseo 本地数据库</small></span></div><button type="button" onClick={() => setConfigOpen(false)} aria-label="收起配置" title="收起配置"><X size={16} /></button></header>
          <div className="work-config-grid">
            <label className="work-path-field"><span>个人项目目录</span><input value={configDraft.workspaceRoot} onChange={(event) => setConfigDraft({ ...configDraft, workspaceRoot: event.target.value })} /></label>
            <label className="work-path-field"><span>GWorkspace 目录</span><input value={configDraft.gworkspaceRoot} onChange={(event) => setConfigDraft({ ...configDraft, gworkspaceRoot: event.target.value })} /></label>
            <label><span>每周检查日</span><select value={configDraft.scheduleWeekday} onChange={(event) => setConfigDraft({ ...configDraft, scheduleWeekday: Number(event.target.value) })}>{weekdays.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></label>
            <label><span>检查时间</span><input type="time" value={configDraft.scheduleTime} onChange={(event) => setConfigDraft({ ...configDraft, scheduleTime: event.target.value })} /></label>
            <label><span>明显变化阈值</span><div className="threshold-input"><input type="range" min="10" max="100" step="5" value={configDraft.significanceThreshold} onChange={(event) => setConfigDraft({ ...configDraft, significanceThreshold: Number(event.target.value) })} /><strong>{configDraft.significanceThreshold}</strong></div></label>
            <label><span>排除项目</span><input value={configDraft.excludedProjects.join(", ")} onChange={(event) => setConfigDraft({ ...configDraft, excludedProjects: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="以英文逗号分隔" /></label>
          </div>
          <footer>
            <label className="work-enabled"><input type="checkbox" checked={configDraft.enabled} onChange={(event) => setConfigDraft({ ...configDraft, enabled: event.target.checked })} /><span>启用每周自动检查</span></label>
            <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void perform("config", () => saveWorkMonitorConfig(configDraft), "观察配置已保存")}><Save size={16} />保存配置</button>
          </footer>
        </section>
      )}

      <div className="work-main-grid">
        <section className="work-section work-projects">
          <header className="work-section-head"><div><span>项目活动</span><h2>近期工作脉冲</h2></div><small>{dashboard.projects.length} 个 Git 项目</small></header>
          <div className="work-project-list">
            {dashboard.projects.map((project) => (
              <article className="work-project-row" key={project.id}>
                <div className={`activity-score status-${project.activityStatus}`}><strong>{project.activityScore}</strong><span>活跃度</span></div>
                <div className="work-project-copy">
                  <div><strong>{project.name}</strong><span>{project.branch}{project.version ? ` · v${project.version}` : ""}</span></div>
                  <p>{project.latestCommit ?? "本周期内没有新提交"}</p>
                  <small>{project.commitCount} 次提交 · {project.changedFileCount} 个变更文件 · {project.untrackedFileCount} 个未跟踪文件</small>
                </div>
                <label className="mapping-select">
                  <Link2 size={14} />
                  <select value={project.targetPublicId ?? ""} disabled={Boolean(busy) || catalogUnavailable} onChange={(event) => void handleMapping(project.id, event.target.value)} aria-label={`${project.name} 的 GWorkspace 映射`}>
                    <option value="">未映射</option>
                    {project.targetPublicId && !catalog.some((target) => target.publicId === project.targetPublicId) && <option value={project.targetPublicId}>{project.targetTitle ?? project.targetPublicId}</option>}
                    {catalog.map((target) => <option value={target.publicId} key={target.publicId}>{target.title.zh}</option>)}
                  </select>
                  <ChevronDown size={13} />
                </label>
              </article>
            ))}
            {!dashboard.projects.length && <div className="work-empty"><FolderGit2 size={22} /><strong>等待首次项目检查</strong><span>运行检查后，这里会显示 Git 活动元数据。</span></div>}
          </div>
        </section>

        <section className="work-section work-report">
          <header className="work-section-head"><div><span>AI 本周总结</span><h2>只依据 Git 元数据复盘</h2></div>{dashboard.latestReport && <small>{readableDate(dashboard.latestReport.createdAt)}</small>}</header>
          {dashboard.latestReport ? (
            <div className="report-copy"><p>{dashboard.latestReport.weeklySummary}</p><div><Sparkles size={15} /><span><strong>下一步反馈</strong>{dashboard.latestReport.feedback}</span></div></div>
          ) : (
            <div className="work-empty compact"><Bot size={22} /><strong>尚未生成周报</strong><span>先完成项目检查，再使用 AI 复盘本周期变化。</span></div>
          )}
          <div className="work-ai-action">
            <div className={`work-ai-status ${aiConfigured ? "is-ready" : ""}`}><KeyRound size={15} /><span>{aiConfigured ? "使用偏好设置中的 AI 服务" : "AI 服务尚未配置"}</span><button type="button" onClick={onOpenAiSettings}>设置</button></div>
            <button type="button" disabled={!dashboard.latestScan || !aiConfigured || Boolean(busy)} onClick={() => dashboard.latestScan && void perform("report", () => generateWorkReport(dashboard.latestScan!.id), "AI 周报和审核草稿已生成")}>
              {busy === "report" ? <LoaderCircle size={16} className="spin" /> : <Bot size={16} />}生成周报
            </button>
          </div>
        </section>
      </div>

      <section className="work-section review-queue">
        <header className="work-section-head"><div><span>待审核同步草稿</span><h2>确认后更新 GWorkspace</h2></div><small><ShieldCheck size={13} />不会自动公开</small></header>
        <div className="draft-list">
          {pendingDrafts.map((draft) => {
            const edit = draftEdits[draft.id];
            if (!edit) return null;
            const ready = Boolean(edit.targetPublicId && edit.highlightZh.trim() && edit.highlightEn.trim());
            return (
              <article className="review-draft" key={draft.id}>
                <header><div><CircleDot size={15} /><strong>{draft.projectName}</strong><span>{draft.evidence.join(" · ")}</span></div><small>{readableDate(draft.createdAt)}</small></header>
                <div className="draft-fields">
                  <label><span>GWorkspace 项目</span><select value={edit.targetPublicId ?? ""} disabled={catalogUnavailable} onChange={(event) => updateDraft(draft.id, "targetPublicId", event.target.value)}><option value="">请选择目标项目</option>{edit.targetPublicId && !catalog.some((target) => target.publicId === edit.targetPublicId) && <option value={edit.targetPublicId}>{draft.targetTitle ?? edit.targetPublicId}</option>}{catalog.map((target) => <option value={target.publicId} key={target.publicId}>{target.title.zh} · {target.publicId}</option>)}</select></label>
                  <label><span>中文项目进展</span><textarea maxLength={240} rows={2} value={edit.highlightZh} onChange={(event) => updateDraft(draft.id, "highlightZh", event.target.value)} /></label>
                  <label><span>英文项目进展</span><textarea maxLength={240} rows={2} value={edit.highlightEn} onChange={(event) => updateDraft(draft.id, "highlightEn", event.target.value)} /></label>
                </div>
                <footer><span><ShieldCheck size={14} />同步前将再次进行契约校验</span><div><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void perform(`reject-${draft.id}`, () => rejectWorkDraft(draft.id), "草稿已拒绝并保留记录")}>拒绝</button><button className="primary-button" type="button" disabled={!ready || catalogUnavailable || Boolean(busy)} onClick={() => void perform(`sync-${draft.id}`, () => syncWorkDraft(draft.id, edit.targetPublicId!, edit.highlightZh, edit.highlightEn), "项目进展已同步到 GWorkspace")}><Send size={15} />批准并同步</button></div></footer>
              </article>
            );
          })}
          {!pendingDrafts.length && <div className="work-empty compact"><CheckCircle2 size={22} /><strong>审核队列为空</strong><span>只有达到明显变化并被 AI 建议同步的项目才会生成草稿。</span></div>}
        </div>
      </section>

      <section className="work-history" aria-label="最近运行记录">
        <span><Clock3 size={14} />最近运行</span>
        {dashboard.recentScans.slice(0, 5).map((scan) => <div key={scan.id}><strong>{readableDate(scan.finishedAt)}</strong><small>{scan.projectCount} 个项目 / {scan.significantCount} 个明显变化</small></div>)}
      </section>
    </div>
  );
}
