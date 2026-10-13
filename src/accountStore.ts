import { invoke, isTauri } from "@tauri-apps/api/core";
import { withAppRestore } from "./appDataStore";

export interface LocalProfile {
  key: string;
  username: string | null;
  endpoint: string | null;
  sessionId: string | null;
  expiresAt: number | null;
  signedIn: boolean;
  active: boolean;
  workspace?: WorkspaceBinding | null;
}
export interface WorkspaceBinding {
  version: 1;
  environment: "preview" | "live";
  // Historical profile tags remain readable; active workspace operations select personal only.
  edition: "personal" | "commercial-beads";
  id: string;
  vaultId: string;
}
export interface WorkspaceSummary {
  id: string;
  edition: WorkspaceBinding["edition"];
  name: string;
  vaultId: string;
}
export interface WorkspaceList {
  schemaVersion: 1;
  environment: WorkspaceBinding["environment"];
  workspaces: WorkspaceSummary[];
}
export interface ProfileStatus {
  current: LocalProfile;
  selectedKey: string;
  restartRequired: boolean;
}
export interface DeviceSession {
  id: string;
  deviceName: string;
  platform: string;
  createdAt: number;
  lastSeen: number;
  expiresAt: number;
  current: boolean;
}

// Browser builds use the same invitation-only service as the native clients.
// The token is kept in sessionStorage and is never copied into application
// state or sent to the renderer's business records.  Native builds continue to
// use the encrypted Rust profile implementation below.
const WEB_AUTH_KEY = "oceanseo.web.auth.v1";
type WebAuth = { endpoint: string; token: string; profile: LocalProfile };
function webAuth(): WebAuth | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(window.sessionStorage.getItem(WEB_AUTH_KEY) || "null") as WebAuth | null; }
  catch { return null; }
}
export function browserAccountSession(): { endpoint: string; token: string; workspaceId: string | null; vaultId: string | null } | null {
  const auth = webAuth();
  return auth ? { endpoint: auth.endpoint, token: auth.token, workspaceId: auth.profile.workspace?.id ?? null, vaultId: auth.profile.workspace?.vaultId ?? null } : null;
}
function setWebAuth(value: WebAuth | null) {
  if (typeof window === "undefined") return;
  if (value) window.sessionStorage.setItem(WEB_AUTH_KEY, JSON.stringify(value));
  else window.sessionStorage.removeItem(WEB_AUTH_KEY);
}
async function webRequest<T>(endpoint: string, route: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${endpoint.replace(/\/$/, "")}${route}`, { ...init, headers });
  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* health/errors may be plain text */ }
  if (!response.ok) throw Error((payload && typeof payload === "object" && "error" in payload) ? String((payload as { error: unknown }).error) : `account_http_${response.status}`);
  return payload as T;
}
function browserProfile(auth: WebAuth | null): LocalProfile {
  if (!auth) return { key: "local", username: null, endpoint: null, sessionId: null, expiresAt: null, signedIn: false, active: true, workspace: null };
  return { ...auth.profile, active: true };
}

export async function profileStatus(): Promise<ProfileStatus> {
  if (isTauri()) return invoke<ProfileStatus>("get_profile_status");
  const auth = webAuth();
  return { current: browserProfile(auth), selectedKey: auth?.profile.key ?? "local", restartRequired: false };
}
export async function localProfiles(): Promise<LocalProfile[]> {
  if (isTauri()) return invoke<LocalProfile[]>("list_local_profiles");
  const auth = webAuth();
  return [browserProfile(auth), ...(auth ? [] : [])];
}
export async function signInAccount(input: { endpoint: string; username: string; password: string; deviceName: string; invite: string | null }): Promise<LocalProfile> {
  if (isTauri()) return invoke<LocalProfile>("sign_in_account", { input });
  const route = input.invite ? "/v2/register" : "/v2/login";
  const body = input.invite
    ? { username: input.username, password: input.password, invite: input.invite, deviceName: input.deviceName, platform: "browser" }
    : { username: input.username, password: input.password, deviceName: input.deviceName, platform: "browser" };
  const reply = await webRequest<{ user: { id: string; username: string }; session: { id: string; expiresAt: number }; vaultId: string; token: string }>(input.endpoint, route, { method: "POST", body: JSON.stringify(body) });
  const key = `web:${reply.user.id}`;
  const profile: LocalProfile = { key, username: reply.user.username, endpoint: input.endpoint.replace(/\/$/, ""), sessionId: reply.session.id, expiresAt: reply.session.expiresAt, signedIn: true, active: true, workspace: null };
  const endpoint = profile.endpoint!;
  setWebAuth({ endpoint, token: reply.token, profile });
  return profile;
}
export async function accountSessions(): Promise<{ sessions: DeviceSession[] }> {
  if (isTauri()) return invoke<{ sessions: DeviceSession[] }>("list_account_sessions");
  const auth = webAuth();
  if (!auth) throw Error("未登录");
  return webRequest(auth.endpoint, "/v2/sessions", {}, auth.token);
}
export async function accountWorkspaces(): Promise<WorkspaceList> {
  if (isTauri()) return invoke<WorkspaceList>("list_account_workspaces");
  const auth = webAuth();
  if (!auth) throw Error("未登录");
  const list = await webRequest<WorkspaceList>(auth.endpoint, "/v2/workspaces", {}, auth.token);
  return { ...list, workspaces: list.workspaces.filter(space => space.edition === "personal") };
}
export async function logoutAccount(localOnly: boolean): Promise<void> {
  if (isTauri()) { await invoke("logout_account", { localOnly }); return; }
  if (!localOnly) {
    const auth = webAuth();
    if (auth) await webRequest(auth.endpoint, `/v2/sessions/${auth.profile.sessionId}`, { method: "DELETE" }, auth.token).catch(() => undefined);
  }
  setWebAuth(null);
}
export async function revokeAccountSession(sessionId: string): Promise<void> {
  if (isTauri()) { await invoke("revoke_account_session", { sessionId }); return; }
  const auth = webAuth();
  if (!auth) throw Error("未登录");
  await webRequest(auth.endpoint, `/v2/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }, auth.token);
}
export async function changeAccountPassword(currentPassword: string, password: string): Promise<void> {
  if (isTauri()) { await invoke("change_account_password", { currentPassword, password }); return; }
  const auth = webAuth();
  if (!auth) throw Error("未登录");
  await webRequest(auth.endpoint, "/v2/password", { method: "POST", body: JSON.stringify({ currentPassword, password }) }, auth.token);
  setWebAuth(null);
}
export async function deleteAccount(password: string, confirmation: string): Promise<void> {
  if (isTauri()) { await invoke("delete_account", { password, confirmation }); return; }
  const auth = webAuth();
  if (!auth) throw Error("未登录");
  await webRequest(auth.endpoint, "/v2/account", { method: "DELETE", body: JSON.stringify({ password, confirmation }) }, auth.token);
  setWebAuth(null);
}

