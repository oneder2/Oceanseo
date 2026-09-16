import type { TaskDraft } from "./types";
export const taskDraftKey = (id: string | null) =>
  `tideplan.draft.task:${id ?? "new"}`;
export const notebookDraftKey = (id: string) => `tideplan.draft.notebook:${id}`;
export function readTaskDraft(
  id: string | null,
  fallback: TaskDraft,
): TaskDraft {
  try {
    const v = JSON.parse(localStorage.getItem(taskDraftKey(id)) ?? "null");
    if (
      v &&
      ["title", "notes", "startDate", "dueDate"].every(
        (k) => typeof v[k] === "string",
      ) &&
      ["short", "mid", "long"].includes(v.horizon) &&
      ["normal", "important"].includes(v.priority)
    )
      return v;
  } catch {
    /* Keep corrupt draft on disk until an explicit edit. */
  }
  return fallback;
}
