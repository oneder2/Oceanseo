import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "../personal/invoke";
import {
  Plus,
  Server,
  Search,
  ArrowUpRight,
  RefreshCw,
  Sparkles,
  Archive,
  Trash2,
  Check,
} from "lucide-react";
import DatePicker from "../DatePicker";
import GoalOverlay from "../goals/GoalOverlay";
import "../goals/conversation.css";
import { dateKey } from "../dateUtils";
import type { Task, TaskDraft } from "../types";
import {
  attention,
  eventReference,
  hostEvents,
  latestSample,
  monthlyCosts,
  newHost,
  recordPayment,
  sampleState,
  safeUrl,
  validHost,
  type Host,
  type Infrastructure,
  type Sample,
} from "./model";
import { useHostMonitor } from "./monitor";
import { InfraAI } from "./InfraAI";
import "./infrastructure.css";

const tabs = ["档案", "服务", "费用与期限", "维护", "监测"] as const;
type Tab = (typeof tabs)[number];
type Props = {
  data: Infrastructure;
  ready: boolean;
  error: string;
  update: (fn: (d: Infrastructure) => Infrastructure) => Promise<void>;
  selected: string;
  onSelect: (id: string) => void;
  tasks: Task[];
  onTask: (
    title: string,
    notes: string,
    date: string,
    reference: string,
  ) => void;
  onAiSettings: () => void;
  onToast: (text: string) => void;
  monitor: ReturnType<typeof useHostMonitor>;
};
const fmt = (v: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(v);
const stateLabel = {
  unknown: "尚未检查",
  stale: "数据已过期",
  ok: "检查通过",
  error: "检查失败",
};
function Link({ url, label }: { url: string; label: string }) {
  const [error, setError] = useState("");
  return safeUrl(url, true) ? (
    <span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          if (isTauri()) {
            e.preventDefault();
            setError("");
            void invoke("open_host_url", { value: url }).catch((e) =>
              setError(String(e)),
            );
          }
        }}
      >
        {label}
        <ArrowUpRight size={13} />
      </a>
      {error && <small role="alert">{error}</small>}
    </span>
  ) : null;
}

