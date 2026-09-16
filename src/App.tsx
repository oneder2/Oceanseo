import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  AlarmClock,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  DatabaseBackup,
  Download,
  Flag,
  Hourglass,
  Infinity as InfinityIcon,
  Eye,
  EyeOff,
  KeyRound,
  Menu,
  Maximize,
  Minimize,
  Minus,
  NotebookPen,
  Pin,
  PinOff,
  Plus,
  Search,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import CalendarView from "./CalendarView";
import WorkspaceNav from "./WorkspaceNav";
import BeadStudio from "./BeadStudio";
import CountdownView from "./CountdownView";
import DatePicker from "./DatePicker";
import HomeDashboard from "./HomeDashboard";
import SaveStatus from "./SaveStatus";
import { taskDraftKey, notebookDraftKey, readTaskDraft } from "./editorDrafts";
import MealPlanner from "./MealPlanner";
import ShoppingList from "./ShoppingList";
import WorkMonitorDashboard from "./WorkMonitorDashboard";
import PeoplePage from "./life/PeoplePage";
import FitnessPage from "./life/FitnessPage";
import TravelPage from "./life/TravelPage";
import MapSettings from "./life/MapSettings";
import { emptyLife, isLifeData, lifeEvents, type LifeData } from "./life/model";
import { loadLife } from "./life/store";
import "./life/life.css";
import "./release.css";
import { getAiSettings, saveAiSettings, testAiConnection } from "./aiSettingsStore";
import type { AiSettings } from "./aiSettingsStore";
import { APP_STATE_KEYS, bootstrapAppData, persistAppState } from "./appDataStore";
import { exportDataBackup, restoreDataBackup, selectDataBackup } from "./backupStore";
import type { DataBackup } from "./backupStore";
import { dateKey } from "./dateUtils";
import { countdownDays, loadCountdowns } from "./countdownStore";
import { useDailyReminders } from "./useDailyReminders";
import { useFullscreen } from "./useFullscreen";
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
import { getWorkDashboard, runScheduledWorkScan } from "./workMonitorStore";
import type { WorkDashboard } from "./workMonitorStore";
import {
  createMealPurchaseItems,
  createPurchaseItem,
  loadMealCheckedItems,
  loadMealPlan,
  loadPurchaseItems,
  mealShoppingItemKey,
  updatePurchaseItem,
} from "./shoppingStore";
import type { Countdown, Horizon, MealPlan, PurchaseItemDraft, ReminderSettings, Task, TaskDraft, TaskOrigin, View } from "./types";

