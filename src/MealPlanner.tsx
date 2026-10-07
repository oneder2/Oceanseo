import { profileLocalStorage as localStorage } from "./profileStorage";
import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  ArrowRight,
  CalendarRange,
  Check,
  ChefHat,
  ChevronDown,
  ChevronUp,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShoppingBasket,
  Sparkles,
  Utensils,
} from "lucide-react";
import { mealShoppingItemKey } from "./shoppingStore";
import { APP_STATE_KEYS, persistAppState } from "./appDataStore";
import type { MealPlan, MealPreferences } from "./types";
import type { GoalSeed } from "./goals/model";

const PREFERENCES_STORAGE_KEY = APP_STATE_KEYS.mealPreferences;

const defaultPreferences: MealPreferences = {
  people: 2,
  dietaryPreference: "家常均衡",
  allergies: "无",
  budget: 500,
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

function loadPreferences(): MealPreferences {
  const stored = loadStored<Omit<Partial<MealPreferences>, "budget"> & { budget?: number | string }>(PREFERENCES_STORAGE_KEY, {});
  const legacyBudgets: Record<string, number> = { 节省: 300, 适中: 500, 宽裕: 800 };
  const budget = typeof stored.budget === "number"
    ? stored.budget
    : legacyBudgets[String(stored.budget)] ?? defaultPreferences.budget;
  return {
    people: typeof stored.people === "number" ? stored.people : defaultPreferences.people,
    dietaryPreference: typeof stored.dietaryPreference === "string" ? stored.dietaryPreference : defaultPreferences.dietaryPreference,
    allergies: typeof stored.allergies === "string" ? stored.allergies : defaultPreferences.allergies,
    budget,
    healthGoal: typeof stored.healthGoal === "string" ? stored.healthGoal : defaultPreferences.healthGoal,
  };
}

interface MealPlannerProps {
  seed?: GoalSeed;
  aiConfigured: boolean;
  plan: MealPlan | null;
  checkedItems: string[];
  onPlanGenerated: (plan: MealPlan) => void;
  onToggleShoppingItem: (key: string) => void;
  onOpenAiSettings: () => void;
  onOpenShoppingList: () => void;
  onToast: (message: string) => void;
  planningContext: string;
  planningItemCount: number;
}

export default function MealPlanner({ aiConfigured, plan, checkedItems, onPlanGenerated, onToggleShoppingItem, onOpenAiSettings, onOpenShoppingList, onToast, planningContext, planningItemCount, seed }: MealPlannerProps) {
  const [preferences, setPreferences] = useState<MealPreferences>(loadPreferences);
  const [selectedDay, setSelectedDay] = useState(0);
  const [formOpen, setFormOpen] = useState(() => !plan);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(()=>{if(seed){setFormOpen(true);const conditions=seed.conditions?.meals;if(conditions)setPreferences(p=>({...p,...Object.fromEntries(Object.entries(conditions).filter(([,v])=>v!==null))}));}},[seed?.id]);

  useEffect(() => {
    void persistAppState(PREFERENCES_STORAGE_KEY, preferences).catch(() => undefined);
  }, [preferences]);

  const shoppingCount = useMemo(
    () => plan?.shoppingList.reduce((total, group) => total + group.items.length, 0) ?? 0,
    [plan],
  );
  const checkedShoppingCount = useMemo(
    () => plan?.shoppingList.reduce(
      (total, group) => total + group.items.filter((item) => checkedItems.includes(mealShoppingItemKey(group.category, item.name))).length,
      0,
    ) ?? 0,
    [checkedItems, plan],
  );

  async function generatePlan(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!Number.isInteger(preferences.budget) || preferences.budget < 1 || preferences.budget > 1_000_000) {
      setError("每周预算需要填写 1 到 1000000 元之间的整数。");
      return;
    }
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
        preferences: { ...preferences, planningContext },
      });
      onPlanGenerated(result);
      setSelectedDay(0);
      setFormOpen(false);
      onToast("一周食谱与采购清单已生成");
    } catch (reason) {
      setError(typeof reason === "string" ? reason : "生成失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
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
            <small>{preferences.people} 人 · {preferences.dietaryPreference} · {preferences.budget} 元/周</small>
          </span>
          {formOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </button>

        {formOpen && (
          <div className="meal-setup-body">
            <div className={`meal-ai-config ${aiConfigured ? "is-ready" : ""}`}>
              <span><KeyRound size={14} />{aiConfigured ? "AI 服务已配置" : "AI 服务尚未配置"}</span>
              {planningItemCount > 0 && <span className="meal-context"><CalendarRange size={14} />已参考未来一周 {planningItemCount} 个安排</span>}
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
              <label className="meal-field budget-field">
                <span>每周预算</span>
                <span className="meal-number-input">
                  <input type="number" min={1} max={1000000} step={10} value={preferences.budget} onChange={(event) => setPreferences({ ...preferences, budget: Number(event.target.value) })} aria-label="每周预算金额" />
                  <em>元</em>
                </span>
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
              <button className="primary-button meal-generate-button" type="submit" disabled={loading || !aiConfigured || preferences.budget < 1 || preferences.budget > 1_000_000}>
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
                  <strong>{checkedShoppingCount} / {shoppingCount}</strong>
                  <span className="meal-shopping-sync"><Sparkles size={12} />自动同步</span>
                  <button type="button" onClick={onOpenShoppingList} aria-label="查看采购清单" title="查看采购清单"><ArrowRight size={14} /></button>
                </div>
              </header>
              <div className="shopping-groups">
                {plan.shoppingList.map((group) => (
                  <section className="shopping-group" key={group.category}>
                    <h3>{group.category}</h3>
                    <div>
                      {group.items.map((item) => {
                        const key = mealShoppingItemKey(group.category, item.name);
                        const checked = checkedItems.includes(key);
                        return (
                          <label className={checked ? "is-checked" : ""} key={key}>
                            <input type="checkbox" checked={checked} onChange={() => onToggleShoppingItem(key)} />
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
