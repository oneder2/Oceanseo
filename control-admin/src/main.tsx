import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { moduleCatalog, type ModuleId } from "../../src/modules/catalog";
import hedgehog from "../../public/brand/hedgehog.png";
import "./styles.css";

const actions = ["visible", "read", "write", "ai"] as const;
type Action = typeof actions[number];
type Rules = Partial<Record<ModuleId, Partial<Record<Action, boolean>>>>;
type Policy = { scope: string; subject: string; edition: string; revision: number; rules: Rules };
type User = { id: string; username: string; disabled: boolean; cohorts: string[] };
type Space = { id: string; name: string; edition: string; vaultId: string };
type Overview = { environment: string; role: string; modules: ModuleId[]; policies: Policy[]; health: { ok: boolean }; metrics: { aiCost: number | null; activation: number | null }; audit: { event: string; created_at: number }[] };
const actionNames: Record<Action, string> = { visible: "入口可见", read: "读取", write: "新增与编辑", ai: "AI 调用" };
const scopeNames: Record<string, string> = { edition: "发行默认", cohort: "内测群组", user: "单个用户" };
const modules = Object.keys(moduleCatalog) as ModuleId[];
// Invitation fragments are never sent to the server or retained in the address
// bar. Keep the setup value in page memory while the user chooses a password.
function consumeInvitation() {
  const fields = new URLSearchParams(location.hash.slice(1));
  const invite = fields.get("invite") ?? "";
  const username = fields.get("username") ?? "";
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  return /^[A-Za-z0-9_-]{43}$/.test(invite) && /^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username) ? { invite, username } : null;
}
const initialInvitation = consumeInvitation();

