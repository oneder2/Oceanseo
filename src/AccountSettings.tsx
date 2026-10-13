import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ArrowRightLeft, Check, Eye, EyeOff, KeyRound, LogIn, LogOut, Monitor, RefreshCw, ShieldCheck, Smartphone, Trash2, UserRound, X } from "lucide-react";
import { accountSessions, accountWorkspaces, changeAccountPassword, deleteAccount, localProfiles, logoutAccount, profileStatus, restartSelectedProfile, revokeAccountSession, signInAccount, switchProfile, switchWorkspace, type DeviceSession, type LocalProfile, type ProfileStatus, type WorkspaceList, type WorkspaceSummary } from "./accountStore";
import { platform } from "./platform";
import { defaultAccountEndpoint } from "./modules/edition";
import { refreshCapabilities } from "./modules/capabilities";
import "./account.css";

type Confirmation = { kind: "profile"; profile: LocalProfile } | { kind: "workspace"; workspace: WorkspaceSummary; environment: "preview" | "live" } | { kind: "device"; session: DeviceSession } | { kind: "others" } | { kind: "logout"; localOnly: boolean };
const label = (profile: LocalProfile) => {
  if (!profile.username) return "本机资料库";
  const space = profile.workspace;
  return space ? `${profile.username} · 个人空间 · ${space.environment === "preview" ? "测试" : "正式"}` : profile.username;
};
const date = (seconds: number) => new Date(seconds * 1000).toLocaleString("zh-CN");

