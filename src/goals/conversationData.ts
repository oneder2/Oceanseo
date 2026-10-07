export interface DialogueMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
}
export interface Understanding {
  id: string;
  parentId: string;
  label: string;
  status: "clear" | "assumed" | "unknown";
  evidence: string;
}
export interface Waiting {
  key: string;
  reason: string;
}
export interface Receipt {
  id: string;
  key: string;
  title: string;
  description: string;
  taskId: string;
  goalId: string;
  createdAt: string;
}
export interface Conversation {
  messages: DialogueMessage[];
  understanding: Understanding[];
  proposalId: string;
  receipts: Receipt[];
  needsReply: boolean;
}
const obj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, n: number) => typeof v === "string" && v.length <= n;
const id = (v: unknown) => typeof v === "string" && /^[\w:-]{1,80}$/.test(v);
const optionalId = (v: unknown) => v === "" || id(v);
const list = (v: unknown, n: number, check: (v: any) => boolean): v is any[] =>
  Array.isArray(v) && v.length <= n && v.every(check);
const unique = (v: { id: string }[]) =>
  new Set(v.map((x) => x.id)).size === v.length;
export function validUnderstanding(v: unknown): v is Understanding[] {
  if (
    !list(
      v,
      80,
      (n) =>
        obj(n) &&
        id(n.id) &&
        optionalId(n.parentId) &&
        str(n.label, 500) &&
        n.label.trim() &&
        ["clear", "assumed", "unknown"].includes(n.status) &&
        str(n.evidence, 1000),
    ) ||
    !unique(v)
  )
    return false;
  const map = new Map(v.map((n) => [n.id, n.parentId]));
  return v.every((n) => {
    const seen = new Set<string>();
    let p = n.id;
    while (p) {
      if (seen.has(p) || !map.has(p)) return false;
      seen.add(p);
      p = map.get(p)!;
    }
    return true;
  });
}
export function validWaiting(v: unknown): v is Waiting[] {
  return (
    list(
      v,
      200,
      (w) =>
        obj(w) &&
        typeof w.key === "string" &&
        /^(g|a):[\w:-]{1,80}$/.test(w.key) &&
        str(w.reason, 1000) &&
        !!w.reason.trim(),
    ) && new Set(v.map((w) => w.key)).size === v.length
  );
}
export function validConversation(v: unknown): v is Conversation {
  return (
    obj(v) &&
    optionalId(v.proposalId) &&
    typeof v.needsReply === "boolean" &&
    list(
      v.messages,
      160,
      (m) =>
        obj(m) &&
        id(m.id) &&
        ["user", "assistant", "system"].includes(m.role) &&
        str(m.text, 12000) &&
        str(m.createdAt, 40) &&
        Number.isFinite(Date.parse(m.createdAt)),
    ) &&
    unique(v.messages) &&
    validUnderstanding(v.understanding) &&
    list(
      v.receipts,
      1000,
      (r) =>
        obj(r) &&
        id(r.id) &&
        str(r.key, 84) &&
        str(r.title, 200) &&
        str(r.description, 4000) &&
        optionalId(r.taskId) &&
        optionalId(r.goalId) &&
        str(r.createdAt, 40),
    ) &&
    unique(v.receipts)
  );
}
export const emptyConversation = (): Conversation => ({
  messages: [],
  understanding: [],
  proposalId: "",
  receipts: [],
  needsReply: false,
});
export const dialogueMessage = (
  role: DialogueMessage["role"],
  text: string,
): DialogueMessage => ({
  id: crypto.randomUUID(),
  role,
  text,
  createdAt: new Date().toISOString(),
});
export const addMessage = (
  c: Conversation,
  role: DialogueMessage["role"],
  text: string,
): Conversation => ({
  ...c,
  messages: [...c.messages.slice(-159), dialogueMessage(role, text)],
});
