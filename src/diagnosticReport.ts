import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "@tauri-apps/api/core";

export interface DiagnosticReportInput {
  appVersion: string;
  platform: string;
  view: string;
  userAgent: string;
  aiConfigured: boolean;
  aiModel: string;
  aiBaseUrl: string;
  automaticSyncState: string;
  automaticSyncMessage: string;
  reminderEnabled: boolean;
  reminderTimes: readonly string[];
  counts: {
    tasks: number;
    completedTasks: number;
    countdowns: number;
    purchaseItems: number;
    people: number;
    trainingPlans: number;
    trips: number;
  };
}

function redactedOrigin(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return "invalid-or-unset";
  }
}

function fileNameDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function exportDiagnosticReport(input: DiagnosticReportInput) {
  if (!isTauri()) return false;
  const report = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    app: {
      version: input.appVersion,
      platform: input.platform,
      view: input.view,
      userAgent: input.userAgent.slice(0, 240),
    },
    ai: {
      configured: input.aiConfigured,
      model: input.aiModel ? input.aiModel.slice(0, 120) : "unset",
      baseUrl: redactedOrigin(input.aiBaseUrl),
    },
    sync: {
      automaticState: input.automaticSyncState,
      message: input.automaticSyncMessage.slice(0, 240),
    },
    reminders: {
      enabled: input.reminderEnabled,
      times: input.reminderTimes.slice(0, 2),
    },
    counts: input.counts,
    privacy: {
      excluded: [
        "任务标题、笔记和正文",
        "人物、训练、旅行和主机资料",
        "AI API_KEY、同步 Token 和密码",
        "采购内容与食谱文本",
      ],
    },
  };
  const path = await save({
    title: "导出 Oceanseo 脱敏诊断",
    defaultPath: `Oceanseo-diagnostics-${fileNameDate()}.json`,
    filters: [{ name: "JSON 诊断", extensions: ["json"] }],
  });
  if (!path) return false;
  await writeTextFile(path, `${JSON.stringify(report, null, 2)}\n`);
  return true;
}
