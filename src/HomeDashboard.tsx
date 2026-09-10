import {
  ArrowRight,
  CalendarClock,
  ChefHat,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FolderGit2,
  Hourglass,
  ListTodo,
  Plus,
  ShoppingBasket,
} from "lucide-react";
import { countdownDays } from "./countdownStore";
import { dateFromKey, dateKey } from "./dateUtils";
import type { WorkDashboard } from "./workMonitorStore";
import type { Countdown, MealPlan, PurchaseItem, ReminderSettings, Task, View } from "./types";

interface HomeDashboardProps {
  tasks: Task[];
  countdowns: Countdown[];
  purchaseItems: PurchaseItem[];
  mealPlan: MealPlan | null;
  workDashboard: WorkDashboard | null;
  reminderSettings: ReminderSettings;
  onOpenTask: (task: Task) => void;
  onOpenCountdown: (countdown: Countdown) => void;
  onNavigate: (view: View) => void;
  onNewTask: () => void;
}

function compactDate(value: string) {
  const date = dateFromKey(value);
  if (value === dateKey()) return "今天";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function nextReminderLabel(settings: ReminderSettings) {
  if (!settings.enabled) return "提醒已关闭";
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const ordered = [...settings.times].sort();
  const next = ordered.find((time) => {
    const [hour, minute] = time.split(":").map(Number);
    return hour * 60 + minute > currentMinutes;
  });
  return next ? `下次提醒 ${next}` : `明天 ${ordered[0]}`;
}

export default function HomeDashboard({
  tasks,
  countdowns,
  purchaseItems,
  mealPlan,
  workDashboard,
  reminderSettings,
  onOpenTask,
  onOpenCountdown,
  onNavigate,
  onNewTask,
}: HomeDashboardProps) {
  const today = dateKey();
  const activeTasks = tasks.filter((task) => !task.completedAt);
  const focusTasks = activeTasks
    .filter((task) => task.startDate === today || Boolean(task.dueDate && task.dueDate <= today))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === "important" ? -1 : 1;
      return (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31");
    })
    .slice(0, 5);
  const fallbackTasks = [...activeTasks]
    .filter((task) => !focusTasks.some((focus) => focus.id === task.id))
    .sort((a, b) => (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31"))
    .slice(0, 3);
  const displayedTasks = focusTasks.length ? focusTasks : fallbackTasks;
  const nearbyCountdowns = countdowns
    .map((countdown) => ({ countdown, days: countdownDays(countdown.targetDate) }))
    .filter(({ days }) => days >= 0)
    .sort((a, b) => a.days - b.days)
    .slice(0, 3);
  const uncheckedPurchases = purchaseItems.filter((item) => !item.checked).length;
  const pendingDrafts = workDashboard?.drafts.filter((draft) => draft.status === "pending").length ?? 0;
  const latestScan = workDashboard?.latestScan;

  return (
    <section className="home-dashboard" aria-label="今日总览">
      <nav className="rhythm-route" aria-label="今日状态导航">
        <button type="button" onClick={() => onNavigate("today")}>
          <span className="route-icon route-coral"><ListTodo size={16} /></span>
          <span><small>TODAY</small><strong>{focusTasks.length || activeTasks.length} 项计划</strong></span>
          <ArrowRight size={14} />
        </button>
        <button type="button" onClick={() => onNavigate("countdowns")}>
          <span className="route-icon route-blue"><Hourglass size={16} /></span>
          <span><small>DATES</small><strong>{nearbyCountdowns[0] ? nearbyCountdowns[0].days === 0 ? "关键日期就在今天" : `最近还有 ${nearbyCountdowns[0].days} 天` : "暂无临近日期"}</strong></span>
          <ArrowRight size={14} />
        </button>
        <button type="button" onClick={() => onNavigate("shopping-list")}>
          <span className="route-icon route-gold"><ShoppingBasket size={16} /></span>
          <span><small>LIST</small><strong>{uncheckedPurchases} 项待采购</strong></span>
          <ArrowRight size={14} />
        </button>
        <button type="button" onClick={() => onNavigate("work-monitor")}>
          <span className="route-icon route-sage"><FolderGit2 size={16} /></span>
          <span><small>WORK</small><strong>{pendingDrafts ? `${pendingDrafts} 项待审核` : workDashboard ? "同步状态平稳" : "等待项目检查"}</strong></span>
          <ArrowRight size={14} />
        </button>
      </nav>

      <div className="home-grid">
        <section className="home-focus">
          <header className="home-section-head">
            <div>
              <span>{focusTasks.length ? "需要处理" : "接下来"}</span>
              <h2>{focusTasks.length ? "今天的重心" : "最近的计划"}</h2>
            </div>
            <button className="secondary-button" type="button" onClick={onNewTask}><Plus size={15} />添加计划</button>
          </header>
          <div className="home-task-list">
            {displayedTasks.map((task) => {
              const overdue = Boolean(task.dueDate && task.dueDate < today);
              return (
                <button className="home-task-row" type="button" onClick={() => onOpenTask(task)} key={task.id}>
                  <span className={`home-task-status ${overdue ? "is-overdue" : ""}`}>{overdue ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}</span>
                  <span>
                    <strong>{task.title}</strong>
                    <small>{task.dueDate ? `${overdue ? "已逾期 · " : "截止 · "}${compactDate(task.dueDate)}` : task.startDate ? `${compactDate(task.startDate)}开始` : "未设置日期"}</small>
                  </span>
                  <ArrowRight size={14} />
                </button>
              );
            })}
            {!displayedTasks.length && (
              <button className="home-empty-line" type="button" onClick={onNewTask}>
                <span><Plus size={17} /></span><strong>今天还没有计划</strong><small>添加一件值得完成的事</small>
              </button>
            )}
          </div>
          <footer className="home-focus-footer">
            <span><Clock3 size={13} />{nextReminderLabel(reminderSettings)}</span>
            <button type="button" onClick={() => onNavigate("all")}>查看所有计划<ArrowRight size={13} /></button>
          </footer>
        </section>

        <div className="home-side">
          <section className="home-side-section home-dates">
            <header className="home-section-head compact">
              <div><span>时间标记</span><h2>临近日期</h2></div>
              <button type="button" onClick={() => onNavigate("countdowns")}>全部<ArrowRight size={13} /></button>
            </header>
            <div className="home-date-list">
              {nearbyCountdowns.map(({ countdown, days }) => (
                <button type="button" onClick={() => onOpenCountdown(countdown)} key={countdown.id}>
                  <span className={`digits-${Math.min(String(Math.abs(days)).length, 7)}`}>{days === 0 ? "今" : days}</span>
                  <span><strong>{countdown.title}</strong><small>{days === 0 ? "就是今天" : `${compactDate(countdown.targetDate)} · 还有 ${days} 天`}</small></span>
                </button>
              ))}
              {!nearbyCountdowns.length && <p className="home-inline-empty">还没有未来的关键日期。</p>}
            </div>
          </section>

          <section className="home-side-section home-life">
            <header className="home-section-head compact">
              <div><span>生活安排</span><h2>本周餐桌</h2></div>
              <button type="button" onClick={() => onNavigate("meal-planner")}>打开<ArrowRight size={13} /></button>
            </header>
            <button className="home-life-line" type="button" onClick={() => onNavigate(mealPlan ? "meal-planner" : "shopping-list")}>
              <span className="route-icon route-gold">{mealPlan ? <ChefHat size={16} /> : <ShoppingBasket size={16} />}</span>
              <span><strong>{mealPlan?.planTitle ?? `${uncheckedPurchases} 项物品等待采购`}</strong><small>{mealPlan?.weekSummary ?? "生成食谱或继续整理采购清单"}</small></span>
            </button>
          </section>

          <section className="home-side-section home-work">
            <header className="home-section-head compact">
              <div><span>项目脉搏</span><h2>工作观察</h2></div>
              <button type="button" onClick={() => onNavigate("work-monitor")}>进入<ArrowRight size={13} /></button>
            </header>
            <button className="home-work-line" type="button" onClick={() => onNavigate("work-monitor")}>
              <CalendarClock size={17} />
              <span>
                <strong>{latestScan?.summary ?? "等待第一次项目检查"}</strong>
                <small>{pendingDrafts ? `${pendingDrafts} 份进展草稿需要你确认` : workDashboard?.config.enabled ? "自动检查已启用" : "自动检查尚未启用"}</small>
              </span>
            </button>
          </section>
        </div>
      </div>
    </section>
  );
}