const AUTOSTART_INITIALIZED_KEY = "tideplan.autostart-initialized";
const REMINDER_SETTINGS_KEY = "tideplan.reminders.v1";
const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const FALLBACK_APP_VERSION = "0.9.1";

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
    if (!value) return { enabled: true, times: ["09:00", "19:00"], countdownAdvanceDays: 3 };
    const parsed = JSON.parse(value) as Partial<ReminderSettings>;
    const times = Array.isArray(parsed.times) && parsed.times.length === 2
      ? [String(parsed.times[0]), String(parsed.times[1])] as [string, string]
      : ["09:00", "19:00"] as [string, string];
    const countdownAdvanceDays = Number.isInteger(parsed.countdownAdvanceDays)
      ? Math.min(30, Math.max(0, Number(parsed.countdownAdvanceDays)))
      : 3;
    return { enabled: parsed.enabled !== false, times, countdownAdvanceDays };
  } catch {
    return { enabled: true, times: ["09:00", "19:00"], countdownAdvanceDays: 3 };
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
  const [view, setView] = useState<View>("overview");
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
  const [notebookTaskId, setNotebookTaskId] = useState<string | null>(null);
  const [notebookNotes, setNotebookNotes] = useState("");
  const [notebookBusy, setNotebookBusy] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const [autostartAvailable, setAutostartAvailable] = useState(true);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings>(loadReminderSettings);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState(DEFAULT_AI_BASE_URL);
  const [aiModel, setAiModel] = useState("gpt-5.6");
  const [showAiApiKey, setShowAiApiKey] = useState(false);
  const [aiSettingsBusy, setAiSettingsBusy] = useState(false);
  const [aiSettingsError, setAiSettingsError] = useState("");
  const [purchaseItems, setPurchaseItems] = useState(loadPurchaseItems);
  const [mealPlan, setMealPlan] = useState(loadMealPlan);
  const [mealCheckedItems, setMealCheckedItems] = useState(loadMealCheckedItems);
  const [countdowns, setCountdowns] = useState(loadCountdowns);
  const [selectedCountdownId, setSelectedCountdownId] = useState<string | null>(null);
  const [appDataReady, setAppDataReady] = useState(false);
  const [appLoadError, setAppLoadError] = useState("");
  const [life, setLife] = useState<LifeData>(emptyLife);
  const lifeRef = useRef(life);
  lifeRef.current = life;
  const [lifeReady, setLifeReady] = useState(false);
  const [lifeError, setLifeError] = useState("");
  const [lifeSelection, setLifeSelection] = useState<{id:string;date:string}|undefined>();
  const calendarLifeEvents = useMemo(()=>lifeEvents(life),[life]);
  function updateLife(update:(d:LifeData)=>LifeData) {
    const next=update(lifeRef.current);
    if(!isLifeData(next) || new TextEncoder().encode(JSON.stringify(next)).length > 2 * 1024 * 1024) {
      setToast("未保存：数据无效或超过 2 MB，请检查内容、减少路线数据后重试");
      return false;
    }
    lifeRef.current=next;
    setLife(next);
    return true;
  }
  const [workOverview, setWorkOverview] = useState<WorkDashboard | null>(null);
  const [appVersion, setAppVersion] = useState(FALLBACK_APP_VERSION);
  const [backupBusy, setBackupBusy] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<DataBackup | null>(null);
  const [backupError, setBackupError] = useState("");
  const [toast, setToast] = useState("");
  const { fullscreen, busy: fullscreenBusy, toggle: toggleFullscreen } = useFullscreen(setToast);
  const { available: notificationAvailable, sendTest } = useDailyReminders(tasks, countdowns, reminderSettings, calendarLifeEvents, appDataReady && lifeReady && taskStoreReady);

  useEffect(()=>{
    if(!appDataReady)return;
    try{setLife(loadLife());setLifeReady(true);}catch(e){setLifeError(e instanceof Error?e.message:"人物与生活计划读取失败");}
  },[appDataReady]);
  useEffect(()=>{
    if(!lifeReady)return;
    void persistAppState(APP_STATE_KEYS.life,life).catch(()=>undefined);
  },[life,lifeReady]);

  useEffect(() => {
    if (!isTauri()) return;
    void getVersion().then(setAppVersion).catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    void bootstrapAppData()
      .then(() => {
        if (!active) return;
        setReminderSettings(loadReminderSettings());
        setPurchaseItems(loadPurchaseItems());
        setMealPlan(loadMealPlan());
        setMealCheckedItems(loadMealCheckedItems());
        setCountdowns(loadCountdowns());
        setAppDataReady(true);
      })
      .catch(() => {
        if (active) setAppLoadError("本机数据库读取失败，已暂停生活数据编辑以保护原数据。请检查磁盘空间后重新载入。");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void getAiSettings()
      .then((settings) => {
        if (!active) return;
        setAiSettings(settings);
        setAiBaseUrl(settings.baseUrl);
        setAiModel(settings.model);
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
    if (!appDataReady) return;
    void persistAppState(APP_STATE_KEYS.reminders, reminderSettings)
      .catch(() => setToast("提醒设置未写入数据库，已保留本地副本"));
  }, [appDataReady, reminderSettings]);

  useEffect(() => {
    if (!appDataReady) return;
    void persistAppState(APP_STATE_KEYS.purchases, purchaseItems.filter((item) => item.source === "manual"))
      .catch(() => setToast("采购清单未写入数据库，已保留本地副本"));
  }, [appDataReady, purchaseItems]);

  useEffect(() => {
    if (!appDataReady) return;
    void persistAppState(APP_STATE_KEYS.mealPlan, mealPlan)
      .catch(() => setToast("食谱未写入数据库，已保留本地副本"));
  }, [appDataReady, mealPlan]);

  useEffect(() => {
    if (!appDataReady) return;
    void persistAppState(APP_STATE_KEYS.mealChecked, mealCheckedItems)
      .catch(() => setToast("食谱勾选状态未写入数据库，已保留本地副本"));
  }, [appDataReady, mealCheckedItems]);

  useEffect(() => {
    if (!appDataReady) return;
    void persistAppState(APP_STATE_KEYS.countdowns, countdowns)
      .catch(() => setToast("关键日期未写入数据库，已保留本地副本"));
  }, [appDataReady, countdowns]);

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
        setNotebookTaskId(null);
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
        if (result) {
          setWorkOverview(result);
          setToast("每周项目检查已完成");
        }
      })
      .catch(() => setToast("自动项目检查未完成，请在工作观察中查看配置"));
  }, []);

  useEffect(() => {
    if (view !== "overview") return;
    void getWorkDashboard().then(setWorkOverview).catch(() => setWorkOverview(null));
  }, [view]);

  const activeTasks = tasks.filter((task) => !task.completedAt);
  const completedTasks = tasks.filter((task) => task.completedAt);
  const completionRate = tasks.length ? Math.round((completedTasks.length / tasks.length) * 100) : 0;
  const overdueCount = activeTasks.filter(isTaskOverdue).length;
  const aiPurchaseItems = useMemo(
    () => createMealPurchaseItems(mealPlan, mealCheckedItems),
    [mealCheckedItems, mealPlan],
  );
  const allPurchaseItems = useMemo(
    () => [...purchaseItems, ...aiPurchaseItems],
    [aiPurchaseItems, purchaseItems],
  );
  const mealPlanningContext = useMemo(() => {
    const today = dateKey();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 6);
    const end = dateKey(endDate);
    const taskLines = activeTasks.flatMap((task) => {
      const hasDate = Boolean(task.startDate || task.dueDate);
      const overlapsWeek = task.startDate && task.dueDate
        ? task.startDate <= end && task.dueDate >= today
        : task.startDate
          ? task.startDate >= today && task.startDate <= end
          : Boolean(task.dueDate && task.dueDate >= today && task.dueDate <= end);
      if (!hasDate || !overlapsWeek) return [];
      const schedule = task.startDate && task.dueDate
        ? `${task.startDate} 至 ${task.dueDate}`
        : task.startDate
          ? `${task.startDate} 开始`
          : `${task.dueDate} 截止`;
      return [`${schedule}：${task.title}${task.priority === "important" ? "（重要）" : ""}`];
    });
    const countdownLines = countdowns.flatMap((countdown) => {
      const days = countdownDays(countdown.targetDate, today);
      return days >= 0 && days <= 6 ? [`${countdown.targetDate}：关键日期“${countdown.title}”`] : [];
    });
    const lines = [...taskLines, ...countdownLines].slice(0, 12);
    return { text: lines.join("\n"), count: lines.length };
  }, [activeTasks, countdowns]);
  const notebookTask = tasks.find((task) => task.id === notebookTaskId) ?? null;

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
    setDraft(readTaskDraft(null, { ...emptyDraft, horizon, startDate }));
    setConfirmDelete(false);
    setEditorOpen(true);
  }

  function openTask(task: Task) {
    setEditingId(task.id);
    setPendingOrigin(null);
    setDraft(readTaskDraft(task.id, {
      title: task.title,
      notes: task.notes,
      horizon: task.horizon,
      priority: task.priority,
      startDate: task.startDate ?? "",
      dueDate: task.dueDate,
    }));
    setConfirmDelete(false);
    setEditorOpen(true);
  }

  function openNotebook(task: Task) {
    setNotebookTaskId(task.id);
    setNotebookNotes(localStorage.getItem(notebookDraftKey(task.id)) ?? task.notes);
  }

  function changeTaskDraft(value: TaskDraft) {
    if (taskBusy) return;
    setDraft(value);
    try { localStorage.setItem(taskDraftKey(editingId), JSON.stringify(value)); }
    catch { setToast("任务草稿暂存失败，请保持窗口打开并尽快保存"); }
  }
  function changeNotebookNotes(value: string) {
    if (notebookBusy) return;
    setNotebookNotes(value);
    if (!notebookTaskId) return;
    try { localStorage.setItem(notebookDraftKey(notebookTaskId), value); }
    catch { setToast("笔记草稿暂存失败，请保持窗口打开并尽快保存"); }
  }

  async function saveNotebook(event: React.FormEvent) {
    event.preventDefault();
    const task = tasks.find((item) => item.id === notebookTaskId);
    if (!task || notebookBusy) return;
    setNotebookBusy(true);
    try {
      const updated = await updateTask(task.id, {
        title: task.title,
        notes: notebookNotes,
        horizon: task.horizon,
        priority: task.priority,
        startDate: task.startDate,
        dueDate: task.dueDate,
      });
      setTasks((current) => current.map((item) => item.id === task.id ? updated : item));
      localStorage.removeItem(notebookDraftKey(task.id));
      setNotebookTaskId(null);
      setToast("事项笔记已保存");
    } catch {
      setToast("事项笔记未保存，请稍后重试");
    } finally {
      setNotebookBusy(false);
    }
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
      localStorage.removeItem(taskDraftKey(editingId));
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
      localStorage.removeItem(taskDraftKey(editingId));
      localStorage.removeItem(notebookDraftKey(editingId));
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
      const saved = await saveAiSettings(aiApiKey, aiBaseUrl, clearApiKey, aiModel);
      setAiSettings(saved);
      setAiBaseUrl(saved.baseUrl);
      setAiModel(saved.model);
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
    if (event.button === 0 && isTauri() && !fullscreen) await getCurrentWindow().startDragging();
  }

  async function testNotification() {
    const sent = await sendTest();
    setToast(sent ? "测试通知已发送" : "无法发送通知，请检查系统权限");
  }

  async function handleExportBackup() {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupError("");
    try {
      const saved = await exportDataBackup();
      if (saved) setToast("数据备份已保存");
    } catch {
      setBackupError("备份未导出，请先确认顶部保存状态，再检查保存位置和磁盘空间");
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleSelectBackup() {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupError("");
    try {
      const selected = await selectDataBackup();
      if (selected) setPendingBackup(selected);
    } catch {
      setBackupError("无法读取该文件，请选择由潮汐计划生成的 JSON 备份");
    } finally {
      setBackupBusy(false);
    }
  }

  async function confirmRestoreBackup() {
    if (!pendingBackup || backupBusy) return;
    setBackupBusy(true);
    setBackupError("");
    try {
      await restoreDataBackup(pendingBackup);
    } catch (error) {
      const reason = String(error);
      setBackupError(reason.includes("backup_snapshot_failed") ? "恢复已停止：无法创建当前数据的安全副本，请检查磁盘空间与目录权限。当前数据没有改变。" : reason.includes("backup_document_invalid") ? `恢复已停止：备份内的业务数据格式无效（${reason.split(":").at(-1)}）。当前数据没有改变。` : "备份恢复失败，请检查备份格式和顶部保存状态；当前数据没有改变");
      setBackupBusy(false);
    }
  }

  function setReminderTime(index: 0 | 1, value: string) {
    const times: [string, string] = [...reminderSettings.times];
    times[index] = value;
    setReminderSettings({ ...reminderSettings, times });
  }

  function addPurchaseItem(draft: PurchaseItemDraft) {
    const item = createPurchaseItem(draft);
    if (!item) return false;
    setPurchaseItems((current) => [item, ...current]);
    setToast("物品已加入采购清单");
    return true;
  }

  function editPurchaseItem(id: string, draft: PurchaseItemDraft) {
    const current = purchaseItems.find((item) => item.id === id);
    if (!current) return false;
    const updated = updatePurchaseItem(current, draft);
    if (!updated) return false;
    setPurchaseItems((items) => items.map((item) => item.id === id ? updated : item));
    setToast("采购物品已更新");
    return true;
  }

  function handleMealPlanGenerated(plan: MealPlan) {
    setMealPlan(plan);
    setMealCheckedItems([]);
  }

  function toggleMealShoppingItem(key: string) {
    setMealCheckedItems((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
  }

  function togglePurchaseItem(id: string) {
    const manualItem = purchaseItems.find((item) => item.id === id);
    if (manualItem) {
      setPurchaseItems((items) => items.map((item) => item.id === id ? { ...item, checked: !item.checked, updatedAt: new Date().toISOString() } : item));
      return;
    }
    const mealItem = aiPurchaseItems.find((item) => item.id === id);
    if (!mealItem) return;
    toggleMealShoppingItem(mealShoppingItemKey(mealItem.category, mealItem.name));
  }

  function openCountdown(countdown: Countdown) {
    setSelectedCountdownId(countdown.id);
    setView("countdowns");
  }

  const title = view === "people" ? "人物档案" : view === "fitness" ? "训练计划" : view === "travel" ? "旅行规划" : view === "bead-studio" ? "拼豆图纸" : view === "overview"
    ? "今日总览"
    : view === "today"
    ? "今日计划"
    : view === "calendar"
      ? "计划日历"
      : view === "countdowns"
        ? "关键日期"
      : view === "meal-planner"
        ? "AI 一周食谱"
        : view === "shopping-list"
          ? "采购清单"
        : view === "work-monitor"
          ? "工作观察"
      : view === "completed"
        ? "完成记录"
        : "所有计划";
  const subtitle =
    view === "people" ? "把关心的人与他们的偏好，变成计划的基础。" : view === "fitness" ? "让每个训练周期都有可执行的目标和真实记录。" : view === "travel" ? "从同行者的偏好出发，把日程连成路线。" : view === "bead-studio" ? "把喜欢的画面，变成一颗颗能拼出来的颜色。" : view === "overview"
      ? "把计划、时间、生活与工作放进同一条节奏里。"
      : view === "today"
      ? overdueCount
        ? `${overdueCount} 项已经逾期，先处理最重要的一件。`
        : "把注意力放在今天到期的事情上。"
      : view === "calendar"
        ? "让计划与关键日期在时间里留下轨迹。"
        : view === "countdowns"
          ? "看见重要日子正在靠近，也记住已经走过多久。"
        : view === "meal-planner"
          ? "从三餐安排到采购清单，把一周吃饭这件事一次想清楚。"
          : view === "shopping-list"
            ? "把手动记录和 AI 食谱食材整理成一次清晰的采购。"
          : view === "work-monitor"
            ? "检查近期项目变化，复盘进展，经你确认后再同步。"
        : view === "completed"
          ? `已经完成 ${completedTasks.length} 项计划。`
          : "按照时间跨度，安排手边与远方。";

  return (
    <div className={`desktop-shell${fullscreen ? " is-fullscreen" : ""}`}>
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
        <SaveStatus ready={appDataReady} />
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
          <button
            className={fullscreen ? "is-active" : ""}
            type="button"
            onClick={() => void toggleFullscreen()}
            disabled={fullscreenBusy}
            aria-label={fullscreen ? "退出全屏" : "进入全屏"}
            aria-pressed={fullscreen}
            aria-keyshortcuts="F11"
            title={fullscreen ? "退出全屏（F11 / Esc）" : "进入全屏（F11）"}
          >
            {fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
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

          <WorkspaceNav view={view} onNavigate={next => { setLifeSelection(undefined); setView(next); setMobileMenuOpen(false); }} />

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
              {["today", "all", "completed"].includes(view) && (
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
              {["today", "all", "completed"].includes(view) && (
                <button className="primary-button" type="button" onClick={() => openNewTask("short")}>
                  <Plus size={18} strokeWidth={2.5} />
                  <span>新计划</span>
                </button>
              )}
            </div>
          </section>

          {!appDataReady ? <div role="status"><p>{appLoadError || "正在读取本机数据…"}</p>{appLoadError && <button className="secondary-button" onClick={() => window.location.reload()}>重新载入</button>}</div> : ["people","fitness","travel"].includes(view) ? (!lifeReady ? <p role="status">{lifeError||"正在读取人物与生活计划…"}</p> : view === "people" ? <PeoplePage data={life} update={updateLife}/> : view === "fitness" ? <FitnessPage data={life} update={updateLife} selected={lifeSelection} onSettings={()=>setSettingsOpen(true)}/> : <TravelPage data={life} update={updateLife} selected={lifeSelection} onSettings={()=>setSettingsOpen(true)}/>) : view === "bead-studio" ? <BeadStudio /> : view === "overview" ? (
            <HomeDashboard
              lifeEvents={calendarLifeEvents}
              onOpenLife={event => { setLifeSelection({ id: event.targetId, date: event.date }); setView(event.kind === "training" ? "fitness" : "travel"); }}
              tasks={tasks}
              countdowns={countdowns}
              purchaseItems={allPurchaseItems}
              mealPlan={mealPlan}
              workDashboard={workOverview}
              reminderSettings={reminderSettings}
              onOpenTask={openTask}
              onOpenCountdown={openCountdown}
              onNavigate={setView}
              onNewTask={() => openNewTask("short")}
            />
          ) : view === "meal-planner" ? (
            <MealPlanner
              aiConfigured={aiSettings?.apiKeyConfigured ?? false}
              plan={mealPlan}
              checkedItems={mealCheckedItems}
              onPlanGenerated={handleMealPlanGenerated}
              onToggleShoppingItem={toggleMealShoppingItem}
              onOpenAiSettings={() => setSettingsOpen(true)}
              onOpenShoppingList={() => setView("shopping-list")}
              onToast={setToast}
              planningContext={mealPlanningContext.text}
              planningItemCount={mealPlanningContext.count}
            />
          ) : view === "shopping-list" ? (
            <ShoppingList
              items={allPurchaseItems}
              onAdd={addPurchaseItem}
              onUpdate={editPurchaseItem}
              onDelete={(id) => { setPurchaseItems((items) => items.filter((item) => item.id !== id)); setToast("采购物品已删除"); }}
              onToggle={togglePurchaseItem}
              onClearCompleted={() => { setPurchaseItems((items) => items.filter((item) => !item.checked)); setToast("已清除完成采购的物品"); }}
              onToast={setToast}
            />
          ) : view === "work-monitor" ? (
            <WorkMonitorDashboard
              aiConfigured={aiSettings?.apiKeyConfigured ?? false}
              onOpenAiSettings={() => setSettingsOpen(true)}
              onToast={setToast}
            />
          ) : view === "calendar" ? (
            <CalendarView
              tasks={tasks}
              countdowns={countdowns}
              onOpenTask={openTask}
              onOpenCountdown={openCountdown}
              onNewTask={(startDate) => openNewTask("short", startDate)}
              lifeEvents={calendarLifeEvents}
              onOpenLife={event=>{setLifeSelection({id:event.targetId,date:event.date});setView(event.kind==="training"?"fitness":"travel");}}
            />
          ) : view === "countdowns" ? (
            <CountdownView
              countdowns={countdowns}
              selectedCountdownId={selectedCountdownId}
              onChange={setCountdowns}
              onSelectionHandled={() => setSelectedCountdownId(null)}
              onToast={setToast}
            />
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
                        <button
                          className={`task-notebook-button ${task.notes ? "has-notes" : ""}`}
                          type="button"
                          onClick={() => openNotebook(task)}
                          aria-label={`${task.title}的记事本`}
                          title={task.notes ? "打开事项笔记" : "添加事项笔记"}
                        >
                          <NotebookPen size={15} />
                          <span>{task.notes ? "笔记" : "记笔记"}</span>
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
                <input autoFocus maxLength={200} value={draft.title} onChange={(event) => changeTaskDraft({ ...draft, title: event.target.value })} placeholder="例如：整理本周工作重点" />
              </label>

              <fieldset className="form-field">
                <legend>时间跨度</legend>
                <div className="segmented-control">
                  {horizons.map((horizon) => (
                    <button className={draft.horizon === horizon.id ? "active" : ""} type="button" key={horizon.id} onClick={() => changeTaskDraft({ ...draft, horizon: horizon.id })}>
                      {horizon.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="form-row">
                <DatePicker label="开始日期" value={draft.startDate} onChange={(startDate) => changeTaskDraft({ ...draft, startDate })} />
                <DatePicker label="截止日期" value={draft.dueDate} onChange={(dueDate) => changeTaskDraft({ ...draft, dueDate })} />
              </div>
              <div className="form-row form-row-single">
                <fieldset className="form-field">
                  <legend>优先级</legend>
                  <div className="segmented-control priority-control">
                    <button className={draft.priority === "normal" ? "active" : ""} type="button" onClick={() => changeTaskDraft({ ...draft, priority: "normal" })}>普通</button>
                    <button className={draft.priority === "important" ? "active important" : ""} type="button" onClick={() => changeTaskDraft({ ...draft, priority: "important" })}>
                      <Flag size={13} />重要
                    </button>
                  </div>
                </fieldset>
              </div>

              <label className="form-field">
                <span>记事本内容 <em>可选</em></span>
                <textarea rows={3} maxLength={4000} value={draft.notes} onChange={(event) => changeTaskDraft({ ...draft, notes: event.target.value })} placeholder="记录和这件事有关的背景或思路……" />
                <small>编辑时暂存草稿。关闭或重启后，再打开此事项（新事项点击添加计划）可继续。</small>
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
                <button className="secondary-button" type="button" disabled={taskBusy} onClick={() => { localStorage.removeItem(taskDraftKey(editingId)); setEditorOpen(false); }}>放弃草稿</button>
                <button className="secondary-button" type="button" onClick={() => setEditorOpen(false)}>暂存并关闭</button>
                <button className="primary-button" type="submit" disabled={!draft.title.trim() || taskBusy}>
                  <Check size={17} />保存计划
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {notebookTask && (
        <div className="modal-backdrop notebook-backdrop" role="presentation" onMouseDown={() => setNotebookTaskId(null)}>
          <section className="modal notebook-modal" role="dialog" aria-modal="true" aria-labelledby="notebook-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-head notebook-head">
              <div>
                <span>事项记事本</span>
                <h2 id="notebook-title">{notebookTask.title}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setNotebookTaskId(null)} aria-label="关闭记事本" title="关闭">
                <X size={18} />
              </button>
            </header>
            <form className="notebook-form" onSubmit={saveNotebook}>
              <label htmlFor="task-notebook">相关笔记</label>
              <textarea
                id="task-notebook"
                disabled={notebookBusy}
                autoFocus
                maxLength={4000}
                value={notebookNotes}
                onChange={(event) => changeNotebookNotes(event.target.value)}
                placeholder="记录背景、思路、资料位置或下一步……"
              />
              <footer>
                <span>{notebookNotes.length} / 4000</span>
                <button className="secondary-button" type="button" disabled={notebookBusy} onClick={() => { localStorage.removeItem(notebookDraftKey(notebookTask.id)); setNotebookNotes(notebookTask.notes); }}>放弃草稿</button>
                <button className="secondary-button" type="button" onClick={() => setNotebookTaskId(null)}>取消</button>
                <button className="primary-button" type="submit" disabled={notebookBusy}>
                  <Save size={16} />{notebookBusy ? "正在保存" : "保存笔记"}
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
            <div className={`countdown-reminder-setting ${!reminderSettings.enabled ? "is-disabled" : ""}`}>
              <Hourglass size={15} />
              <label>
                <span>关键日期提前提醒</span>
                <span className="advance-days-input">
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={reminderSettings.countdownAdvanceDays}
                    onChange={(event) => setReminderSettings({
                      ...reminderSettings,
                      countdownAdvanceDays: Math.min(30, Math.max(0, Number(event.target.value) || 0)),
                    })}
                    disabled={!reminderSettings.enabled}
                    aria-label="关键日期提前提醒天数"
                  />
                  <em>天</em>
                </span>
              </label>
              <p>每日提醒会同时列出临近的关键日期，设为 0 时只提醒当天。</p>
            </div>
            <section className="ai-settings-section" aria-label="AI 服务配置">
              <header>
                <span className="setting-icon ai-setting-icon"><KeyRound size={18} /></span>
                <div>
                  <strong>AI 服务</strong>
                  <p>工作周报、AI 食谱、训练与旅行 Agent 共用此配置。</p>
                </div>
                <span className={`ai-config-state ${aiSettings?.apiKeyConfigured ? "is-ready" : ""}`}>
                  {aiSettings?.apiKeyConfigured ? `已配置 ${aiSettings.apiKeyHint ?? ""}` : "未配置"}
                </span>
              </header>
              <form className="ai-settings-form" onSubmit={(event) => { event.preventDefault(); void persistAiSettings(); }}>
                <div className="ai-settings-fields">
                  <label><span>模型名称</span><input required maxLength={200} value={aiModel} onChange={e => setAiModel(e.target.value)} placeholder="填写服务商支持的模型标识" /></label>
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
                    <button className="secondary-button" type="button" disabled={aiSettingsBusy || !aiSettings?.apiKeyConfigured} onClick={async () => {
                      setAiSettingsBusy(true); setAiSettingsError("正在测试已保存的配置…");
                      try { setAiSettingsError(await testAiConnection()); } catch (e) { setAiSettingsError(e instanceof Error ? e.message : String(e)); } finally { setAiSettingsBusy(false); }
                    }}>测试已保存配置</button>
                    {aiSettings?.apiKeyConfigured && <button className="secondary-button" type="button" disabled={aiSettingsBusy} onClick={() => void persistAiSettings(true)}>清除密钥</button>}
                    <button className="primary-button" type="submit" disabled={aiSettingsBusy || !aiBaseUrl.trim()}><Save size={15} />保存 AI 配置</button>
                  </div>
                </footer>
              </form>
              <p>连接测试会发送不含个人资料的小型请求，可能消耗服务额度。先保存修改，再测试。</p>
            </section>
            <MapSettings />
            <section className="data-backup-section" aria-label="数据备份与恢复">
              <header>
                <span className="setting-icon backup-setting-icon"><DatabaseBackup size={18} /></span>
                <div>
                  <strong>数据备份与恢复</strong>
                  <p>导出计划、人物档案、训练记录、旅行、食谱、采购、拼豆图纸与提醒设置，不包含 AI 或地图密钥。</p>
                </div>
                <span className="sqlite-state"><ShieldCheck size={12} />SQLite</span>
              </header>
              <div className="backup-actions">
                <button className="secondary-button" type="button" onClick={() => void handleExportBackup()} disabled={backupBusy || !isTauri()}><Download size={15} />导出备份</button>
                <button className="secondary-button" type="button" onClick={() => void handleSelectBackup()} disabled={backupBusy || !isTauri()}><Upload size={15} />选择备份</button>
                <span>{isTauri() ? "恢复前校验内容并自动备份现有数据；恢复成功后清除编辑草稿并重新载入。" : "请在桌面应用中使用备份功能。"}</span>
              </div>
              {pendingBackup && (
                <div className="backup-confirm" role="alert">
                  <div>
                    <strong>准备恢复 {pendingBackup.tasks.length} 项计划</strong>
                    <span>备份时间：{new Date(pendingBackup.createdAt).toLocaleString("zh-CN")}</span>
                  </div>
                  <button type="button" onClick={() => setPendingBackup(null)} disabled={backupBusy}>取消</button>
                  <button className="restore-button" type="button" onClick={() => void confirmRestoreBackup()} disabled={backupBusy}>确认覆盖</button>
                </div>
              )}
              {backupError && <p className="backup-error" role="alert">{backupError}</p>}
              {sessionStorage.getItem("tideplan.restore-snapshot") && <p className="backup-error">上次恢复前的数据副本：{sessionStorage.getItem("tideplan.restore-snapshot")}</p>}
            </section>
            <div className="setting-note">
              <span className="brand-mark"><Check size={12} strokeWidth={3} /></span>
              <p>个人数据保存在本机 SQLite 数据库中。</p>
              <small>版本 {appVersion}</small>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </div>
  );
}
