import { isPattern, type BeadPattern } from "./model";

export interface Change {
  label: string;
  before: BeadPattern;
  after: BeadPattern;
}
export interface Proposal {
  label: string;
  message: string;
  after: BeadPattern;
}
export interface DocumentState {
  present: BeadPattern;
  past: Change[];
  future: Change[];
  proposal: Proposal | null;
}
export type DocumentAction =
  | { type: "commit"; label: string; after: BeadPattern }
  | { type: "propose"; proposal: Proposal }
  | { type: "apply" | "discard" | "undo" | "redo" };
export const HISTORY_LIMIT = 20;
export function samePattern(a: BeadPattern, b: BeadPattern) {
  return (
    a === b ||
    (a.title === b.title &&
      a.width === b.width &&
      a.height === b.height &&
      (a.beadPitchMm ?? 5) === (b.beadPitchMm ?? 5) &&
      a.palette.length === b.palette.length &&
      a.palette.every(
        (c, i) => c.hex === b.palette[i].hex && c.name === b.palette[i].name,
      ) &&
      a.cells.length === b.cells.length &&
      a.cells.every((c, i) => c === b.cells[i]))
  );
}
export function createDocument(present: BeadPattern): DocumentState {
  return { present, past: [], future: [], proposal: null };
}
function commit(
  state: DocumentState,
  label: string,
  after: BeadPattern,
): DocumentState {
  if (!isPattern(after) || samePattern(state.present, after)) return state;
  return {
    present: after,
    past: [
      ...state.past.slice(-(HISTORY_LIMIT - 1)),
      { label, before: state.present, after },
    ],
    future: [],
    proposal: null,
  };
}
/** Only confirmed transactions alter the document. View state never enters history. */
export function documentReducer(
  state: DocumentState,
  action: DocumentAction,
): DocumentState {
  if (action.type === "discard") return { ...state, proposal: null };
  if (action.type === "apply") {
    if (!state.proposal) return state;
    return commit(
      { ...state, proposal: null },
      state.proposal.label,
      state.proposal.after,
    );
  }
  // A preview freezes its baseline. Underlying edits and undo cannot invalidate it.
  if (state.proposal) return state;
  if (action.type === "commit")
    return commit(state, action.label, action.after);
  if (action.type === "propose") {
    if (
      !isPattern(action.proposal.after) ||
      samePattern(state.present, action.proposal.after)
    )
      return state;
    return { ...state, proposal: action.proposal };
  }
  if (action.type === "undo") {
    const change = state.past.at(-1);
    return change
      ? {
          ...state,
          present: change.before,
          past: state.past.slice(0, -1),
          future: [...state.future, change],
        }
      : state;
  }
  const change = state.future.at(-1);
  return change
    ? {
        ...state,
        present: change.after,
        past: [...state.past, change],
        future: state.future.slice(0, -1),
      }
    : state;
}
