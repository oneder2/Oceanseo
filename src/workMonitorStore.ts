import { invoke, isTauri } from "./personal/invoke";

export interface WorkMonitorConfig {
  enabled: boolean;
  workspaceRoot: string;
  gworkspaceRoot: string;
  scheduleWeekday: number;
  scheduleTime: string;
  significanceThreshold: number;
  excludedProjects: string[];
}

export interface WorkProject {
  id: string;
  name: string;
  branch: string;
  version: string | null;
  commitCount: number;
  changedFileCount: number;
  untrackedFileCount: number;
  latestCommit: string | null;
  latestCommitAt: string | null;
  activityScore: number;
  activityStatus: "steady" | "active" | "significant";
  lastScannedAt: string;
  targetPublicId: string | null;
  targetTitle: string | null;
}

export interface WorkScan {
  id: string;
  startedAt: string;
  finishedAt: string;
  projectCount: number;
  activeCount: number;
  significantCount: number;
  summary: string;
}

export interface WorkReport {
  id: string;
  scanId: string;
  weeklySummary: string;
  feedback: string;
  projectAnalysis: Array<{
    projectId: string;
    status: string;
    summary: string;
    risk: string;
    nextStep: string;
    shouldSync: boolean;
  }>;
  createdAt: string;
}

export interface WorkDraft {
  id: string;
  reportId: string;
  scanId: string;
  projectId: string;
  projectName: string;
  targetPublicId: string | null;
  targetTitle: string | null;
  highlightZh: string;
  highlightEn: string;
  evidence: string[];
  status: "pending" | "synced" | "rejected";
  createdAt: string;
  syncedAt: string | null;
  syncError: string | null;
}

export interface WorkDashboard {
  config: WorkMonitorConfig;
  nextScheduledAt: string;
  projects: WorkProject[];
  latestScan: WorkScan | null;
  recentScans: WorkScan[];
  latestReport: WorkReport | null;
  drafts: WorkDraft[];
}

export interface GWorkspaceProject {
  publicId: string;
  slug: string;
  title: { zh: string; en: string };
  status: string;
  updatedAt: string;
}

const demoScan: WorkScan = {
  id: "22222222-2222-4222-8222-222222222222",
  startedAt: "2026-09-01T13:20:00Z",
  finishedAt: "2026-09-01T13:20:04Z",
  projectCount: 8,
  activeCount: 5,
  significantCount: 2,
  summary: "检查了 8 个项目，5 个近期活跃，2 个达到明显变化阈值。",
};

let demoDashboard: WorkDashboard = {
  config: {
    enabled: true,
    workspaceRoot: "/home/gellar/Desktop/program/personal",
    gworkspaceRoot: "/home/gellar/Desktop/program/personal/GWorkspace",
    scheduleWeekday: 0,
    scheduleTime: "09:30",
    significanceThreshold: 45,
    excludedProjects: ["archive"],
  },
  nextScheduledAt: "2026-09-07T09:30:00-04:00",
  latestScan: demoScan,
  recentScans: [demoScan],
  projects: [
    { id: "p1", name: "Oceanseo", branch: "main", version: "0.3.1", commitCount: 7, changedFileCount: 18, untrackedFileCount: 2, latestCommit: "Add reviewed weekly project updates", latestCommitAt: "2026-09-01T12:40:00Z", activityScore: 92, activityStatus: "significant", lastScannedAt: demoScan.finishedAt, targetPublicId: "project:oceanseo", targetTitle: "Oceanseo" },
    { id: "p2", name: "GWorkspace", branch: "main", version: "3.1.0", commitCount: 3, changedFileCount: 9, untrackedFileCount: 0, latestCommit: "Refine project facts view", latestCommitAt: "2026-08-30T18:10:00Z", activityScore: 66, activityStatus: "significant", lastScannedAt: demoScan.finishedAt, targetPublicId: "project:gworkspace", targetTitle: "GWorkspace" },
    { id: "p3", name: "Oceannect", branch: "develop", version: null, commitCount: 1, changedFileCount: 2, untrackedFileCount: 0, latestCommit: "Update connection notes", latestCommitAt: "2026-08-29T14:00:00Z", activityScore: 26, activityStatus: "active", lastScannedAt: demoScan.finishedAt, targetPublicId: null, targetTitle: null },
  ],
  latestReport: {
    id: "report-demo",
    scanId: demoScan.id,
    weeklySummary: "本周工作集中在个人工作台与项目事实同步。Oceanseo 已形成从本地观察、AI 复盘到人工审核的完整链路，GWorkspace 同步适配器也已进入验证阶段。",
    feedback: "优先完成端到端验收，再扩大扫描范围。对未映射项目保持本地观察，避免在名称相似时自动推断目标。",
    projectAnalysis: [],
    createdAt: "2026-09-01T13:24:00Z",
  },
  drafts: [
    { id: "11111111-1111-4111-8111-111111111111", reportId: "report-demo", scanId: demoScan.id, projectId: "p1", projectName: "Oceanseo", targetPublicId: "project:oceanseo", targetTitle: "Oceanseo", highlightZh: "新增每周项目观察、AI 复盘与人工审核同步工作流。", highlightEn: "Added a weekly project review workflow with AI summaries and reviewed synchronization.", evidence: ["7 commits", "18 changed files", "version 0.3.1"], status: "pending", createdAt: "2026-09-01T13:24:00Z", syncedAt: null, syncError: null },
  ],
};