export default function HostPanel(p: Props) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("active"),
    [provider, setProvider] = useState(""),
    [project, setProject] = useState("");
  const [draft, setDraft] = useState<Host | null>(null),
    [tab, setTab] = useState<Tab>("档案"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [closing, setClosing] = useState(false),
    [deleting, setDeleting] = useState(false),
    [paying, setPaying] = useState(false),
    [ai, setAi] = useState(false);
  const [token, setToken] = useState(""),
    [configured, setConfigured] = useState(false);
  const initial = useRef(""),
    existing = draft ? p.data.hosts.find((h) => h.id === draft.id) : undefined;
  const dirty = !!draft && JSON.stringify(draft) !== initial.current;
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);
  function edit(h: Host) {
    setDraft(structuredClone(h));
    initial.current = JSON.stringify(h);
    setTab("档案");
    setError("");
    setToken("");
    setConfigured(false);
    setClosing(false);
    setDeleting(false);
    setPaying(false);
  }
  useEffect(() => {
    if (p.selected && p.ready) {
      const h = p.data.hosts.find((h) => h.id === p.selected);
      if (h) edit(h);
      p.onSelect("");
    }
  }, [p.selected, p.ready]);
  useEffect(() => {
    let live = true;
    setConfigured(false);
    if (draft && isTauri())
      void invoke<boolean>("host_credential_configured", {
        hostId: draft.id,
        url: draft.collectorUrl,
      })
        .then((v) => {
          if (live) setConfigured(v);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [draft?.id, draft?.collectorUrl]);
  function close() {
    if (busy) return;
    if (dirty || token) {
      setClosing(true);
      return;
    }
    setDraft(null);
  }
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft || !validHost(draft))
      throw Error(
        "请检查主机名称、有效网址、日期、金额和项目名称；密码请放在凭据管理器中",
      );
    await p.update((d) => ({
      ...d,
      hosts: d.hosts.some((h) => h.id === draft.id)
        ? d.hosts.map((h) =>
            h.id === draft.id ? { ...draft, samples: h.samples } : h,
          )
        : [...d.hosts, draft],
    }));
    initial.current = JSON.stringify(draft);
    p.onToast("主机档案已保存");
  }
  function field<K extends keyof Host>(key: K, value: Host[K]) {
    setDraft((h) => (h ? { ...h, [key]: value } : h));
  }
  const text = (key: keyof Host, label: string, multi = false) =>
    draft && (
      <label key={key}>
        {label}
        {multi ? (
          <textarea
            rows={3}
            value={String(draft[key])}
            maxLength={4000}
            onChange={(e) => field(key, e.target.value as never)}
          />
        ) : (
          <input
            value={String(draft[key])}
            maxLength={key === "name" ? 120 : 2000}
            onChange={(e) => field(key, e.target.value as never)}
          />
        )}
      </label>
    );
  const number = (key: keyof Host, label: string, min = 0, max = 1e12) =>
    draft && (
      <label key={key}>
        {label}
        <input
          type="number"
          min={min}
          max={max}
          step={
            key === "sshPort" ||
            key === "cycleMonths" ||
            key === "billingAnchor"
              ? 1
              : "any"
          }
          value={Number(draft[key])}
          onChange={(e) =>
            field(
              key,
              e.target.value === "" ? 0 : (Number(e.target.value) as never),
            )
          }
        />
      </label>
    );
  const date = (key: keyof Host, label: string) =>
    draft && (
      <DatePicker
        key={key}
        label={label}
        value={String(draft[key])}
        onChange={(v) => field(key, v as never)}
      />
    );
  const alerts = attention(p.data),
    costs = monthlyCosts(p.data),
    events = hostEvents(p.data);
  const hosts = p.data.hosts.filter(
    (h) =>
      (filter === "all" ||
        (filter === "archived" ? h.archived : !h.archived)) &&
      (!provider || h.provider === provider) &&
      (!project ||
        h.project === project ||
        h.services.some((s) => s.project === project)) &&
      [
        h.name,
        h.provider,
        h.region,
        h.project,
        h.purpose,
        ...h.services.map((s) => s.name),
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const taskButton = (
    id: string,
    title: string,
    notes: string,
    day: string,
  ) => {
    const t = p.tasks.find((t) => t.origin?.reference === eventReference(id));
    return (
      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          setDraft(null);
          p.onTask(title, notes, day, eventReference(id));
        }}
      >
        {t ? (t.completedAt ? "查看已完成任务" : "查看关联任务") : "加入任务"}
      </button>
    );
  };
  if (!p.ready)
    return (
      <section role="status">
        {p.error || "正在读取主机档案…"}
        {p.error && <button onClick={() => location.reload()}>重新载入</button>}
      </section>
    );
  return (
    <section className="infra-page" aria-label="主机与服务">
      <div className="infra-top">
        <div>
          <span className="infra-eyebrow">PERSONAL INFRASTRUCTURE</span>
          <h2>服务有归处，维护有节奏。</h2>
          <p>
            {p.data.hosts.filter((h) => !h.archived).length} 台在用主机 · 月均{" "}
            {Object.entries(costs)
              .map(([c, n]) => `${c} ${fmt(n)}`)
              .join(" / ") || "尚未记录费用"}
          </p>
          <small>按续费价与每期税费折算，币种分别汇总；不是实际账单。</small>
        </div>
        <div className="infra-actions">
          <button className="secondary-button" onClick={() => setAi(true)}>
            <Sparkles size={16} />
            AI 与周摘要
          </button>
          <button
            className="primary-button"
            onClick={() => {
              edit(newHost());
              initial.current = "";
            }}
          >
            <Plus size={16} />
            添加主机
          </button>
        </div>
      </div>
      {(p.error || p.monitor.error) && (
        <p className="infra-error" role="alert">
          {p.error || p.monitor.error}
        </p>
      )}
      <section className="infra-attention" aria-label="主机待处理">
        <header>
          <strong>需要留意</strong>
          <span>{alerts.length} 项</span>
        </header>
        {alerts.length ? (
          <ul>
            {alerts.slice(0, 8).map((a) => (
              <li key={a.id}>
                <button
                  className="infra-text-button"
                  onClick={() => {
                    const h = p.data.hosts.find((h) => h.id === a.hostId);
                    if (h) edit(h);
                  }}
                >
                  {a.title}
                  <small>{a.date || "待核实"}</small>
                </button>
                {taskButton(
                  a.id,
                  a.title,
                  "来源：主机与服务。请核实后处理。",
                  a.date,
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>目前没有到期或异常提示。未配置监测的主机不会被判定为健康。</p>
        )}
        {alerts.length > 8 && (
          <small>另有 {alerts.length - 8} 项，请打开对应主机查看。</small>
        )}
      </section>
      <div className="infra-filters">
        <label>
          <Search size={16} />
          <input
            aria-label="搜索主机"
            placeholder="搜索主机、地区、服务或用途"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="主机状态筛选"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="active">在用</option>
          <option value="archived">已归档</option>
          <option value="all">全部</option>
        </select>
        <select
          aria-label="供应商筛选"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          <option value="">所有供应商</option>
          {[...new Set(p.data.hosts.map((h) => h.provider))]
            .filter(Boolean)
            .map((v) => (
              <option key={v}>{v}</option>
            ))}
        </select>
        <select
          aria-label="项目筛选"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        >
          <option value="">所有项目</option>
          {[
            ...new Set(
              p.data.hosts.flatMap((h) => [
                h.project,
                ...h.services.map((s) => s.project),
              ]),
            ),
          ]
            .filter(Boolean)
            .map((v) => (
              <option key={v}>{v}</option>
            ))}
        </select>
      </div>
      <div className="infra-hosts">
        {hosts.map((h) => {
          const status = sampleState(
            latestSample(h, "http"),
            h.intervalMinutes,
          );
          return (
            <button className="infra-host" key={h.id} onClick={() => edit(h)}>
              <div className="infra-host-title">
                <Server size={20} />
                <strong>{h.name}</strong>
                <span
                  className={`infra-status ${h.archived ? "stale" : status}`}
                >
                  {h.archived
                    ? "已归档"
                    : h.monitorUrl
                      ? stateLabel[status]
                      : "未配置监测"}
                </span>
              </div>
              <p>
                {h.provider || "供应商待填"} · {h.region || "地区待填"} ·{" "}
                {h.cpu} vCPU / {h.ramGb} GB / {h.diskGb} GB
              </p>
              <div className="infra-service-lines">
                {h.services.length ? (
                  h.services.slice(0, 3).map((s) => (
                    <span key={s.id}>
                      {s.name}
                      <span>→</span>
                      {s.project || h.project || "未关联项目"}
                    </span>
                  ))
                ) : (
                  <span>
                    {h.purpose || "补充用途，知道这台机器在为什么服务"}
                  </span>
                )}
              </div>
              <footer>
                <span>
                  {h.currency} {fmt(h.renewalAmount + h.tax)} / {h.cycleMonths}{" "}
                  个月
                </span>
                <span>{h.nextDue ? `${h.nextDue} 续费` : "续费日待填"}</span>
              </footer>
            </button>
          );
        })}
      </div>
      {!hosts.length && (
        <div className="infra-empty">
          <Server size={36} />
          <h3>
            {p.data.hosts.length ? "没有匹配的主机" : "从第一台服务器开始"}
          </h3>
          <p>记下用途、费用和重要日期。服务检查与资源采集可以稍后配置。</p>
          <button
            className="secondary-button"
            onClick={() => {
              edit(newHost());
              initial.current = "";
            }}
          >
            建立主机档案
          </button>
        </div>
      )}
      <p className="infra-footnote">
        档案保存在本机，包含在完整数据备份中；当前不参与跨设备同步。监测在应用运行且前台可见时执行，不承诺全天在线监控。
      </p>
      {draft && (
        <GoalOverlay
          title={existing ? draft.name || "主机详情" : "添加主机"}
          kicker="主机与服务 · 本机档案"
          drawer
          onClose={close}
        >
          <div className="infra-detail">
            <nav className="infra-tabs" aria-label="主机详情页签">
              {tabs.map((t) => (
                <button
                  type="button"
                  key={t}
                  aria-pressed={tab === t}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </nav>
            {closing && (
              <div className="infra-notice" role="alert">
                <p>有未保存的修改或令牌，离开会丢弃。</p>
                <button
                  className="secondary-button"
                  onClick={() => setClosing(false)}
                >
                  继续编辑
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setDraft(null);
                    setToken("");
                  }}
                >
                  放弃修改并关闭
                </button>
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(save);
              }}
            >
              <fieldset disabled={busy} className="infra-fields">
                {tab === "档案" && (
                  <>
                    <div className="infra-form-grid">
                      {text("name", "主机名称 *")}
                      {text("provider", "供应商")}
                      {text("plan", "套餐名称")}
                      {text("region", "地区 / 机房")}
                      {text("os", "操作系统")}
                      {text("project", "所属项目（可自定义）")}
                      <label>
                        环境
                        <select
                          value={draft.environment}
                          onChange={(e) =>
                            field(
                              "environment",
                              e.target.value as Host["environment"],
                            )
                          }
                        >
                          <option value="test">测试</option>
                          <option value="production">生产</option>
                          <option value="development">开发</option>
                        </select>
                      </label>
                      {text("purpose", "用途", true)}
                    </div>
                    <details open>
                      <summary>规格与额度</summary>
                      <div className="infra-form-grid">
                        {number("cpu", "vCPU 核数")}
                        {number("ramGb", "内存 GB")}
                        {number("diskGb", "磁盘 GB")}
                        {number("bandwidthMbps", "端口速率 Mbps（未知填 0）")}
                        {number("trafficGb", "账期流量额度 GB（未知填 0）")}
                        {number("snapshots", "快照额度")}
                      </div>
                    </details>
                    <details>
                      <summary>平台与连接入口</summary>
                      <div className="infra-form-grid">
                        {text("website", "官网网址")}
                        {text("consoleUrl", "管理控制台网址")}
                        {text("supportUrl", "工单入口网址")}
                        {text("ipv4", "IPv4 / 主机地址")}
                        {text("ipv6", "IPv6")}
                        {number("sshPort", "SSH 端口", 1, 65535)}
                        {text("sshUser", "SSH 用户名")}
                        {text(
                          "credentialRef",
                          "凭据引用（如密码库条目名，不填密码）",
                        )}
                      </div>
                      <div className="infra-links">
                        <Link url={draft.website} label="官网" />
                        <Link url={draft.consoleUrl} label="管理控制台" />
                        <Link url={draft.supportUrl} label="工单入口" />
                      </div>
                    </details>
                    <details>
                      <summary>购买依据与限制</summary>
                      <div className="infra-form-grid">
                        {text("orderId", "订单编号")}
                        {date("purchasedOn", "购买日期")}
                        {text("source", "参数来源 / 待核实说明", true)}
                        {date("verifiedOn", "最近核实日期")}
                        {text("constraints", "服务限制与退款条件", true)}
                      </div>
                    </details>
                  </>
                )}
                {tab === "服务" && (
                  <>
                    <p>
                      用服务关联项目；例如“潮汐同步 →
                      Oceanseo”。可以直接输入已有项目名或新的项目名。
                    </p>
                    {draft.services.map((s) => (
                      <section className="infra-subcard" key={s.id}>
                        <div className="infra-form-grid">
                          {(
                            [
                              ["name", "服务名称 *"],
                              ["project", "关联项目"],
                              ["url", "访问地址"],
                              ["port", "端口"],
                              ["directory", "部署目录"],
                              ["database", "关联数据库"],
                              ["purpose", "服务说明"],
                            ] as const
                          ).map(([key, label]) => (
                            <label key={key}>
                              {label}
                              <input
                                value={s[key]}
                                maxLength={key === "name" ? 120 : 2000}
                                onChange={(e) =>
                                  field(
                                    "services",
                                    draft.services.map((x) =>
                                      x.id === s.id
                                        ? { ...x, [key]: e.target.value }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <div className="infra-actions">
                          <Link url={s.url} label="访问服务" />
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              field(
                                "services",
                                draft.services.filter((x) => x.id !== s.id),
                              )
                            }
                          >
                            移除此服务
                          </button>
                        </div>
                      </section>
                    ))}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        field("services", [
                          ...draft.services,
                          {
                            id: crypto.randomUUID(),
                            name: "",
                            project: draft.project,
                            url: "",
                            port: "",
                            directory: "",
                            database: "",
                            purpose: "",
                          },
                        ])
                      }
                    >
                      <Plus size={15} />
                      添加服务
                    </button>
                  </>
                )}
                {tab === "费用与期限" && (
                  <>
                    <div className="infra-form-grid">
                      {number("amount", "首次付款金额（不含税）")}
                      {number("renewalAmount", "每期续费金额（不含税）")}
                      {number("tax", "每期税费 / 附加费")}
                      <label>
                        币种
                        <input
                          value={draft.currency}
                          maxLength={3}
                          list="infra-currencies"
                          onChange={(e) =>
                            field("currency", e.target.value.toUpperCase())
                          }
                        />
                        <datalist id="infra-currencies">
                          {["USD", "CNY", "EUR", "GBP", "HKD", "JPY"].map(
                            (c) => (
                              <option key={c}>{c}</option>
                            ),
                          )}
                        </datalist>
                      </label>
                      {number("cycleMonths", "账期（月）", 1, 120)}
                      {number(
                        "billingAnchor",
                        "固定账单日（0 为沿用续费日）",
                        0,
                        31,
                      )}
                      {date("nextDue", "下次续费日期")}
                      {number("remindDays", "提前提醒天数", 0, 365)}
                      <label className="infra-check">
                        <input
                          type="checkbox"
                          checked={draft.autoRenew}
                          onChange={(e) => field("autoRenew", e.target.checked)}
                        />
                        供应商已开自动续费（仅记录）
                      </label>
                      {number("trafficUsedGb", "本期已用流量 GB（人工核实）")}
                      {date("trafficReset", "下次流量重置日期")}
                    </div>
                    <p>
                      账期用量按供应商口径填写；采集器的网络计数不会自动覆盖这里。
                    </p>
                    <button
                      type="button"
                      disabled={!existing || dirty || !draft.nextDue}
                      className="secondary-button"
                      onClick={() => setPaying(true)}
                    >
                      记录本期已付款
                    </button>
                    {paying && (
                      <div className="infra-notice">
                        <p>
                          确认已向供应商支付 {draft.currency}{" "}
                          {fmt(draft.renewalAmount + draft.tax)}，覆盖{" "}
                          {draft.nextDue} 账单？只登记并推进一个账期，不会扣款。
                        </p>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() =>
                            void action(async () => {
                              const next = recordPayment(draft);
                              await p.update((d) => ({
                                ...d,
                                hosts: d.hosts.map((h) =>
                                  h.id === next.id
                                    ? { ...next, samples: h.samples }
                                    : h,
                                ),
                              }));
                              setDraft(next);
                              initial.current = JSON.stringify(next);
                              setPaying(false);
                            })
                          }
                        >
                          确认登记付款
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setPaying(false)}
                        >
                          取消
                        </button>
                      </div>
                    )}
                    <details>
                      <summary>付款记录（{draft.payments.length}）</summary>
                      {draft.payments
                        .slice()
                        .reverse()
                        .map((x) => (
                          <p key={x.id}>
                            {x.date} · {x.currency} {fmt(x.amount)} · 覆盖{" "}
                            {x.coveredDue}
                          </p>
                        ))}
                    </details>
                    <h3>重要期限</h3>
                    {draft.deadlines.map((d) => (
                      <section key={d.id} className="infra-subcard">
                        <div className="infra-form-grid">
                          <label>
                            期限名称
                            <input
                              value={d.name}
                              maxLength={120}
                              onChange={(e) =>
                                field(
                                  "deadlines",
                                  draft.deadlines.map((x) =>
                                    x.id === d.id
                                      ? { ...x, name: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </label>
                          <label>
                            类别
                            <select
                              value={d.kind}
                              onChange={(e) =>
                                field(
                                  "deadlines",
                                  draft.deadlines.map((x) =>
                                    x.id === d.id
                                      ? {
                                          ...x,
                                          kind: e.target.value as typeof d.kind,
                                        }
                                      : x,
                                  ),
                                )
                              }
                            >
                              {Object.entries({
                                domain: "域名到期",
                                certificate: "证书到期",
                                refund: "退款截止",
                                cancel: "取消续费截止",
                                other: "自定义",
                              }).map(([v, l]) => (
                                <option value={v} key={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          </label>
                          <DatePicker
                            label="期限日期"
                            value={d.date}
                            onChange={(v) =>
                              field(
                                "deadlines",
                                draft.deadlines.map((x) =>
                                  x.id === d.id ? { ...x, date: v } : x,
                                ),
                              )
                            }
                          />
                          <label className="infra-check">
                            <input
                              type="checkbox"
                              checked={d.done}
                              onChange={(e) =>
                                field(
                                  "deadlines",
                                  draft.deadlines.map((x) =>
                                    x.id === d.id
                                      ? { ...x, done: e.target.checked }
                                      : x,
                                  ),
                                )
                              }
                            />
                            已处理
                          </label>
                        </div>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() =>
                            field(
                              "deadlines",
                              draft.deadlines.filter((x) => x.id !== d.id),
                            )
                          }
                        >
                          移除此期限
                        </button>
                      </section>
                    ))}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        field("deadlines", [
                          ...draft.deadlines,
                          {
                            id: crypto.randomUUID(),
                            name: "",
                            kind: "other",
                            date: dateKey(),
                            done: false,
                          },
                        ])
                      }
                    >
                      添加期限
                    </button>
                    {existing && !dirty && (
                      <section>
                        <h3>关联到计划</h3>
                        {events
                          .filter((e) => e.hostId === draft.id)
                          .map((e) => (
                            <div className="infra-agenda" key={e.id}>
                              <span>
                                {e.date} · {e.title}
                              </span>
                              {taskButton(
                                e.id,
                                e.title,
                                "请核对供应商账单或到期条件后处理。",
                                e.date,
                              )}
                            </div>
                          ))}
                      </section>
                    )}
                  </>
                )}
                {tab === "维护" && (
                  <>
                    <div className="infra-form-grid">
                      {text("backupLocation", "备份保存位置（不填密钥）")}
                      {text(
                        "backupSchedule",
                        "备份方式 / 周期 / 保留策略",
                        true,
                      )}
                      {number("backupDays", "备份最长间隔（天）", 1, 365)}
                      {date("backupLastSuccess", "最近成功备份日期")}
                      {date("restoreTestedOn", "最近恢复验证日期")}
                    </div>
                    <p>
                      “成功备份”和“恢复验证”由你核实后记录；快照不等于服务器外备份。
                    </p>
                    <h3>维护日志</h3>
                    {draft.logs
                      .slice()
                      .reverse()
                      .map((l) => (
                        <section key={l.id} className="infra-subcard">
                          <div className="infra-form-grid">
                            <DatePicker
                              label="记录日期"
                              value={l.date}
                              onChange={(v) =>
                                field(
                                  "logs",
                                  draft.logs.map((x) =>
                                    x.id === l.id ? { ...x, date: v } : x,
                                  ),
                                )
                              }
                            />
                            <label>
                              类型
                              <input
                                list="infra-log-kinds"
                                value={l.kind}
                                maxLength={80}
                                onChange={(e) =>
                                  field(
                                    "logs",
                                    draft.logs.map((x) =>
                                      x.id === l.id
                                        ? { ...x, kind: e.target.value }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </label>
                          </div>
                          <label>
                            维护说明
                            <textarea
                              value={l.text}
                              maxLength={4000}
                              rows={3}
                              onChange={(e) =>
                                field(
                                  "logs",
                                  draft.logs.map((x) =>
                                    x.id === l.id
                                      ? { ...x, text: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              field(
                                "logs",
                                draft.logs.filter((x) => x.id !== l.id),
                              )
                            }
                          >
                            移除记录
                          </button>
                        </section>
                      ))}
                    <datalist id="infra-log-kinds">
                      {[
                        "部署",
                        "升级",
                        "故障",
                        "备份",
                        "恢复验证",
                        "迁移",
                        "其他",
                      ].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </datalist>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        field("logs", [
                          ...draft.logs,
                          {
                            id: crypto.randomUUID(),
                            date: dateKey(),
                            kind: "维护",
                            text: "",
                          },
                        ])
                      }
                    >
                      添加维护记录
                    </button>
                  </>
                )}
                {tab === "监测" && (
                  <>
                    <p>
                      只读检查，不运行 SSH
                      命令。请填写无需登录的健康检查地址；重定向不会被跟随。
                    </p>
                    <div className="infra-form-grid">
                      {text("monitorUrl", "服务健康检查 HTTPS 地址")}
                      {text("collectorUrl", "资源采集 HTTPS 地址")}
                      {number(
                        "intervalMinutes",
                        "前台检查间隔（分钟，0 关闭；最小 5）",
                        0,
                        1440,
                      )}
                      {number("cpuAlert", "CPU 提示阈值 %", 1, 100)}
                      {number("memoryAlert", "内存提示阈值 %", 1, 100)}
                      {number("diskAlert", "磁盘提示阈值 %", 1, 100)}
                    </div>
                    <p>
                      最多保存最近 120
                      条样本。应用关闭、手机后台或断网期间不持续采集；历史样本不能证明全天可用率。
                    </p>
                    <label>
                      采集令牌（与 AI / 同步令牌独立）
                      <input
                        type="password"
                        autoComplete="off"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder={
                          configured
                            ? "已单独保存；留空不修改"
                            : "配置自有采集器后填写"
                        }
                      />
                    </label>
                    <div className="infra-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!existing || dirty || !token || !isTauri()}
                        onClick={() =>
                          void action(async () => {
                            await invoke("save_host_credential", {
                              hostId: draft.id,
                              url: draft.collectorUrl,
                              token,
                            });
                            setToken("");
                            setConfigured(true);
                            p.onToast("采集令牌已单独保存");
                          })
                        }
                      >
                        保存采集令牌
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!configured || !isTauri()}
                        onClick={() =>
                          void action(async () => {
                            await invoke("save_host_credential", {
                              hostId: draft.id,
                              url: draft.collectorUrl,
                              token: "",
                            });
                            setConfigured(false);
                          })
                        }
                      >
                        清除采集令牌
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={
                          !existing ||
                          dirty ||
                          (!draft.monitorUrl && !draft.collectorUrl) ||
                          p.monitor.busy.includes(draft.id)
                        }
                        onClick={() =>
                          void action(() => p.monitor.check(existing!))
                        }
                      >
                        <RefreshCw size={15} />
                        立即检查
                      </button>
                    </div>
                    <small>
                      先保存档案再检查。采集器安装与 HTTPS 配置见项目
                      docs/infrastructure.md。
                    </small>
                    {existing &&
                      (["http", "collector"] as const).map((source) => (
                        <SampleView
                          key={source}
                          source={source}
                          host={existing}
                        />
                      ))}
                    {existing && (
                      <details>
                        <summary>最近检查记录</summary>
                        {existing.samples
                          .slice(-20)
                          .reverse()
                          .map((s) => (
                            <p key={s.id}>
                              {new Date(s.checkedAt).toLocaleString("zh-CN")} ·{" "}
                              {s.source === "http" ? "服务" : "资源"} ·{" "}
                              {s.ok ? "成功" : "失败"} · {s.detail}
                            </p>
                          ))}
                      </details>
                    )}
                  </>
                )}
              </fieldset>
              {error && (
                <p className="infra-error" role="alert">
                  {error}
                </p>
              )}
              <footer className="infra-save">
                <button
                  type="submit"
                  className="primary-button"
                  disabled={busy}
                >
                  <Check size={16} />
                  {busy ? "正在处理…" : "保存档案"}
                </button>
                <span>{dirty ? "有未保存修改" : "档案已保存"}</span>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={close}
                  disabled={busy}
                >
                  关闭详情
                </button>
              </footer>
            </form>
            {existing && (
              <details className="infra-manage">
                <summary>归档与删除</summary>
                <p>
                  归档后停止检查并隐藏期限提醒；已有任务会保留。删除档案不会关闭或取消真实服务器。
                </p>
                <button
                  className="secondary-button"
                  disabled={busy || dirty}
                  onClick={() =>
                    void action(async () => {
                      await p.update((d) => ({
                        ...d,
                        hosts: d.hosts.map((h) =>
                          h.id === draft.id
                            ? { ...h, archived: !h.archived }
                            : h,
                        ),
                      }));
                      setDraft(null);
                    })
                  }
                >
                  <Archive size={15} />
                  {draft.archived ? "恢复使用" : "归档主机"}
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 size={15} />
                  删除档案
                </button>
                {deleting && (
                  <div className="infra-notice">
                    <p>
                      删除这份主机档案及其服务、日志和检查记录？建议先导出完整备份。
                    </p>
                    <button
                      className="secondary-button"
                      onClick={() => setDeleting(false)}
                    >
                      保留档案
                    </button>
                    <button
                      className="danger-button"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          if (isTauri())
                            await invoke("save_host_credential", {
                              hostId: draft.id,
                              url: draft.collectorUrl,
                              token: "",
                            });
                          await p.update((d) => ({
                            ...d,
                            hosts: d.hosts.filter((h) => h.id !== draft.id),
                          }));
                          setDraft(null);
                        })
                      }
                    >
                      确认删除档案
                    </button>
                  </div>
                )}
              </details>
            )}
          </div>
        </GoalOverlay>
      )}
      {ai && (
        <InfraAI
          data={p.data}
          update={p.update}
          onClose={() => setAi(false)}
          onImport={(h) => {
            setAi(false);
            edit(h);
            initial.current = "";
          }}
          onSettings={p.onAiSettings}
          onTask={(d: TaskDraft, ref: string) => {
            setAi(false);
            p.onTask(d.title, d.notes, d.dueDate, ref);
          }}
          tasks={p.tasks}
        />
      )}
    </section>
  );
}
function SampleView({
  host: h,
  source,
}: {
  host: Host;
  source: Sample["source"];
}) {
  const s = latestSample(h, source),
    state = sampleState(s, h.intervalMinutes);
  return (
    <section className="infra-subcard">
      <header>
        <strong>
          {source === "http"
            ? "服务可用性 · 本机检查"
            : "服务器资源 · 只读采集"}
        </strong>
        <span className={`infra-status ${state}`}>{stateLabel[state]}</span>
      </header>
      {s ? (
        <>
          <p>
            {new Date(s.checkedAt).toLocaleString("zh-CN")} · {s.latencyMs} ms
          </p>
          <p>{s.detail}</p>
          {s.metrics && (
            <>
              <small>
                采样：{new Date(s.metrics.sampledAt).toLocaleString("zh-CN")}
              </small>
              <div className="infra-meters">
                {(
                  [
                    ["cpuPercent", "CPU"],
                    ["memoryPercent", "内存"],
                    ["diskPercent", "磁盘"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <strong>{s.metrics![key].toFixed(1)}%</strong>
                    <meter min={0} max={100} value={s.metrics![key]} />
                  </label>
                ))}
              </div>
              <p>
                已运行 {fmt(s.metrics.uptimeSeconds / 86400)} 天 · 接收{" "}
                {fmt(s.metrics.networkRxBytes / 1e9)} GB / 发送{" "}
                {fmt(s.metrics.networkTxBytes / 1e9)} GB（启动后累计）
              </p>
            </>
          )}
        </>
      ) : (
        <p>尚无样本，请先保存地址并检查。</p>
      )}
    </section>
  );
}
