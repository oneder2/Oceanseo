export type Horizon = "short" | "mid" | "long";
export type Priority = "normal" | "important";
export type View = "today" | "all" | "calendar" | "meal-planner" | "work-monitor" | "completed";

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

export interface MealPreferences {
  people: number;
  dietaryPreference: string;
  allergies: string;
  budget: string;
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