function App() {
  const token = useRef("");
  const sessionId = useRef("");
  const [signedIn, setSignedIn] = useState(false);
  const [username, setUsername] = useState(initialInvitation?.username ?? "");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [signup, setSignup] = useState(!!initialInvitation);
  const [invite, setInvite] = useState(initialInvitation?.invite ?? "");
  const [invitedUsername, setInvitedUsername] = useState(initialInvitation?.username ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [edition, setEdition] = useState("personal");
  const [scope, setScope] = useState("edition");
  const [subjectInput, setSubjectInput] = useState("beta");
  const [userId, setUserId] = useState("");
  const [draft, setDraft] = useState<Rules>({});
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [confirmation, setConfirmation] = useState<"publish" | "restore" | null>(null);
  const [restoreRevision, setRestoreRevision] = useState(1);
  const [cohortId, setCohortId] = useState("beta");
  const [spaceCaps, setSpaceCaps] = useState<{ edition: string; environment: string; modules: Record<ModuleId, Record<Action, boolean>> } | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const subject = scope === "edition" ? edition : scope === "user" ? userId : subjectInput.trim();

  useEffect(() => {
    const accept = () => {
      if (signedIn || busy) return;
      const invitation = consumeInvitation();
      if (!invitation) return;
      setUsername(invitation.username); setInvitedUsername(invitation.username);
      setInvite(invitation.invite); setSignup(true); setPassword(""); setRepeatPassword(""); setError("");
    };
    accept();
    window.addEventListener("hashchange", accept);
    return () => window.removeEventListener("hashchange", accept);
  }, [signedIn, busy]);

  async function api<T>(route: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(`/v2${route}`, {
      method, credentials: "omit", cache: "no-store", redirect: "error",
      headers: { ...(token.current ? { Authorization: `Bearer ${token.current}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      if (response.status === 401) {
        token.current = ""; sessionId.current = ""; setSignedIn(false); setOverview(null); setUsers([]); setSpaces([]); setSpaceCaps(null); setConfirmation(null); setDraft({}); setDirty(false);
      }
      throw Error(response.status === 401 ? "登录已过期或账号密码不正确，请重新登录。" : response.status === 403 ? "当前账号没有这项管理权限。" : response.status === 409 ? "策略已被更新。当前调整已保留，请刷新后重新核对。" : response.status === 400 ? route === "/register" ? "注册未完成，请检查邀请码是否有效、账号是否对应邀请，以及密码长度。若已完成注册，请返回登录。" : "参数不符合要求，请检查权限依赖、目标或版本。" : "服务暂时不可用，请重试。原策略未被本页替换。");
    }
    return response.json() as Promise<T>;
  }
  async function refresh() {
    const [next, list, workspaces] = await Promise.all([api<Overview>("/admin/overview"), api<{ users: User[]; truncated: boolean }>("/admin/users"), api<{ workspaces: Space[] }>("/workspaces")]);
    if (next.environment !== "preview") throw Error("服务环境与测试管理页不一致，已停止加载。请联系维护者。");
    setOverview(next); setUsers(list.users); setSpaces(workspaces.workspaces);
    if (list.truncated) setMessage("用户列表仅显示前 500 个账号。更多用户筛选尚未接入。");
  }
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "连接中断，请重试。"); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (dirty) return;
    const current = overview?.policies.find(p => p.scope === scope && p.subject === subject && p.edition === edition);
    setDraft(current ? structuredClone(current.rules) : {}); setRevision(current?.revision ?? 0); setConfirmation(null); setSpaceCaps(null);
  }, [overview, edition, scope, subject, dirty]);
  useEffect(() => { if (confirmation) { confirmRef.current?.scrollIntoView({ block: "nearest" }); confirmRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); } }, [confirmation]);

  function change(module: ModuleId, key: Action, value: string) {
    const next = structuredClone(draft);
    const entry = { ...next[module] };
    if (value === "inherit") delete entry[key]; else entry[key] = value === "allow";
    if (Object.keys(entry).length) next[module] = entry; else delete next[module];
    setDraft(next); setDirty(true); setConfirmation(null);
  }
  async function publish() {
    const receipt = await api<Policy>(confirmation === "restore" ? "/admin/module-policies/restore" : "/admin/module-policies", "POST", {
      scope, subject, edition, expectedRevision: revision, ...(confirmation === "restore" ? { restoreRevision } : { rules: draft }),
    });
    setConfirmation(null); setDirty(false); setRevision(receipt.revision); setDraft(receipt.rules);
    setMessage(`已发布修订 ${receipt.revision}。用户下次权限检查使用新策略。`);
    await refresh();
  }

  return <main>
    <header className="brand"><img src={hedgehog} width="40" height="40" alt=""/><div><span>Oceanseo</span><small>管理中心</small></div><span className="environment">独立测试环境</span></header>
    {!signedIn ? <section className="login-panel"><p className="eyebrow">模块开放与测试</p><h1>{signup ? "设置你的管理账号" : "先确认你的管理身份"}</h1><p>{signup ? "为邀请对应的测试账号设置密码。测试资料与正式账号独立，管理权限由服务器核对邀请后授予。" : "使用测试环境账号登录。角色由维护者在服务器授予；普通账号无法进入管理中心。"}</p>
      <form onSubmit={e => { e.preventDefault(); void action(async () => {
        if (signup && password !== repeatPassword) throw Error("两次密码不一致，请重新核对。");
        const reply = await api<{ token: string; session: { id: string } }>(signup ? "/register" : "/login", "POST", { username, password, deviceName: "测试管理网页", platform: "test", ...(signup ? { invite } : {}) });
        setSignup(false); setInvite(""); setRepeatPassword("");
        token.current = reply.token; sessionId.current = reply.session.id; setPassword("");
        try { await refresh(); setSignedIn(true); }
        catch (e) { try { await api(`/sessions/${sessionId.current}`, "DELETE"); } finally { token.current = ""; sessionId.current = ""; setSignedIn(false); } throw e; }
      }).finally(() => { setPassword(""); setRepeatPassword(""); }); }}>
        <label>账号<input autoComplete="username" required minLength={3} maxLength={64} readOnly={signup && !!invitedUsername} value={username} disabled={busy} onChange={e => setUsername(e.target.value)}/></label>
        <label>密码<input type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={12} maxLength={128} value={password} disabled={busy} onChange={e => setPassword(e.target.value)}/></label>
        {signup && <label>再次输入密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={repeatPassword} disabled={busy} onChange={e => setRepeatPassword(e.target.value)}/></label>}
        {signup && !invitedUsername && <label>一次性邀请码<input type="password" autoComplete="off" required minLength={43} maxLength={43} value={invite} disabled={busy} onChange={e => setInvite(e.target.value)}/></label>}
        <button className="primary" disabled={busy}>{busy ? "正在验证…" : signup ? "设置密码并进入管理中心" : "登录管理中心"}</button>
      </form><button disabled={busy} onClick={() => { setSignup(!signup); setInvitedUsername(""); setInvite(""); setPassword(""); setRepeatPassword(""); setError(""); }}>{signup ? "已有账号，返回登录" : "使用管理员邀请创建账号"}</button><small>登录凭据只保留在本页内存。刷新或关闭页面后需要重新登录。</small>
    </section> : <>
      <div className="page-head"><div><p className="eyebrow">{overview?.role === "owner" ? "管理员" : "运营人员"} · {username}</p><h1>模块开放与测试</h1><p>调整发行范围，预览自己的测试空间。个人资料与客户内容不在此页面展示。</p></div><button disabled={busy} onClick={() => void action(async () => { try { await api(`/sessions/${sessionId.current}`, "DELETE"); } finally { token.current = ""; sessionId.current = ""; setSignedIn(false); setOverview(null); setUsers([]); setSpaces([]); setSpaceCaps(null); setConfirmation(null); setDraft({}); setDirty(false); } })}>退出管理中心</button></div>
      <section className="policy-panel"><div className="section-head"><div><h2>模块开放矩阵</h2><p>继承沿用默认；明确限制优先于其它允许。商业发行不能通过授权扩展未发布模块。</p></div><span className="revision">修订 {revision}{dirty ? " · 有未发布调整" : ""}</span></div>
        <div className="selectors">
          <label>发行组合<select value={edition} disabled={busy || dirty} onChange={e => setEdition(e.target.value)}><option value="personal">个人完整版</option></select></label>
          <label>应用范围<select value={scope} disabled={busy || dirty} onChange={e => setScope(e.target.value)}><option value="edition">发行默认</option><option value="cohort">内测群组</option><option value="user">单个用户</option></select></label>
          {scope === "cohort" && <label>群组名称<input maxLength={40} pattern="[A-Za-z0-9_-]+" value={subjectInput} disabled={busy || dirty} onChange={e => setSubjectInput(e.target.value)}/></label>}
          {scope === "user" && <label>目标用户<select value={userId} disabled={busy || dirty} onChange={e => setUserId(e.target.value)}><option value="">选择用户</option>{users.filter(u => !u.disabled).map(u => <option key={u.id} value={u.id}>{u.username}</option>)}</select></label>}
        </div>
        <p className="matrix-hint">手机上可左右滑动矩阵，查看全部权限。</p>
        <div className="matrix-scroll" tabIndex={0} aria-label="模块权限矩阵，可横向滚动"><table><thead><tr><th scope="col">模块</th>{actions.map(a => <th key={a} scope="col">{actionNames[a]}</th>)}</tr></thead><tbody>{modules.map(module => <tr key={module}><th scope="row">{moduleCatalog[module].title}</th>{actions.map(a => <td key={a}><select aria-label={`${moduleCatalog[module].title} ${actionNames[a]}`} value={draft[module]?.[a] === undefined ? "inherit" : draft[module]?.[a] ? "allow" : "deny"} disabled={busy} onChange={e => change(module, a, e.target.value)}><option value="inherit">继承</option><option value="allow">允许</option><option value="deny">限制</option></select></td>)}</tr>)}</tbody></table></div>
        <div className="policy-actions"><button disabled={busy} onClick={() => void action(async () => { setDirty(false); setConfirmation(null); await refresh(); })}>{dirty ? "放弃未发布调整并刷新" : "刷新策略"}</button><button className="primary" disabled={busy || !dirty || !subject} onClick={() => setConfirmation("publish")}>预览并发布</button></div>
        {revision > 1 && <div className="restore"><label>恢复历史修订<input type="number" min={1} max={revision - 1} value={restoreRevision} disabled={busy} onChange={e => setRestoreRevision(Number(e.target.value))}/></label><button disabled={busy || dirty || restoreRevision < 1 || restoreRevision >= revision} onClick={() => setConfirmation("restore")}>预览恢复</button><small>恢复会生成新修订，保留发布历史。</small></div>}
        {confirmation && <div className="confirmation" ref={confirmRef} role="region" aria-label="发布确认"><h3>{confirmation === "restore" ? `恢复修订 ${restoreRevision}` : "确认这次开放调整"}</h3><p>影响：{scopeNames[scope]} · {scope === "user" ? users.find(u => u.id === subject)?.username ?? subject : subject} · {edition === "personal" ? "个人完整版" : "商业拼豆版"}。以修订 {revision} 为基线。</p>{confirmation === "publish" && <ul>{Object.entries(draft).map(([module, rules]) => <li key={module}>{moduleCatalog[module as ModuleId].title}：{Object.entries(rules).map(([a, allowed]) => `${actionNames[a as Action]}${allowed ? "允许" : "限制"}`).join("，")}</li>)}{!Object.keys(draft).length && <li>清除本范围限制，重新继承其它适用策略。</li>}</ul>}<p>用户存量数据保留。受限功能停止新的对应操作，服务端每次提交重新检查。</p><div className="policy-actions"><button disabled={busy} onClick={() => setConfirmation(null)}>取消发布</button><button className="primary" disabled={busy} onClick={() => void action(publish)}>确认发布</button></div></div>}
      </section>
      <div className="support-grid"><section><h2>我的测试空间</h2><p>这里只列你的空间。预览显示实际生效权限，不读取图纸或生活记录。</p><div className="policy-actions">{["personal"].map(e => <button key={e} disabled={busy} onClick={() => void action(async () => { await api("/workspaces", "POST", { edition: e, name: "个人测试空间" }); await refresh(); })}>{"准备个人测试空间"}</button>)}</div>{spaces.map(w => <button className="space" key={w.id} disabled={busy} onClick={() => void action(async () => setSpaceCaps(await api(`/workspaces/${w.id}/capabilities`)))}><strong>{w.name}</strong><span>查看生效权限 →</span></button>)}{spaceCaps && <div className="effective"><strong>{"个人完整版"} · {spaceCaps.environment}</strong>{modules.filter(m => spaceCaps.modules[m].visible).map(m => <p key={m}>{moduleCatalog[m].title} · {spaceCaps.modules[m].write ? "可编辑" : "只读"} · AI {spaceCaps.modules[m].ai ? "允许" : "限制"}</p>)}{!modules.some(m => spaceCaps.modules[m].visible) && <p>没有可见模块。自己的存量数据仍可导出。</p>}</div>}</section>
      <section><h2>服务与记录</h2><dl><div><dt>权限服务</dt><dd>{overview?.health.ok ? "正常" : "不可用"}</dd></div><div><dt>环境</dt><dd>{overview?.environment}</dd></div><div><dt>AI 费用</dt><dd>{overview?.metrics.aiCost == null ? "未接入" : overview.metrics.aiCost}</dd></div><div><dt>产品使用汇总</dt><dd>{overview?.metrics.activation == null ? "未接入" : overview.metrics.activation}</dd></div></dl><h3>最近管理记录</h3>{overview?.audit.slice(0, 6).map((a, i) => <p className="audit" key={i}>{({ "policy:publish": "发布模块策略", "policy:restore": "恢复历史策略", "role:owner": "授予管理员", "owner:bootstrap": "管理员邀请已确认", "role:operator": "授予运营权限", "role:member": "撤销管理权限", "cohort:add": "加入内测群组", "cohort:remove": "移出内测群组" } as Record<string, string>)[a.event] ?? "管理操作"}<time>{new Date(a.created_at * 1000).toLocaleString("zh-CN")}</time></p>)}</section></div>
      {overview?.role === "owner" && <section><h2>内测群组成员</h2><p>群组成员变更同样经过服务器授权和审计。</p><div className="selectors"><label>用户<select value={userId} disabled={busy || dirty} onChange={e => setUserId(e.target.value)}><option value="">选择用户</option>{users.filter(u => !u.disabled).map(u => <option key={u.id} value={u.id}>{u.username} · {u.cohorts.join("、") || "未加入群组"}</option>)}</select></label><label>群组<input value={cohortId} maxLength={40} disabled={busy} onChange={e => setCohortId(e.target.value)}/></label>{[true, false].map(member => <button key={String(member)} disabled={busy || !userId || !cohortId || dirty} onClick={() => void action(async () => { await api("/admin/cohorts", "POST", { userId, cohortId, member }); await refresh(); setMessage(member ? "已加入群组。" : "已移出群组。"); })}>{member ? "加入群组" : "移出群组"}</button>)}</div></section>}
    </>}
    {error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    <footer>Oceanseo · 控制面与业务资料分开管理。此页面不会显示客户照片、图纸或聊天。</footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App/></StrictMode>);
