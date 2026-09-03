import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  ArrowRight,
  Check,
  ChefHat,
  ChevronDown,
  ChevronUp,
  KeyRound,
  ListPlus,
  LoaderCircle,
  RefreshCw,
  ShoppingBasket,
  Sparkles,
  Utensils,
} from "lucide-react";
import type { MealPlan, MealPreferences } from "./types";

const PLAN_STORAGE_KEY = "tideplan.meal-plan.v1";
const PREFERENCES_STORAGE_KEY = "tideplan.meal-preferences.v1";
const CHECKED_STORAGE_KEY = "tideplan.shopping-checked.v1";

const defaultPreferences: MealPreferences = {
  people: 2,
  dietaryPreference: "家常均衡",
  allergies: "无",
  budget: "适中",
  healthGoal: "营养均衡",
};

function loadStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function itemKey(category: string, name: string) {
  return `${category}\u0000${name}`;
}

interface MealPlannerProps {
  aiConfigured: boolean;
  onImportShoppingList: (plan: MealPlan) => number;
  onOpenAiSettings: () => void;
  onOpenShoppingList: () => void;
  onToast: (message: string) => void;
}

export default function MealPlanner({ aiConfigured, onImportShoppingList, onOpenAiSettings, onOpenShoppingList, onToast }: MealPlannerProps) {
  const [preferences, setPreferences] = useState<MealPreferences>(() =>
    loadStored(PREFERENCES_STORAGE_KEY, defaultPreferences),
  );
  const [plan, setPlan] = useState<MealPlan | null>(() => loadStored<MealPlan | null>(PLAN_STORAGE_KEY, null));
  const [checkedItems, setCheckedItems] = useState<string[]>(() => loadStored(CHECKED_STORAGE_KEY, []));
  const [selectedDay, setSelectedDay] = useState(0);
  const [formOpen, setFormOpen] = useState(() => !localStorage.getItem(PLAN_STORAGE_KEY));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    if (plan) localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan));
  }, [plan]);

  useEffect(() => {
    localStorage.setItem(CHECKED_STORAGE_KEY, JSON.stringify(checkedItems));
  }, [checkedItems]);

  const shoppingCount = useMemo(
    () => plan?.shoppingList.reduce((total, group) => total + group.items.length, 0) ?? 0,
    [plan],
  );

  async function generatePlan(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!aiConfigured) {
      setError("请先在偏好设置中配置 AI 服务。");
      return;
    }
    if (!isTauri()) {
      setError("AI 生成功能需要在潮汐计划桌面应用中运行。");
      return;
    }

    setLoading(true);
    try {
      const result = await invoke<MealPlan>("generate_meal_plan", {
        preferences,
      });
      setPlan(result);
      setCheckedItems([]);
      setSelectedDay(0);
      setFormOpen(false);
      onToast("一周食谱与采购清单已生成");
    } catch (reason) {
      setError(typeof reason === "string" ? reason : "生成失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  function toggleShoppingItem(key: string) {
    setCheckedItems((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  const day = plan?.days[selectedDay];
  const meals = day ? [
    { label: "早餐", time: "晨间", value: day.breakfast },
    { label: "午餐", time: "午间", value: day.lunch },
    { label: "晚餐", time: "晚间", value: day.dinner },
  ] : [];

  return (
    <section className="meal-planner" aria-label="AI 一周食谱">
      <form className={`meal-setup ${formOpen ? "is-open" : ""}`} onSubmit={generatePlan}>
        <button className="meal-setup-toggle" type="button" onClick={() => setFormOpen((value) => !value)} aria-expanded={formOpen}>
          <span className="meal-setup-icon"><Sparkles size={16} /></span>
          <span>
            <strong>{plan ? "调整生成条件" : "告诉 AI 你的用餐习惯"}</strong>
            <small>{preferences.people} 人 · {preferences.dietaryPreference} · {preferences.budget}预算</small>
          </span>
          {formOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </button>

        {formOpen && (
          <div className="meal-setup-body">
            <div className={`meal-ai-config ${aiConfigured ? "is-ready" : ""}`}>
              <span><KeyRound size={14} />{aiConfigured ? "AI 服务已配置" : "AI 服务尚未配置"}</span>
              <button className="secondary-button" type="button" onClick={onOpenAiSettings}>打开偏好设置</button>
            </div>

            <div className="meal-preferences-grid">
              <label className="meal-field people-field">
                <span>用餐人数</span>
                <input type="number" min={1} max={12} value={preferences.people} onChange={(event) => setPreferences({ ...preferences, people: Number(event.target.value) })} />
              </label>
              <label className="meal-field">
                <span>饮食偏好</span>
                <select value={preferences.dietaryPreference} onChange={(event) => setPreferences({ ...preferences, dietaryPreference: event.target.value })}>
                  <option>家常均衡</option>
                  <option>清淡少油</option>
                  <option>素食为主</option>
                  <option>高蛋白</option>
                  <option>低碳水</option>
                </select>
              </label>
              <label className="meal-field">
                <span>每周预算</span>
                <select value={preferences.budget} onChange={(event) => setPreferences({ ...preferences, budget: event.target.value })}>
                  <option>节省</option>
                  <option>适中</option>
                  <option>宽裕</option>
                </select>
              </label>
              <label className="meal-field">
                <span>营养目标</span>
                <select value={preferences.healthGoal} onChange={(event) => setPreferences({ ...preferences, healthGoal: event.target.value })}>
                  <option>营养均衡</option>
                  <option>控制体重</option>
                  <option>增肌补能</option>
                  <option>低盐护心</option>
                  <option>稳定血糖</option>
                </select>
              </label>
              <label className="meal-field allergy-field">
                <span>过敏或忌口</span>
                <input maxLength={120} value={preferences.allergies} onChange={(event) => setPreferences({ ...preferences, allergies: event.target.value })} placeholder="例如：花生、海鲜、不吃香菜" />
              </label>
            </div>

            <div className="meal-generate-row">
              {error ? <p className="meal-error" role="alert">{error}</p> : <span />}
              <button className="primary-button meal-generate-button" type="submit" disabled={loading || !aiConfigured}>
                {loading ? <LoaderCircle className="spin" size={16} /> : plan ? <RefreshCw size={16} /> : <Sparkles size={16} />}
                <span>{loading ? "正在安排一周三餐…" : plan ? "重新生成" : "生成一周食谱"}</span>
              </button>
            </div>
          </div>
        )}
      </form>

      {!plan && !formOpen && (
        <button className="meal-empty" type="button" onClick={() => setFormOpen(true)}>
          <span><ChefHat size={25} /></span>
          <strong>从一周三餐开始安排</strong>
          <small>设置人数、口味和预算，自动得到食谱与采购清单</small>
        </button>
      )}

      {plan && (
        <div className="meal-results">
          <div className="meal-result-heading">
            <div>
              <span>WEEKLY TABLE</span>
              <h2>{plan.planTitle}</h2>
              <p>{plan.weekSummary}</p>
            </div>
            <div className="meal-result-stat">
              <strong>21</strong>
              <span>顿饭 · {shoppingCount} 项食材</span>
            </div>
          </div>

          <div className="meal-day-tabs" role="tablist" aria-label="选择日期">
            {plan.days.map((item, index) => (
              <button
                className={selectedDay === index ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={selectedDay === index}
                onClick={() => setSelectedDay(index)}
                key={`${item.dayIndex}-${item.weekday}`}
              >
                <small>DAY {String(item.dayIndex).padStart(2, "0")}</small>
                <strong>{item.weekday}</strong>
              </button>
            ))}
          </div>

          <div className="meal-content-grid">
            <section className="daily-menu" aria-label={`${day?.weekday ?? ""}三餐`}>
              <header>
                <span><Utensils size={15} /> 当日三餐</span>
                <strong>{day?.weekday}</strong>
              </header>
              <div className="daily-meals">
                {meals.map((meal, index) => (
                  <article className={`meal-row meal-${index}`} key={meal.label}>
                    <div className="meal-time">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <small>{meal.time}</small>
                    </div>
                    <div>
                      <span>{meal.label}</span>
                      <h3>{meal.value.name}</h3>
                      <p>{meal.value.note}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="shopping-list" aria-label="采购清单">
              <header>
                <span><ShoppingBasket size={15} /> 本周采购</span>
                <div className="meal-shopping-actions">
                  <strong>{checkedItems.length} / {shoppingCount}</strong>
                  <button type="button" onClick={() => onImportShoppingList(plan)}><ListPlus size={14} />存入采购清单</button>
                  <button type="button" onClick={onOpenShoppingList} aria-label="查看采购清单" title="查看采购清单"><ArrowRight size={14} /></button>
                </div>
              </header>
              <div className="shopping-groups">
                {plan.shoppingList.map((group) => (
                  <section className="shopping-group" key={group.category}>
                    <h3>{group.category}</h3>
                    <div>
                      {group.items.map((item) => {
                        const key = itemKey(group.category, item.name);
                        const checked = checkedItems.includes(key);
                        return (
                          <label className={checked ? "is-checked" : ""} key={key}>
                            <input type="checkbox" checked={checked} onChange={() => toggleShoppingItem(key)} />
                            <span className="shopping-check" aria-hidden="true">{checked && <Check size={11} strokeWidth={3} />}</span>
                            <strong>{item.name}</strong>
                            <small>{item.amount}</small>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
