import { invoke, isTauri } from "@tauri-apps/api/core";

export interface AiSettings {
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKeyHint: string | null;
}

const defaultSettings: AiSettings = {
  baseUrl: "https://api.openai.com/v1",
  apiKeyConfigured: false,
  apiKeyHint: null,
};

let browserSettings = { ...defaultSettings };

export async function getAiSettings(): Promise<AiSettings> {
  return isTauri() ? invoke<AiSettings>("get_ai_settings") : { ...browserSettings };
}

export async function saveAiSettings(
  apiKey: string,
  baseUrl: string,
  clearApiKey = false,
): Promise<AiSettings> {
  if (isTauri()) {
    return invoke<AiSettings>("save_ai_settings", {
      apiKey: apiKey.trim() || null,
      baseUrl,
      clearApiKey,
    });
  }
  browserSettings = {
    baseUrl: baseUrl.trim().replace(/\/+$/, ""),
    apiKeyConfigured: clearApiKey ? false : Boolean(apiKey.trim()) || browserSettings.apiKeyConfigured,
    apiKeyHint: clearApiKey ? null : apiKey.trim() ? `····${apiKey.trim().slice(-4)}` : browserSettings.apiKeyHint,
  };
  return { ...browserSettings };
}