export async function switchWorkspace(workspaceId: string, expectedCurrent: string) {
  if (!isTauri()) {
    const auth = webAuth();
    if (!auth) throw Error("未登录");
    const spaces = await webRequest<WorkspaceList>(auth.endpoint, "/v2/workspaces", {}, auth.token);
    const workspace = spaces.workspaces.find(item => item.id === workspaceId);
    if (!workspace || workspace.edition !== "personal") throw Error("workspace_not_found");
    const profile = { ...auth.profile, workspace: { version: 1 as const, environment: spaces.environment, edition: workspace.edition, id: workspace.id, vaultId: workspace.vaultId } };
    setWebAuth({ ...auth, profile });
    return { current: profile, selectedKey: profile.key, restartRequired: false } satisfies ProfileStatus;
  }
  return withAppRestore(async () => {
    const status = await invoke<ProfileStatus>("select_account_workspace", { workspaceId, expectedCurrent });
    if (status.restartRequired)
      await invoke("restart_selected_profile", { selectedKey: status.selectedKey });
    return status;
  });
}

export async function switchProfile(key: string, expectedCurrent: string) {
  if (!isTauri()) {
    if (key !== "local") throw Error("浏览器只支持当前登录资料库");
    setWebAuth(null);
    return profileStatus();
  }
  if (key === expectedCurrent) return profileStatus();
  return withAppRestore(async () => {
    const status = await invoke<ProfileStatus>("select_local_profile", { key, expectedCurrent });
    if (status.restartRequired) await invoke("restart_selected_profile", { selectedKey: key });
    return status;
  });
}

export async function restartSelectedProfile(key: string) {
  if (!isTauri()) return;
  const status = await profileStatus();
  if (!status.restartRequired) return;
  return withAppRestore(() => invoke<void>("restart_selected_profile", { selectedKey: key }));
}