export default function AccountSettings({ onBusy, onChange }: {
  onBusy: (busy: boolean) => void;
  onChange: (profile: LocalProfile) => void;
}) {
  const [status, setStatus] = useState<ProfileStatus | null>(null);
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [spaces, setSpaces] = useState<WorkspaceList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [register, setRegister] = useState(false);
  const [endpoint, setEndpoint] = useState(defaultAccountEndpoint);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [deviceName, setDeviceName] = useState(platform.mobile ? "我的手机" : "我的电脑");
  const [showPassword, setShowPassword] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [failedLogout, setFailedLogout] = useState(false);
  const confirmationRef = useRef<HTMLDivElement>(null);

  const current = status?.current;
  const account = !!current && current.key !== "local";
  useEffect(() => {
    if (!confirmation) return;
    confirmationRef.current?.scrollIntoView({ block: "nearest" });
    confirmationRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [confirmation]);
  async function refresh() {
    const [next, list] = await Promise.all([profileStatus(), localProfiles()]);
    setStatus(next); setProfiles(list); onChange(next.current);
    await refreshCapabilities().catch(() => undefined);
    return next;
  }
  useEffect(() => {
    let active = true;
    void Promise.all([profileStatus(), localProfiles()]).then(([next, list]) => {
      if (!active) return;
      setStatus(next); setProfiles(list); onChange(next.current);
      if (next.current.endpoint) setEndpoint(next.current.endpoint);
      if (next.current.username) setUsername(next.current.username);
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [onChange]);

  async function action(fn: () => Promise<void>, keepBusy = false) {
    if (busy) return;
    setBusy(true); onBusy(true); setError(""); setMessage("");
    let success = false;
    try { await fn(); success = true; }
    catch (e) { setError(String(e).replace(/^Error: /, "")); }
    finally { if (!keepBusy || !success) { setBusy(false); onBusy(false); } }
  }
  async function loadSessions() {
    const list = await accountSessions();
    setSessions(list.sessions);
  }
  async function confirm() {
    if (!confirmation || !current) return;
    const target = confirmation;
    setConfirmation(null);
    await action(async () => {
      if (target.kind === "profile") {
        try { await switchProfile(target.profile.key, current.key); }
        catch (e) { await refresh(); throw e; }
      } else if (target.kind === "workspace") {
        try { await switchWorkspace(target.workspace.id, current.key); }
        catch (e) { await refresh(); throw e; }
      } else if (target.kind === "logout") {
        try {
          await logoutAccount(target.localOnly);
          setFailedLogout(false); setSessions(null); await refresh();
          setMessage(target.localOnly ? "已移除本机登录。服务端会话未确认撤销；本机资料保留。" : "已退出当前设备，本机资料仍可离线使用。");
        } catch (e) { setFailedLogout(true); throw e; }
      } else {
        await revokeAccountSession(target.kind === "others" ? "others" : target.session.id);
        await loadSessions();
        setMessage("设备会话已撤销。");
      }
    }, target.kind === "profile" || target.kind === "workspace");
  }

  return <section className="account-settings" aria-label="账号与资料库" aria-busy={busy}>
    <header className="account-heading"><UserRound size={21} /><div><strong>账号与资料库</strong><p>{current ? label(current) : isTauri() ? "正在读取当前资料库…" : "本机预览"}</p></div>
      <span className={`account-state ${current?.signedIn ? "is-ready" : ""}`}>{current?.signedIn ? "已登录" : account ? "离线使用" : "本机"}</span>
    </header>
    {profiles.length > 1 && <label className="account-profile-picker"><span><ArrowRightLeft size={16} />切换资料库</span>
      <select aria-label="切换资料库" value={current?.key ?? "local"} disabled={busy || status?.restartRequired} onChange={e => {
        const target = profiles.find(p => p.key === e.target.value);
        if (target && target.key !== current?.key) setConfirmation({ kind: "profile", profile: target });
      }}>{profiles.map(p => <option key={p.key} value={p.key}>{label(p)}{p.active ? " · 当前" : ""}</option>)}</select>
    </label>}
    {status?.restartRequired && <div className="account-confirm" role="alert">
      <strong>待打开：{label(profiles.find(p => p.key === status.selectedKey) ?? status.current)}</strong>
      <p>当前仍是 {label(status.current)}。重新打开应用后才会切换资料库。</p>
      <div className="account-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void action(async () => { await restartSelectedProfile(status.selectedKey); }, true)}><RefreshCw size={15} />重新打开应用</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void action(async () => { await invoke("select_local_profile", { key: status.current.key, expectedCurrent: status.current.key }); await refresh(); })}><X size={15} />取消待切换</button></div>
    </div>}
    {confirmation && <div className="account-confirm" role="alert" ref={confirmationRef}>
      <strong>{confirmation.kind === "profile" ? `切换至 ${label(confirmation.profile)}？` : confirmation.kind === "workspace" ? `打开${confirmation.environment === "preview" ? "测试" : "正式"}空间「${confirmation.workspace.name}」？` : confirmation.kind === "logout" ? confirmation.localOnly ? "仅移除本机登录？" : "退出当前设备？" : confirmation.kind === "others" ? "撤销其他所有设备？" : `撤销 ${confirmation.session.deviceName}？`}</strong>
      <p>{confirmation.kind === "profile" || confirmation.kind === "workspace" ? "当前资料和草稿留在原资料库，不会自动导入目标空间。应用将保存并重新打开。" : confirmation.kind === "logout" ? confirmation.localOnly ? "不会删除本机资料，但无法确认服务端会话已撤销。可在另一台已登录设备中撤销此会话。" : "本机资料保留，云端同步会停止。" : "被撤销的设备无法继续同步，重新登录后才能连接；本机资料不会删除。"}</p>
      <div className="account-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmation(null)}><X size={15} />取消</button><button type="button" className="primary-button" disabled={busy} onClick={() => void confirm()}><Check size={15} />{confirmation.kind === "profile" || confirmation.kind === "workspace" ? "保存并切换" : confirmation.kind === "logout" ? "确认退出" : "确认撤销"}</button></div>
    </div>}
    <details className="account-auth" open={!current?.signedIn}>
      <summary>{current?.signedIn ? "登录另一个账号" : account ? "重新登录" : "登录或创建账号"}</summary>
      <div className="account-modes" role="group" aria-label="账号操作">
        <button type="button" aria-pressed={!register} disabled={busy} onClick={() => { setRegister(false); setInvite(""); setPassword(""); }}>登录</button>
        <button type="button" aria-pressed={register} disabled={busy} onClick={() => { setRegister(true); setPassword(""); }}>邀请码注册</button>
      </div>
      <details className="account-data-notice"><summary>账号数据与隐私</summary>
        <p>登录并打开账号后，已保存的任务、笔记、目标和对话会自动同步。原本机资料不会自动导入；生活模块、未提交草稿和服务密钥暂不上传。</p>
        <p>云端资料通过 HTTPS 传输，但不是端到端加密，服务器维护者可以访问。退出登录不会删除记录。删除账号会删除云端资料库和所有设备会话，本机资料会保留为离线副本。</p>
      </details>
      <form className="account-form" onSubmit={e => { e.preventDefault(); void action(async () => {
        const next = await signInAccount({ endpoint, username, password, deviceName, invite: register ? invite : null });
        setPassword(""); setInvite(""); setShowPassword(false); setSessions(null);
        const refreshed = await refresh();
        if (!isTauri()) { window.location.reload(); return; }
        if (next.key !== refreshed.current.key) setConfirmation({ kind: "profile", profile: next });
        else setMessage("登录成功，记录会自动同步。");
      }); }}>
        <label><span>用户名</span><input aria-label="账号用户名" required minLength={3} maxLength={64} autoComplete="username" autoCapitalize="none" spellCheck={false} pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{2,63}" value={username} onChange={e => setUsername(e.target.value)} disabled={busy} /></label>
        <label><span>密码</span><span className="account-password"><input aria-label="账号密码" required minLength={12} maxLength={128} type={showPassword ? "text" : "password"} autoComplete={register ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
          <button type="button" className="icon-button" aria-label={showPassword ? "隐藏账号密码" : "显示账号密码"} title={showPassword ? "隐藏账号密码" : "显示账号密码"} disabled={busy} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
        {register && <label className="account-wide"><span>一次性邀请码</span><input aria-label="注册邀请码" required minLength={43} maxLength={43} autoComplete="off" spellCheck={false} value={invite} onChange={e => setInvite(e.target.value)} disabled={busy} /></label>}
        <details className="account-wide account-connection"><summary>高级连接选项</summary>
          <label><span>账号服务地址</span><input type="url" aria-label="账号服务地址" required maxLength={2000} autoCapitalize="none" spellCheck={false} value={endpoint} onChange={e => setEndpoint(e.target.value)} disabled={busy} /></label>
          <label><span>设备名称</span><input aria-label="设备名称" required maxLength={80} value={deviceName} onChange={e => setDeviceName(e.target.value)} disabled={busy} /></label>
        </details>
        <div className="account-wide account-actions"><button type="submit" className="primary-button" disabled={busy || !status || status.restartRequired}><LogIn size={15} />{register ? "创建账号" : "登录账号"}</button></div>
      </form>
    </details>
    {account && <details className="account-auth">
      <summary>高级：独立资料空间</summary>
      <p className="account-meta">用于个人与内测资料隔离。日常记录保持自动同步，切换不会搬运现有资料。</p>
      <div className="account-actions"><button type="button" className="secondary-button" disabled={busy || !current?.signedIn || status?.restartRequired} onClick={() => void action(async () => { setSpaces(await accountWorkspaces()); })}><RefreshCw size={15} />查看可用空间</button></div>
      {spaces && <div className="account-workspaces" aria-label="本人可访问的资料空间">
        <p className="account-meta">{spaces.environment === "preview" ? "测试环境 · 与正式账号和资料独立" : "正式环境"}</p>
        {spaces.workspaces.length === 0 && <p>当前账号没有额外资料空间，继续使用原资料库即可。</p>}
        {spaces.workspaces.map(space => <div className="account-workspace" key={space.id}><div><strong>{space.name}</strong><p>个人工具{space.id === current?.workspace?.id ? " · 当前" : ""}</p></div>
          <button type="button" className="secondary-button" disabled={busy || status?.restartRequired || space.id === current?.workspace?.id} onClick={() => setConfirmation({ kind: "workspace", workspace: space, environment: spaces.environment })}><ArrowRightLeft size={15} />打开空间</button>
        </div>)}
      </div>}
    </details>}
    {account && <div className="account-devices">
      <header><strong>设备会话</strong><button className="secondary-button" type="button" disabled={busy || !current?.signedIn} onClick={() => void action(loadSessions)}><RefreshCw size={15} />刷新设备</button></header>
      {sessions !== null && <ul>{sessions.map(session => <li key={session.id}>
        <span className="account-device-icon">{session.platform === "android" ? <Smartphone size={19} /> : <Monitor size={19} />}</span>
        <div><strong>{session.deviceName}{session.current && <span className="account-current">当前设备</span>}</strong><p>{session.platform === "android" ? "Android" : "Linux"} · 最近访问 {date(session.lastSeen)}</p><p>创建 {date(session.createdAt)} · 到期 {date(session.expiresAt)}</p></div>
        {!session.current && <button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirmation({ kind: "device", session })}><LogOut size={15} />撤销</button>}
      </li>)}</ul>}
      <div className="account-actions">
        <button className="secondary-button" type="button" disabled={busy || !current?.signedIn} onClick={() => setConfirmation({ kind: "others" })}><ShieldCheck size={15} />撤销其他设备</button>
        <button className="secondary-button" type="button" disabled={busy || !current?.signedIn} onClick={() => setConfirmation({ kind: "logout", localOnly: false })}><LogOut size={15} />退出当前设备</button>
        {(failedLogout || !current?.signedIn) && <button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirmation({ kind: "logout", localOnly: true })}><LogOut size={15} />仅移除本机登录</button>}
      </div>
      {current?.signedIn && <details className="account-password-change"><summary><KeyRound size={15} />修改密码</summary>
        <form className="account-form" onSubmit={e => { e.preventDefault(); void action(async () => {
          if (newPassword !== repeatPassword) throw Error("两次新密码不一致");
          await changeAccountPassword(oldPassword, newPassword);
          setOldPassword(""); setNewPassword(""); setRepeatPassword(""); setSessions(null); await refresh();
          setMessage("密码已修改，全部设备会话已退出，请重新登录。");
        }); }}>
          <label className="account-wide"><span>当前密码</span><input aria-label="当前密码" type="password" autoComplete="current-password" required maxLength={128} value={oldPassword} onChange={e => setOldPassword(e.target.value)} disabled={busy} /></label>
          <label><span>新密码</span><input aria-label="新密码" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={e => setNewPassword(e.target.value)} disabled={busy} /></label>
          <label><span>再次输入新密码</span><input aria-label="再次输入新密码" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={repeatPassword} onChange={e => setRepeatPassword(e.target.value)} disabled={busy} /></label>
          <p className="account-wide account-meta">修改后所有设备都需重新登录，本机资料保留。</p><button className="primary-button" type="submit" disabled={busy}><KeyRound size={15} />修改密码并退出全部设备</button>
        </form>
      </details>}
      {current?.signedIn && <details className="account-danger-zone">
        <summary><Trash2 size={15} />删除云端账号</summary>
        <p>此操作会永久删除云端账号、任务资料库和所有设备会话，无法通过应用撤销。本机资料会保留，但立即变为离线副本；建议先导出备份。</p>
        <form className="account-form" onSubmit={e => { e.preventDefault(); void action(async () => {
          await deleteAccount(deletePassword, deleteConfirmation);
          setDeletePassword(""); setDeleteConfirmation(""); setSessions(null); await refresh();
          setMessage("云端账号已删除。本机资料已保留为离线副本，请确认备份后再清理。");
        }); }}>
          <label><span>当前密码</span><input aria-label="删除账号的当前密码" type="password" autoComplete="current-password" required minLength={12} maxLength={128} value={deletePassword} onChange={e => setDeletePassword(e.target.value)} disabled={busy} /></label>
          <label><span>输入 DELETE 确认</span><input aria-label="删除账号确认词" required pattern="DELETE" value={deleteConfirmation} onChange={e => setDeleteConfirmation(e.target.value)} disabled={busy} /></label>
          <button className="danger account-wide" type="submit" disabled={busy || deleteConfirmation !== "DELETE"}><Trash2 size={15} />永久删除云端账号</button>
        </form>
      </details>}
    </div>}
    {message && <p className="account-message" role="status">{message}</p>}
    {error && <p className="account-error" role="alert">{error}</p>}
  </section>;
}
