import { useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  AlarmClock,
  Archive,
  Bell,
  BellRing,
  CalendarRange,
  CalendarDays,
  ChefHat,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Flag,
  Infinity as InfinityIcon,
  Eye,
  EyeOff,
  KeyRound,
  LayoutList,
  Menu,
  Minus,
  Pin,
  PinOff,
  Plus,
  Radar,
  Search,
  Save,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import CalendarView from "./CalendarView";
import DatePicker from "./DatePicker";
import MealPlanner from "./MealPlanner";
import WorkMonitorDashboard from "./WorkMonitorDashboard";
import { getAiSettings, saveAiSettings } from "./aiSettingsStore";
import type { AiSettings } from "./aiSettingsStore";
import { dateKey } from "./dateUtils";
import { useDailyReminders } from "./useDailyReminders";
import {
  bootstrapTasks,
  createTask,
  deleteTask as deleteStoredTask,
  getTask,
  setTaskCompleted,
  takePendingDeepLinks,
  updateTask,
} from "./taskStore";
import type { DeepLinkMessage } from "./taskStore";
import { runScheduledWorkScan } from "./workMonitorStore";
import type { Horizon, ReminderSettings, Task, TaskDraft, TaskOrigin, View } from "./types";

const AUTOSTART_INITIALIZED_KEY = "tideplan.autostart-initialized";
const REMINDER_SETTINGS_KEY = "tideplan.reminders.v1";
const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";

const horizons: Array<{
  id: Horizon;
  label: string;
  subtitle: string;
  icon: typeof AlarmClock;
}> = [
  { id: "short", label: "短期", subtitle: "眼前一周", icon: AlarmClock },
  { id: "mid", label: "中期", subtitle: "未来一季", icon: CalendarDays },
  { id: "long", label: "长期", subtitle: "更远方向", icon: InfinityIcon },
];

const emptyDraft: TaskDraft = {
  title: "",
  notes: "",
  horizon: "short",
  priority: "normal",
  startDate: "",
  dueDate: "",
};

function loadReminderSettings(): ReminderSettings {
  try {
    const value = localStorage.getItem(REMINDER_SETTINGS_KEY);
    if (!value) return { enabled: true, times: ["09:00", "19:00"] };
    const parsed = JSON.parse(value) as Partial<ReminderSettings>;
    const times = Array.isArray(parsed.times) && parsed.times.length === 2
      ? [String(parsed.times[0]), String(parsed.times[1])] as [string, string]
      : ["09:00", "19:00"] as [string, string];
    return { enabled: parsed.enabled !== false, times };
  } catch {
    return { enabled: true, times: ["09:00", "19:00"] };
  }
}

function formatDueDate(value: string) {
  if (!value) return "";
  const today = dateKey();
  if (value === today) return "今天";

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (value === dateKey(tomorrow)) return "明天";

  const [year, month, day] = value.split("-").map(Number);
  return `${month}月${day}日${year !== new Date().getFullYear() ? ` · ${year}` : ""}`;
}

function currentGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function formatHeaderDate() {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
}

function isTaskOverdue(task: Task) {
  return Boolean(task.dueDate && task.dueDate < dateKey() && !task.completedAt);
}

function sortTasks(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "important" ? -1 : 1;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function aiSettingsErrorMessage(error: unknown) {
  const code = String(error);
  if (code.includes("ai_base_url_invalid")) return "BASE_URL 必须是有效的 HTTP 或 HTTPS 地址";
  if (code.includes("openai_api_key_invalid")) return "API_KEY 格式无效，请检查后重试";
  if (code.includes("ai_settings_write_failed")) return "AI 配置无法写入本机应用目录";
  return "AI 配置未保存，请稍后重试";
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft);
  const [pendingOrigin, setPendingOrigin] = useState<TaskOrigin | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [taskStoreReady, setTaskStoreReady] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const [autostartAvailable, setAutostartAvailable] = useState(true);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings>(loadReminderSettings);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState(DEFAULT_AI_BASE_URL);
  const [showAiApiKey, setShowAiApiKey] = useState(false);
  const [aiSettingsBusy, setAiSettingsBusy] = useState(false);
  const [aiSettingsError, setAiSettingsError] = useState("");
  const [toast, setToast] = useState("");
  const { available: notificationAvailable, sendTest } = useDailyReminders(tasks, reminderSettings);

  useEffect(() => {
    let active = true;
    void getAiSettings()
      .then((settings) => {
        if (!active) return;
        setAiSettings(settings);
        setAiBaseUrl(settings.baseUrl);
      })
      .catch(() => {
        if (active) setAiSettingsError("无法读取 AI 配置");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    let stopListening: (() => void) | undefined;

    const prepareTaskStore = async () => {
      try {
        const result = await bootstrapTasks();
        if (!active) return;
        setTasks(result.tasks);
        setTaskStoreReady(true);
        if (result.migrationError) {
          setToast("旧计划未迁移，原数据已保留，可重启后重试");
        }

        if (isTauri()) {
          stopListening = await listen("oceanseo-deep-link", () => {
            void consumePendingDeepLinks();
          });
          await consumePendingDeepLinks();
        }
      } catch {
        if (active) {
          setTaskStoreReady(true);
          setToast("无法读取计划数据库，请重启应用后重试");
        }
      }
    };

    void prepareTaskStore();
    return () => {
      active = false;
      stopListening?.();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(REMINDER_SETTINGS_KEY, JSON.stringify(reminderSettings));
  }, [reminderSettings]);

  useEffect(() => {
    if (!isTauri()) {
      setAutostartAvailable(false);
      return;
    }

    let active = true;
    const prepareAutostart = async () => {
      try {
        if (!localStorage.getItem(AUTOSTART_INITIALIZED_KEY)) {
          await enable();
          localStorage.setItem(AUTOSTART_INITIALIZED_KEY, "true");
        }
        const value = await isEnabled();
        if (active) setAutostart(value);
      } catch {
        if (active) setAutostartAvailable(false);
      }
    };
    void prepareAutostart();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditorOpen(false);
        setSettingsOpen(false);
        setMobileMenuOpen(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openNewTask("short");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    void runScheduledWorkScan()
      .then((result) => {
        if (result) setToast("每周项目检查已完成");
      })
      .catch(() => setToast("自动项目检查未完成，请在工作观察中查看配置"));
  }, []);

  const activeTasks = tasks.filter((task) => !task.completedAt);
  const completedTasks = tasks.filter((task) => task.completedAt);
  const completionRate = tasks.length ? Math.round((completedTasks.length / tasks.length) * 100) : 0;
  const overdueCount = activeTasks.filter(isTaskOverdue).length;

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    return sortTasks(
      tasks.filter((task) => {
        if (view === "completed" && !task.completedAt) return false;
        if (view === "all" && task.completedAt) return false;
        if (
          view === "today" &&
          (task.completedAt || (task.startDate !== dateKey() && (!task.dueDate || task.dueDate > dateKey())))
        ) {
          return false;
        }
        if (!query) return true;
        return `${task.title} ${task.notes}`.toLocaleLowerCase("zh-CN").includes(query);
      }),
    );
  }, [tasks, view, search]);

  function openNewTask(horizon: Horizon, startDate = "") {
    setEditingId(null);
    setPendingOrigin(null);
    setDraft({ ...emptyDraft, horizon, startDate });
    setConfirmDelete(false);
    setEditorOpen(true);
  }

  function openTask(task: Task) {
    setEditingId(task.id);
    setPendingOrigin(null);
    setDraft({
      title: task.title,
      notes: task.notes,
      horizon: task.horizon,
      priority: task.priority,
      startDate: task.startDate ?? "",
      dueDate: task.dueDate,
    });
    setConfirmDelete(false);
    setEditorOpen(true);
  }

  async function saveTask(event: React.FormEvent) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title || taskBusy) return;

    setTaskBusy(true);
    try {
      if (editingId) {
        const updated = await updateTask(editingId, { ...draft, title });
        setTasks((current) => current.map((task) => task.id === editingId ? updated : task));
        setToast("计划已更新");
      } else {
        const created = await createTask({ ...draft, title }, pendingOrigin);
        setTasks((current) => [created, ...current]);
        setToast("计划已加入");
      }
      setPendingOrigin(null);
      setEditorOpen(false);
    } catch {
      setToast("计划未保存，请稍后重试");
    } finally {
      setTaskBusy(false);
    }
  }

  async function toggleTask(id: string) {
    const current = tasks.find((task) => task.id === id);
    if (!current) return;
    const completed = !current.completedAt;
    try {
      const updated = await setTaskCompleted(id, completed);
      setTasks((allTasks) => allTasks.map((task) => task.id === id ? updated : task));
      setToast(completed ? "完成了一件事" : "已恢复到计划中");
    } catch {
      setToast("计划状态未更新，请稍后重试");
    }
  }

  async function deleteTask() {
    if (!editingId) return;
    setTaskBusy(true);
    try {
      await deleteStoredTask(editingId);
      setTasks((current) => current.filter((task) => task.id !== editingId));
      setEditorOpen(false);
      setToast("计划已删除");
    } catch {
      setToast("计划未删除，请稍后重试");
    } finally {
      setTaskBusy(false);
    }
  }

  async function consumePendingDeepLinks() {
    const messages = await takePendingDeepLinks();
    for (const message of messages) {
      await handleDeepLinkMessage(message);
    }
  }

  async function handleDeepLinkMessage(message: DeepLinkMessage) {
    if (message.outcome === "rejected") {
      setToast("无法打开该链接，请检查链接格式后重试");
      return;
    }
    if (message.route === "open") {
      try {
        openTask(await getTask(message.task_id));
      } catch {
        setToast("链接对应的计划不存在或已删除");
      }
      return;
    }

    setEditingId(null);
    setPendingOrigin({
      kind: "deep_link",
      label: message.source_label,
      reference: message.source_ref,
    });
    setDraft({
      title: message.title,
      notes: "",
      horizon: message.horizon,
      priority: message.priority,
      startDate: message.start_date ?? "",
      dueDate: message.due_date ?? "",
    });
    setConfirmDelete(false);
    setEditorOpen(true);
  }

  async function toggleAutostart() {
    if (!autostartAvailable || autostartBusy) return;
    setAutostartBusy(true);
    try {
      if (autostart) await disable();
      else await enable();
      setAutostart(!autostart);
      localStorage.setItem(AUTOSTART_INITIALIZED_KEY, "true");
    } catch {
      setAutostartAvailable(false);
    } finally {
      setAutostartBusy(false);
    }
  }

  async function persistAiSettings(clearApiKey = false) {
    if (aiSettingsBusy) return;
    setAiSettingsBusy(true);
    setAiSettingsError("");
    try {
      const saved = await saveAiSettings(aiApiKey, aiBaseUrl, clearApiKey);
      setAiSettings(saved);
      setAiBaseUrl(saved.baseUrl);
      setAiApiKey("");
      setToast(clearApiKey ? "AI 密钥已清除" : "AI 服务配置已保存");
    } catch (error) {
      setAiSettingsError(aiSettingsErrorMessage(error));
    } finally {
      setAiSettingsBusy(false);
    }
  }

  async function handleWindowAction(action: "minimize" | "close" | "pin") {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    if (action === "minimize") await appWindow.minimize();
    if (action === "close") await appWindow.close();
    if (action === "pin") {
      const nextValue = !alwaysOnTop;
      await appWindow.setAlwaysOnTop(nextValue);
      setAlwaysOnTop(nextValue);
      setToast(nextValue ? "窗口已置顶" : "已取消置顶");
    }
  }

  async function beginDrag(event: React.MouseEvent) {
    if (event.button === 0 && isTauri()) await getCurrentWindow().startDragging();
  }

  async function testNotification() {
    const sent = await sendTest();
    setToast(sent ? "测试通知已发送" : "无法发送通知，请检查系统权限");
  }

  function setReminderTime(index: 0 | 1, value: string) {
    const times: [string, string] = [...reminderSettings.times];
    times[index] = value;
    setReminderSettings({ ...reminderSettings, times });
  }

  const title = view === "today"
    ? "今日计划"
    : view === "calendar"
      ? "计划日历"
      : view === "meal-planner"
        ? "AI 一周食谱"
      : view === "work-monitor"
        ? "工作观察"
      : view === "completed"
        ? "完成记录"
        : "所有计划";
  const subtitle =
    view === "today"
      ? overdueCount
        ? `${overdueCount} 项已经逾期，先处理最重要的一件。`
        : "把注意力放在今天到期的事情上。"
      : view === "calendar"
        ? "让开始、截止与完成在时间里留下轨迹。"
        : view === "meal-planner"
          ? "从三餐安排到采购清单，把一周吃饭这件事一次想清楚。"
        : view === "work-monitor"
          ? "检查近期项目变化，复盘进展，经你确认后再同步。"
        : view === "completed"
          ? `已经完成 ${completedTasks.length} 项计划。`
          : "按照时间跨度，安排手边与远方。";

  return (
    <div className="desktop-shell">
      <header className="titlebar" onMouseDown={beginDrag}>
        <button
          className="titlebar-menu"
          type="button"
          onClick={() => setMobileMenuOpen((value) => !value)}
          aria-label="打开导航"
          title="打开导航"
        >
          <Menu size={17} />
        </button>
        <div className="titlebar-brand" aria-label="潮汐计划">
          <span className="brand-mark"><Check size={13} strokeWidth={3} /></span>
          <span>潮汐计划</span>
        </div>
        <div className="window-actions" onMouseDown={(event) => event.stopPropagation()}>
          <button
            className={alwaysOnTop ? "is-active" : ""}
            type="button"
            onClick={() => void handleWindowAction("pin")}
            aria-label={alwaysOnTop ? "取消置顶" : "窗口置顶"}
            title={alwaysOnTop ? "取消置顶" : "窗口置顶"}
          >
            {alwaysOnTop ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button type="button" onClick={() => void handleWindowAction("minimize")} aria-label="最小化" title="最小化">
            <Minus size={15} />
          </button>
          <button className="window-close" type="button" onClick={() => void handleWindowAction("close")} aria-label="隐藏到托盘" title="隐藏到托盘">
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="app-layout">
        <aside className={`sidebar ${mobileMenuOpen ? "is-open" : ""}`}>
          <div className="sidebar-date">
            <span>{formatHeaderDate()}</span>
            <strong>{currentGreeting()}</strong>
          </div>

          <nav className="main-nav" aria-label="计划视图">
            <button className={view === "today" ? "active" : ""} onClick={() => { setView("today"); setMobileMenuOpen(false); }}>
              <Sparkles size={18} />
              <span>今天</span>
              {overdueCount > 0 && <em>{overdueCount}</em>}
            </button>
            <button className={view === "all" ? "active" : ""} onClick={() => { setView("all"); setMobileMenuOpen(false); }}>
              <LayoutList size={18} />
              <span>所有计划</span>
              <em>{activeTasks.length}</em>
            </button>
            <button className={view === "calendar" ? "active" : ""} onClick={() => { setView("calendar"); setMobileMenuOpen(false); }}>
              <CalendarRange size={18} />
              <span>计划日历</span>
            </button>
            <button className={view === "meal-planner" ? "active" : ""} onClick={() => { setView("meal-planner"); setMobileMenuOpen(false); }}>
              <ChefHat size={18} />
              <span>AI 食谱</span>
            </button>
            <button className={view === "work-monitor" ? "active" : ""} onClick={() => { setView("work-monitor"); setMobileMenuOpen(false); }}>
              <Radar size={18} />
              <span>工作观察</span>
            </button>
            <button className={view === "completed" ? "active" : ""} onClick={() => { setView("completed"); setMobileMenuOpen(false); }}>
              <Archive size={18} />
              <span>完成记录</span>
              <em>{completedTasks.length}</em>
            </button>
          </nav>

          <section className="progress-panel" aria-label="计划进度">
            <div className="progress-heading">
              <span>总进度</span>
              <strong>{completionRate}%</strong>
            </div>
            <div className="progress-track" aria-hidden="true">
              <span style={{ width: `${completionRate}%` }} />
            </div>
            <p>{tasks.length ? `${completedTasks.length} / ${tasks.length} 项已完成` : "从一件小事开始"}</p>
          </section>

          <div className="sidebar-footer">
            <button type="button" onClick={() => setSettingsOpen(true)}>
              <Settings size={18} />
              <span>偏好设置</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </aside>

        {mobileMenuOpen && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setMobileMenuOpen(false)} />}

        <main className="workspace">
          <section className="workspace-head">
            <div>
              <span className="eyebrow">{formatHeaderDate()}</span>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            <div className="head-actions">
              {view !== "calendar" && view !== "meal-planner" && view !== "work-monitor" && (
                <label className="search-field">
                  <Search size={17} />
                  <span className="sr-only">搜索计划</span>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索计划" />
                  {search && (
                    <button type="button" onClick={() => setSearch("")} aria-label="清空搜索" title="清空搜索">
                      <X size={14} />
                    </button>
                  )}
                </label>
              )}
              {view !== "meal-planner" && view !== "work-monitor" && (
                <button className="primary-button" type="button" onClick={() => openNewTask("short")}>
                  <Plus size={18} strokeWidth={2.5} />
                  <span>新计划</span>
                </button>
              )}
            </div>
          </section>

          {view === "meal-planner" ? (
            <MealPlanner
              aiConfigured={aiSettings?.apiKeyConfigured ?? false}
              onOpenAiSettings={() => setSettingsOpen(true)}
              onToast={setToast}
            />
          ) : view === "work-monitor" ? (
            <WorkMonitorDashboard
              aiConfigured={aiSettings?.apiKeyConfigured ?? false}
              onOpenAiSettings={() => setSettingsOpen(true)}
              onToast={setToast}
            />
          ) : view === "calendar" ? (
            <CalendarView tasks={tasks} onOpenTask={openTask} onNewTask={(startDate) => openNewTask("short", startDate)} />
          ) : (
            <>
              <section className="timeline-strip" aria-label="今日完成进度">
                <div className="timeline-copy">
                  <span className="timeline-kicker">TODAY</span>
                  <strong>{activeTasks.length ? "保持自己的节奏" : "今天很轻盈"}</strong>
                </div>
                <div className="timeline-line">
                  {Array.from({ length: 12 }, (_, index) => (
                    <span key={index} className={index < Math.round(completionRate / 8.34) ? "filled" : ""} />
                  ))}
                </div>
                <span className="timeline-percent">{completionRate}%</span>
              </section>

              <section className="board" aria-label="计划看板">
            {horizons.map((horizon) => {
              const columnTasks = visibleTasks.filter((task) => task.horizon === horizon.id);
              const HorizonIcon = horizon.icon;
              return (
                <section className={`board-column horizon-${horizon.id}`} key={horizon.id}>
                  <header className="column-head">
                    <div className="column-icon"><HorizonIcon size={17} /></div>
                    <div>
                      <h2>{horizon.label}</h2>
                      <p>{horizon.subtitle}</p>
                    </div>
                    <span className="column-count">{columnTasks.length}</span>
                    <button type="button" onClick={() => openNewTask(horizon.id)} aria-label={`添加${horizon.label}计划`} title={`添加${horizon.label}计划`}>
                      <Plus size={17} />
                    </button>
                  </header>

                  <div className="task-list">
                    {columnTasks.map((task) => (
                      <article className={`task-card ${task.completedAt ? "is-completed" : ""}`} key={task.id}>
                        <button className="check-button" type="button" onClick={() => void toggleTask(task.id)} aria-label={task.completedAt ? "恢复计划" : "完成计划"}>
                          {task.completedAt ? <CheckCircle2 size={19} /> : <Circle size={19} />}
                        </button>
                        <button className="task-main" type="button" onClick={() => openTask(task)}>
                          <span className="task-title-row">
                            <strong>{task.title}</strong>
                            {task.priority === "important" && <Flag size={14} fill="currentColor" aria-label="重要" />}
                          </span>
                          {task.notes && <span className="task-notes">{task.notes}</span>}
                          <span className="task-meta">
                            {task.startDate && <span><Clock3 size={13} />{formatDueDate(task.startDate)}开始</span>}
                            {task.dueDate && (
                              <span className={isTaskOverdue(task) ? "overdue" : ""}>
                                <CalendarDays size={13} />{isTaskOverdue(task) ? "已逾期 · " : ""}{formatDueDate(task.dueDate)}截止
                              </span>
                            )}
                            {!task.startDate && !task.dueDate && (
                              <span className="no-date">不设期限</span>
                            )}
                          </span>
                        </button>
                      </article>
                    ))}

                    {!columnTasks.length && (
                      <button className="empty-column" type="button" onClick={() => openNewTask(horizon.id)}>
                        <span><Plus size={16} /></span>
                        <strong>{!taskStoreReady ? "正在读取计划" : search ? "没有匹配的计划" : `添加${horizon.label}计划`}</strong>
                        <small>{!taskStoreReady ? "请稍候" : search ? "试试其他关键词" : horizon.subtitle}</small>
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
              </section>
            </>
          )}
        </main>
      </div>

      {editorOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditorOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="editor-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-head">
              <div>
                <span>{editingId ? "编辑计划" : pendingOrigin ? "外部计划草稿" : "新的计划"}</span>
                <h2 id="editor-title">{editingId ? "调整接下来的方向" : pendingOrigin ? "确认后再加入计划" : "记下想完成的事"}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setEditorOpen(false)} aria-label="关闭" title="关闭">
                <X size={18} />
              </button>
            </header>

            <form onSubmit={saveTask}>
              {pendingOrigin && (
                <div className="deep-link-review" role="status">
                  <span>待审核草稿</span>
                  <p>链接只预填了计划信息，保存前仍可修改。</p>
                  {pendingOrigin.label && <small>来源：{pendingOrigin.label}</small>}
                </div>
              )}
              <label className="form-field">
                <span>计划名称</span>
                <input autoFocus maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：整理本周工作重点" />
              </label>

              <fieldset className="form-field">
                <legend>时间跨度</legend>
                <div className="segmented-control">
                  {horizons.map((horizon) => (
                    <button className={draft.horizon === horizon.id ? "active" : ""} type="button" key={horizon.id} onClick={() => setDraft({ ...draft, horizon: horizon.id })}>
                      {horizon.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="form-row">
                <DatePicker label="开始日期" value={draft.startDate} onChange={(startDate) => setDraft({ ...draft, startDate })} />
                <DatePicker label="截止日期" value={draft.dueDate} onChange={(dueDate) => setDraft({ ...draft, dueDate })} />
              </div>
              <div className="form-row form-row-single">
                <fieldset className="form-field">
                  <legend>优先级</legend>
                  <div className="segmented-control priority-control">
                    <button className={draft.priority === "normal" ? "active" : ""} type="button" onClick={() => setDraft({ ...draft, priority: "normal" })}>普通</button>
                    <button className={draft.priority === "important" ? "active important" : ""} type="button" onClick={() => setDraft({ ...draft, priority: "important" })}>
                      <Flag size={13} />重要
                    </button>
                  </div>
                </fieldset>
              </div>

              <label className="form-field">
                <span>备注 <em>可选</em></span>
                <textarea rows={3} maxLength={4000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="补充一些细节……" />
              </label>

              <footer className="modal-actions">
                {editingId && (
                  confirmDelete ? (
                    <div className="delete-confirm">
                      <span>确定删除？</span>
                      <button type="button" onClick={() => setConfirmDelete(false)}>取消</button>
                      <button className="danger" type="button" onClick={() => void deleteTask()} disabled={taskBusy}>删除</button>
                    </div>
                  ) : (
                    <button className="delete-button" type="button" onClick={() => setConfirmDelete(true)} aria-label="删除计划" title="删除计划">
                      <Trash2 size={17} />
                    </button>
                  )
                )}
                <span className="action-spacer" />
                <button className="secondary-button" type="button" onClick={() => setEditorOpen(false)}>取消</button>
                <button className="primary-button" type="submit" disabled={!draft.title.trim() || taskBusy}>
                  <Check size={17} />保存计划
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-head">
              <div>
                <span>潮汐计划</span>
                <h2 id="settings-title">偏好设置</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setSettingsOpen(false)} aria-label="关闭" title="关闭"><X size={18} /></button>
            </header>
            <div className="setting-row">
              <div className="setting-icon"><Sparkles size={18} /></div>
              <div>
                <strong>开机自动启动</strong>
                <p>{autostartAvailable ? "登录桌面后，自动打开潮汐计划。" : "请在 Linux 桌面应用中设置。"}</p>
              </div>
              <button
                type="button"
                className={`switch ${autostart ? "is-on" : ""}`}
                onClick={() => void toggleAutostart()}
                disabled={!autostartAvailable || autostartBusy}
                role="switch"
                aria-checked={autostart}
                aria-label="开机自动启动"
              ><span /></button>
            </div>
            <div className="setting-row reminder-setting-row">
              <div className="setting-icon notification-icon">{reminderSettings.enabled ? <BellRing size={18} /> : <Bell size={18} />}</div>
              <div>
                <strong>每日计划提醒</strong>
                <p>{notificationAvailable ? "窗口隐藏到托盘后仍会按时提醒。" : "请在 Linux 桌面应用中授权通知。"}</p>
              </div>
              <button
                type="button"
                className={`switch ${reminderSettings.enabled ? "is-on" : ""}`}
                onClick={() => setReminderSettings({ ...reminderSettings, enabled: !reminderSettings.enabled })}
                role="switch"
                aria-checked={reminderSettings.enabled}
                aria-label="每日计划提醒"
              ><span /></button>
            </div>
            <div className={`reminder-times ${!reminderSettings.enabled ? "is-disabled" : ""}`}>
              <label>
                <span>早间</span>
                <input type="time" value={reminderSettings.times[0]} onChange={(event) => setReminderTime(0, event.target.value)} disabled={!reminderSettings.enabled} />
              </label>
              <label>
                <span>晚间</span>
                <input type="time" value={reminderSettings.times[1]} onChange={(event) => setReminderTime(1, event.target.value)} disabled={!reminderSettings.enabled} />
              </label>
              <button className="test-notification" type="button" onClick={() => void testNotification()} disabled={!notificationAvailable || !reminderSettings.enabled}>
                <Bell size={14} />测试通知
              </button>
            </div>
            <section className="ai-settings-section" aria-label="AI 服务配置">
              <header>
                <span className="setting-icon ai-setting-icon"><KeyRound size={18} /></span>
                <div>
                  <strong>AI 服务</strong>
                  <p>工作周报与 AI 食谱共用此配置。</p>
                </div>
                <span className={`ai-config-state ${aiSettings?.apiKeyConfigured ? "is-ready" : ""}`}>
                  {aiSettings?.apiKeyConfigured ? `已配置 ${aiSettings.apiKeyHint ?? ""}` : "未配置"}
                </span>
              </header>
              <form className="ai-settings-form" onSubmit={(event) => { event.preventDefault(); void persistAiSettings(); }}>
                <div className="ai-settings-fields">
                  <label>
                    <span>BASE_URL</span>
                    <input
                      type="url"
                      spellCheck={false}
                      value={aiBaseUrl}
                      onChange={(event) => setAiBaseUrl(event.target.value)}
                      placeholder={DEFAULT_AI_BASE_URL}
                    />
                  </label>
                  <label>
                    <span>API_KEY</span>
                    <span className="ai-key-input">
                      <input
                        type={showAiApiKey ? "text" : "password"}
                        autoComplete="off"
                        spellCheck={false}
                        value={aiApiKey}
                        onChange={(event) => setAiApiKey(event.target.value)}
                        placeholder={aiSettings?.apiKeyConfigured ? "留空则保留当前密钥" : "输入服务商提供的密钥"}
                      />
                      <button type="button" onClick={() => setShowAiApiKey((value) => !value)} aria-label={showAiApiKey ? "隐藏密钥" : "显示密钥"} title={showAiApiKey ? "隐藏密钥" : "显示密钥"}>
                        {showAiApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </span>
                  </label>
                </div>
                <footer>
                  <span>{aiSettingsError || "密钥保存在本机应用数据目录，仅当前用户可读取。"}</span>
                  <div>
                    {aiSettings?.apiKeyConfigured && <button className="secondary-button" type="button" disabled={aiSettingsBusy} onClick={() => void persistAiSettings(true)}>清除密钥</button>}
                    <button className="primary-button" type="submit" disabled={aiSettingsBusy || !aiBaseUrl.trim()}><Save size={15} />保存 AI 配置</button>
                  </div>
                </footer>
              </form>
            </section>
            <div className="setting-note">
              <span className="brand-mark"><Check size={12} strokeWidth={3} /></span>
              <p>所有计划只保存在这台电脑上。</p>
              <small>版本 0.3.1</small>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </div>
  );
}
