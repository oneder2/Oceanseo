import { dateKey } from "../dateUtils";
import { validDate, addDays } from "../life/model";
import type { TaskDraft } from "../types";

export interface Service {
  id: string;
  name: string;
  project: string;
  url: string;
  port: string;
  directory: string;
  database: string;
  purpose: string;
}
export interface Deadline {
  id: string;
  name: string;
  kind: "domain" | "certificate" | "refund" | "cancel" | "other";
  date: string;
  done: boolean;
}
export interface Log {
  id: string;
  date: string;
  kind: string;
  text: string;
}
export interface Payment {
  id: string;
  date: string;
  amount: number;
  currency: string;
  coveredDue: string;
}
export interface Metrics {
  sampledAt: string;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  uptimeSeconds: number;
  networkRxBytes: number;
  networkTxBytes: number;
}
export interface Sample {
  id: string;
  checkedAt: string;
  target: string;
  source: "http" | "collector";
  ok: boolean;
  detail: string;
  latencyMs: number;
  metrics?: Metrics;
}
export interface Host {
  id: string;
  name: string;
  provider: string;
  website: string;
  consoleUrl: string;
  supportUrl: string;
  plan: string;
  region: string;
  os: string;
  cpu: number;
  ramGb: number;
  diskGb: number;
  bandwidthMbps: number;
  trafficGb: number;
  ipv4: string;
  ipv6: string;
  sshPort: number;
  sshUser: string;
  credentialRef: string;
  snapshots: number;
  project: string;
  purpose: string;
  environment: "production" | "test" | "development";
  archived: boolean;
  source: string;
  verifiedOn: string;
  purchasedOn: string;
  orderId: string;
  constraints: string;
  amount: number;
  currency: string;
  renewalAmount: number;
  tax: number;
  cycleMonths: number;
  billingAnchor: number;
  nextDue: string;
  autoRenew: boolean;
  remindDays: number;
  trafficReset: string;
  trafficUsedGb: number;
  backupLocation: string;
  backupSchedule: string;
  backupDays: number;
  backupLastSuccess: string;
  restoreTestedOn: string;
  monitorUrl: string;
  collectorUrl: string;
  intervalMinutes: number;
  cpuAlert: number;
  memoryAlert: number;
  diskAlert: number;
  services: Service[];
  deadlines: Deadline[];
  logs: Log[];
  payments: Payment[];
  samples: Sample[];
}
export interface InfraReport {
  id: string;
  createdAt: string;
  summary: string;
  observations: string[];
  suggestions: {
    title: string;
    reason: string;
    hostId: string;
    dueDate: string;
  }[];
}
export interface Infrastructure {
  version: 1;
  hosts: Host[];
  reports: InfraReport[];
}
export interface HostEvent {
  id: string;
  hostId: string;
  title: string;
  date: string;
  kind: string;
  remindDays: number;
}
export const emptyInfrastructure = (): Infrastructure => ({
  version: 1,
  hosts: [],
  reports: [],
});
export const newHost = (): Host => ({
  id: crypto.randomUUID(),
  name: "",
  provider: "",
  website: "",
  consoleUrl: "",
  supportUrl: "",
  plan: "",
  region: "",
  os: "Ubuntu 24.04 LTS",
  cpu: 2,
  ramGb: 4,
  diskGb: 40,
  bandwidthMbps: 0,
  trafficGb: 0,
  ipv4: "",
  ipv6: "",
  sshPort: 22,
  sshUser: "",
  credentialRef: "",
  snapshots: 0,
  project: "",
  purpose: "",
  environment: "test",
  archived: false,
  source: "",
  verifiedOn: "",
  purchasedOn: "",
  orderId: "",
  constraints: "",
  amount: 0,
  currency: "USD",
  renewalAmount: 0,
  tax: 0,
  cycleMonths: 1,
  billingAnchor: 0,
  nextDue: "",
  autoRenew: false,
  remindDays: 7,
  trafficReset: "",
  trafficUsedGb: 0,
  backupLocation: "",
  backupSchedule: "",
  backupDays: 7,
  backupLastSuccess: "",
  restoreTestedOn: "",
  monitorUrl: "",
  collectorUrl: "",
  intervalMinutes: 0,
  cpuAlert: 85,
  memoryAlert: 85,
  diskAlert: 85,
  services: [],
  deadlines: [],
  logs: [],
  payments: [],
  samples: [],
});
const str = (v: unknown, max = 4000): v is string =>
  typeof v === "string" && v.length <= max;
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, min = 0, max = 1e12): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const date = (v: unknown) => v === "" || validDate(v);
const stamp = (v: unknown) => str(v, 40) && Number.isFinite(Date.parse(v));
const rows = (v: unknown, max: number, check: (v: any) => boolean): boolean =>
  Array.isArray(v) &&
  v.length <= max &&
  new Set(v.map((x) => x?.id)).size === v.length &&
  v.every((x) => obj(x) && str(x.id, 80) && !!x.id && check(x));
