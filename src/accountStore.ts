import { invoke } from "@tauri-apps/api/core";
import { withAppRestore } from "./appDataStore";

export interface LocalProfile {
  key: string;
  username: string | null;
  endpoint: string | null;
  sessionId: string | null;
  expiresAt: number | null;
  signedIn: boolean;
  active: boolean;
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

export const profileStatus = () => invoke<ProfileStatus>("get_profile_status");
export const localProfiles = () => invoke<LocalProfile[]>("list_local_profiles");
export const signInAccount = (input: { endpoint: string; username: string; password: string; deviceName: string; invite: string | null }) =>
  invoke<LocalProfile>("sign_in_account", { input });
export const accountSessions = () => invoke<{ sessions: DeviceSession[] }>("list_account_sessions");

export async function switchProfile(key: string, expectedCurrent: string) {
  if (key === expectedCurrent) return profileStatus();
  return withAppRestore(async () => {
    const status = await invoke<ProfileStatus>("select_local_profile", { key, expectedCurrent });
    if (status.restartRequired) await invoke("restart_selected_profile", { selectedKey: key });
    return status;
  });
}

export async function restartSelectedProfile(key: string) {
  const status = await profileStatus();
  if (!status.restartRequired) return;
  return withAppRestore(() => invoke<void>("restart_selected_profile", { selectedKey: key }));
}