const demoCatalog: GWorkspaceProject[] = [
  { publicId: "project:oceanseo", slug: "oceanseo", title: { zh: "Oceanseo", en: "Oceanseo" }, status: "published", updatedAt: "2026-08-20T12:00:00Z" },
  { publicId: "project:gworkspace", slug: "gworkspace", title: { zh: "GWorkspace", en: "GWorkspace" }, status: "published", updatedAt: "2026-08-28T12:00:00Z" },
];

const clone = <T,>(value: T): T => structuredClone(value);

export async function getWorkDashboard() {
  return isTauri() ? invoke<WorkDashboard>("get_work_dashboard") : clone(demoDashboard);
}

export async function scanWorkspaces() {
  if (isTauri()) return invoke<WorkDashboard>("scan_workspaces");
  demoDashboard = { ...demoDashboard, latestScan: { ...demoScan, finishedAt: new Date().toISOString() } };
  return clone(demoDashboard);
}

export async function runScheduledWorkScan() {
  return isTauri() ? invoke<WorkDashboard | null>("run_scheduled_work_scan") : null;
}

export async function generateWorkReport(scanId: string) {
  if (isTauri()) return invoke<WorkDashboard>("generate_work_report", { scanId });
  return clone(demoDashboard);
}

export async function getGWorkspaceCatalog() {
  return isTauri() ? invoke<GWorkspaceProject[]>("get_gworkspace_catalog") : clone(demoCatalog);
}

export async function setWorkProjectMapping(projectId: string, target: GWorkspaceProject | null) {
  if (isTauri()) return invoke<WorkDashboard>("set_work_project_mapping", { projectId, target });
  demoDashboard.projects = demoDashboard.projects.map((project) => project.id === projectId ? { ...project, targetPublicId: target?.publicId ?? null, targetTitle: target?.title.zh ?? null } : project);
  return clone(demoDashboard);
}

export async function rejectWorkDraft(draftId: string) {
  if (isTauri()) return invoke<WorkDashboard>("reject_work_draft", { draftId });
  demoDashboard.drafts = demoDashboard.drafts.map((draft) => draft.id === draftId ? { ...draft, status: "rejected" } : draft);
  return clone(demoDashboard);
}

export async function syncWorkDraft(draftId: string, targetProjectId: string, highlightZh: string, highlightEn: string) {
  if (isTauri()) return invoke<WorkDashboard>("sync_work_draft", { draftId, targetProjectId, highlightZh, highlightEn });
  demoDashboard.drafts = demoDashboard.drafts.map((draft) => draft.id === draftId ? { ...draft, targetPublicId: targetProjectId, highlightZh, highlightEn, status: "synced", syncedAt: new Date().toISOString() } : draft);
  return clone(demoDashboard);
}

export async function saveWorkMonitorConfig(config: WorkMonitorConfig) {
  if (isTauri()) return invoke<WorkDashboard>("save_work_monitor_config", { config });
  demoDashboard = { ...demoDashboard, config };
  return clone(demoDashboard);
}