export function safeUrl(v: unknown, required = false): boolean {
  if (v === "") return !required;
  if (!str(v, 2000)) return false;
  try {
    const u = new URL(v);
    return (
      ["http:", "https:"].includes(u.protocol) &&
      !!u.hostname &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}
export function validMetrics(v: unknown): v is Metrics {
  return (
    obj(v) &&
    stamp(v.sampledAt) &&
    [v.cpuPercent, v.memoryPercent, v.diskPercent].every((x) =>
      num(x, 0, 100),
    ) &&
    [v.uptimeSeconds, v.networkRxBytes, v.networkTxBytes].every((x) =>
      num(x, 0, Number.MAX_SAFE_INTEGER),
    )
  );
}
export function validHost(h: unknown): h is Host {
  if (!obj(h)) return false;
  return (
    [
      "id",
      "name",
      "provider",
      "plan",
      "region",
      "os",
      "ipv4",
      "ipv6",
      "sshUser",
      "credentialRef",
      "project",
      "purpose",
      "source",
      "orderId",
      "constraints",
      "backupLocation",
      "backupSchedule",
    ].every((k) => str(h[k])) &&
    str(h.name, 120) &&
    !!h.name.trim() &&
    str(h.id, 80) &&
    !!h.id &&
    ["website", "consoleUrl", "supportUrl", "monitorUrl", "collectorUrl"].every(
      (k) => safeUrl(h[k]),
    ) &&
    [
      "verifiedOn",
      "purchasedOn",
      "nextDue",
      "trafficReset",
      "backupLastSuccess",
      "restoreTestedOn",
    ].every((k) => date(h[k])) &&
    [
      "cpu",
      "ramGb",
      "diskGb",
      "bandwidthMbps",
      "trafficGb",
      "snapshots",
      "amount",
      "renewalAmount",
      "tax",
      "trafficUsedGb",
    ].every((k) => num(h[k])) &&
    num(h.sshPort, 1, 65535) &&
    Number.isInteger(h.sshPort) &&
    num(h.cycleMonths, 1, 120) &&
    Number.isInteger(h.cycleMonths) &&
    num(h.billingAnchor, 0, 31) &&
    Number.isInteger(h.billingAnchor) &&
    num(h.remindDays, 0, 365) &&
    num(h.backupDays, 1, 365) &&
    num(h.intervalMinutes, 0, 1440) &&
    (h.intervalMinutes === 0 || Number(h.intervalMinutes) >= 5) &&
    ["cpuAlert", "memoryAlert", "diskAlert"].every((k) => num(h[k], 1, 100)) &&
    typeof h.archived === "boolean" &&
    typeof h.autoRenew === "boolean" &&
    ["production", "test", "development"].includes(String(h.environment)) &&
    str(h.currency, 3) &&
    /^[A-Z]{3}$/.test(h.currency) &&
    rows(
      h.services,
      100,
      (s) =>
        str(s.name, 120) &&
        !!s.name.trim() &&
        [s.project, s.port, s.directory, s.database, s.purpose].every((x) =>
          str(x),
        ) &&
        safeUrl(s.url),
    ) &&
    rows(
      h.deadlines,
      100,
      (d) =>
        str(d.name, 120) &&
        !!d.name.trim() &&
        validDate(d.date) &&
        ["domain", "certificate", "refund", "cancel", "other"].includes(
          d.kind,
        ) &&
        typeof d.done === "boolean",
    ) &&
    rows(
      h.logs,
      300,
      (l) =>
        validDate(l.date) && str(l.kind, 80) && str(l.text) && !!l.text.trim(),
    ) &&
    rows(
      h.payments,
      300,
      (p) =>
        validDate(p.date) &&
        validDate(p.coveredDue) &&
        num(p.amount) &&
        str(p.currency, 3) &&
        /^[A-Z]{3}$/.test(p.currency),
    ) &&
    rows(
      h.samples,
      120,
      (s) =>
        stamp(s.checkedAt) &&
        safeUrl(s.target, true) &&
        ["http", "collector"].includes(s.source) &&
        typeof s.ok === "boolean" &&
        str(s.detail, 500) &&
        num(s.latencyMs, 0, 60000) &&
        (s.metrics === undefined || validMetrics(s.metrics)),
    )
  );
}
export function validReport(v: unknown, hosts?: Host[]): v is InfraReport {
  return (
    obj(v) &&
    str(v.id, 80) &&
    !!v.id &&
    stamp(v.createdAt) &&
    str(v.summary, 4000) &&
    !!v.summary.trim() &&
    Array.isArray(v.observations) &&
    v.observations.length <= 20 &&
    v.observations.every((x) => str(x, 1000)) &&
    Array.isArray(v.suggestions) &&
    v.suggestions.length <= 20 &&
    v.suggestions.every(
      (s) =>
        obj(s) &&
        str(s.title, 200) &&
        !!s.title.trim() &&
        str(s.reason, 1500) &&
        str(s.hostId, 80) &&
        (!hosts || hosts.some((h) => h.id === s.hostId)) &&
        date(s.dueDate),
    )
  );
}
export function validInfrastructure(v: unknown): v is Infrastructure {
  return (
    obj(v) &&
    v.version === 1 &&
    rows(v.hosts, 100, validHost) &&
    rows(v.reports, 30, (r) => validReport(r)) &&
    new TextEncoder().encode(JSON.stringify(v)).length <= 2 * 1024 * 1024
  );
}
/** Preserve a billing day (31 -> February's last day -> 31), never roll into March. */
export function nextBillingDate(
  day: string,
  months: number,
  anchor = 0,
): string {
  if (
    !validDate(day) ||
    !Number.isInteger(months) ||
    months < 1 ||
    months > 120
  )
    throw Error("账期或日期无效");
  const [y, m, d] = day.split("-").map(Number),
    target = new Date(y, m - 1 + months, 1, 12);
  target.setDate(
    Math.min(
      anchor || d,
      new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate(),
    ),
  );
  const next = dateKey(target);
  if (!validDate(next)) throw Error("续费日期超出范围");
  return next;
}
export function recordPayment(host: Host, today = dateKey()): Host {
  if (!host.nextDue) throw Error("请先填写下次续费日");
  const anchor = host.billingAnchor || Number(host.nextDue.slice(-2));
  return {
    ...host,
    billingAnchor: anchor,
    nextDue: nextBillingDate(host.nextDue, host.cycleMonths, anchor),
    payments: [
      ...host.payments,
      {
        id: crypto.randomUUID(),
        date: today,
        coveredDue: host.nextDue,
        amount: host.renewalAmount + host.tax,
        currency: host.currency,
      },
    ],
  };
}
export function hostEvents(data: Infrastructure): HostEvent[] {
  return data.hosts
    .filter((h) => !h.archived)
    .flatMap((h) => [
      ...(h.nextDue
        ? [
            {
              id: `renewal:${h.id}:${h.nextDue}`,
              hostId: h.id,
              title: `${h.name} · 续费`,
              date: h.nextDue,
              kind: "续费",
              remindDays: h.remindDays,
            },
          ]
        : []),
      ...h.deadlines
        .filter((d) => !d.done)
        .map((d) => ({
          id: `deadline:${d.id}`,
          hostId: h.id,
          title: `${h.name} · ${d.name}`,
          date: d.date,
          kind: "主机期限",
          remindDays: h.remindDays,
        })),
    ])
    .sort((a, b) => a.date.localeCompare(b.date));
}
export function monthlyCosts(data: Infrastructure): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const h of data.hosts.filter((h) => !h.archived))
    sums[h.currency] =
      (sums[h.currency] || 0) + (h.renewalAmount + h.tax) / h.cycleMonths;
  return sums;
}
export function sampleState(
  s: Sample | undefined,
  minutes: number,
  now = Date.now(),
): "unknown" | "stale" | "ok" | "error" {
  if (!s) return "unknown";
  const maxAge = Math.max(15, minutes * 2) * 60000,
    checked = Date.parse(s.checkedAt);
  if (now - checked > maxAge || checked - now > 300000) return "stale";
  if (
    s.metrics &&
    (now - Date.parse(s.metrics.sampledAt) > maxAge ||
      Date.parse(s.metrics.sampledAt) - now > 300000)
  )
    return "stale";
  return s.ok ? "ok" : "error";
}
export function latestSample(
  h: Host,
  source: Sample["source"],
): Sample | undefined {
  return [...h.samples]
    .reverse()
    .find(
      (s) =>
        s.source === source &&
        s.target === (source === "http" ? h.monitorUrl : h.collectorUrl),
    );
}
export function attention(
  data: Infrastructure,
  today = dateKey(),
): { id: string; hostId: string; title: string; date: string }[] {
  const out: { id: string; hostId: string; title: string; date: string }[] =
    hostEvents(data)
      .filter((e) => e.date <= addDays(today, e.remindDays))
      .map((e) => ({
        ...e,
        title: `${e.title}${e.date < today ? "（已逾期）" : ""}`,
      }));
  for (const h of data.hosts.filter((h) => !h.archived)) {
    if (!h.purpose && !h.services.length)
      out.push({
        id: `idle:${h.id}`,
        hostId: h.id,
        title: `${h.name} · 尚未记录用途，检查是否闲置`,
        date: "",
      });
    if (
      h.backupSchedule &&
      (!h.backupLastSuccess ||
        addDays(h.backupLastSuccess, h.backupDays) < today)
    )
      out.push({
        id: `backup:${h.id}`,
        hostId: h.id,
        title: `${h.name} · 备份需要检查`,
        date: today,
      });
    if (h.trafficGb && h.trafficUsedGb >= h.trafficGb * 0.8)
      out.push({
        id: `traffic:${h.id}`,
        hostId: h.id,
        title: `${h.name} · 本期流量已用 ${Math.round((h.trafficUsedGb / h.trafficGb) * 100)}%`,
        date: today,
      });
    for (const source of ["http", "collector"] as const) {
      if (!(source === "http" ? h.monitorUrl : h.collectorUrl)) continue;
      const sample = latestSample(h, source),
        status = sampleState(sample, h.intervalMinutes);
      if (status !== "ok")
        out.push({
          id: `monitor:${h.id}:${source}`,
          hostId: h.id,
          title: `${h.name} · ${source === "http" ? "服务" : "资源采集"}${status === "error" ? "检查失败" : status === "stale" ? "数据已过期" : "尚未检查"}`,
          date: today,
        });
      if (status === "ok" && sample?.metrics)
        for (const [key, limit, label] of [
          ["cpuPercent", h.cpuAlert, "CPU"],
          ["memoryPercent", h.memoryAlert, "内存"],
          ["diskPercent", h.diskAlert, "磁盘"],
        ] as const)
          if (sample.metrics[key] >= limit)
            out.push({
              id: `resource:${h.id}:${key}`,
              hostId: h.id,
              title: `${h.name} · ${label} ${sample.metrics[key].toFixed(1)}% 超过阈值`,
              date: today,
            });
    }
  }
  return out;
}
export const eventReference = (id: string) => `tideplan:infrastructure:${id}`;
export function maintenanceDraft(
  title: string,
  notes: string,
  dueDate = "",
): TaskDraft {
  return {
    title: title.slice(0, 200),
    notes: notes.slice(0, 12000),
    horizon: "short",
    priority: "important",
    startDate: "",
    dueDate,
  };
}
/** Allowlist only: IPs, endpoints, paths, credential references, order IDs and logs stay local. */
export function infrastructureContext(data: Infrastructure, today = dateKey()) {
  return {
    today,
    costs: monthlyCosts(data),
    attention: attention(data, today).slice(0, 50),
    hosts: data.hosts
      .filter((h) => !h.archived)
      .slice(0, 30)
      .map((h) => ({
        id: h.id,
        name: h.name,
        project: h.project,
        purpose: h.purpose.slice(0, 300),
        provider: h.provider,
        region: h.region,
        environment: h.environment,
        cpu: h.cpu,
        ramGb: h.ramGb,
        diskGb: h.diskGb,
        currency: h.currency,
        renewalAmount: h.renewalAmount,
        tax: h.tax,
        cycleMonths: h.cycleMonths,
        nextDue: h.nextDue,
        autoRenew: h.autoRenew,
        trafficGb: h.trafficGb,
        trafficUsedGb: h.trafficUsedGb,
        trafficReset: h.trafficReset,
        backupLastSuccess: h.backupLastSuccess,
        backupDays: h.backupDays,
        restoreTestedOn: h.restoreTestedOn,
        services: h.services.map((s) => ({ name: s.name, project: s.project })),
        monitor: ["http", "collector"].map((source) => {
          const s = latestSample(h, source as Sample["source"]);
          return {
            source,
            state: sampleState(s, h.intervalMinutes),
            checkedAt: s?.checkedAt ?? null,
            metrics: s?.metrics ?? null,
          };
        }),
        weekSamples: h.samples
          .filter((s) => s.checkedAt.slice(0, 10) >= addDays(today, -6))
          .slice(-40)
          .map((s) => ({
            source: s.source,
            checkedAt: s.checkedAt,
            ok: s.ok,
            latencyMs: s.latencyMs,
            metrics: s.metrics,
          })),
      })),
  };
}
