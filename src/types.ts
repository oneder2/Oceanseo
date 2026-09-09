export type Horizon = "short" | "mid" | "long";
export type Priority = "normal" | "important";
export type View = "today" | "all" | "calendar" | "countdowns" | "meal-planner" | "shopping-list" | "work-monitor" | "completed";

export interface TaskOrigin {
  kind: "local" | "migration" | "deep_link";
  label: string | null;
  reference: string | null;
}

export interface Task {
  schemaVersion: "1.0.0";
  id: string;
  title: string;
  notes: string;
  horizon: Horizon;
  priority: Priority;
  startDate: string;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  origin: TaskOrigin | null;
}

export interface TaskDraft {
  title: string;
  notes: string;
  horizon: Horizon;
  priority: Priority;
  startDate: string;
  dueDate: string;
}

export interface ReminderSettings {
  enabled: boolean;
  times: [string, string];
}

export interface Countdown {
  id: string;
  title: string;
  targetDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CountdownDraft {
  title: string;
  targetDate: string;
  notes: string;
}

export interface MealPreferences {
  people: number;
  dietaryPreference: string;
  allergies: string;
  budget: number;
  healthGoal: string;
}

export interface Meal {
  name: string;
  note: string;
}

export interface MealDay {
  dayIndex: number;
  weekday: string;
  breakfast: Meal;
  lunch: Meal;
  dinner: Meal;
}

export interface ShoppingItem {
  name: string;
  amount: string;
}

export interface ShoppingCategory {
  category: string;
  items: ShoppingItem[];
}

export interface MealPlan {
  planTitle: string;
  weekSummary: string;
  days: MealDay[];
  shoppingList: ShoppingCategory[];
}

export type PurchaseSource = "manual" | "ai-recipe";

export interface PurchaseItem {
  id: string;
  name: string;
  amount: string;
  category: string;
  checked: boolean;
  source: PurchaseSource;
  sourceLabel: string | null;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseItemDraft {
  name: string;
  amount: string;
  category: string;
}

export type ShoppingExportFormat = "markdown" | "csv";
