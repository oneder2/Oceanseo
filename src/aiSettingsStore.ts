import { invoke, isTauri } from "@tauri-apps/api/core";

export interface AiSettings {
  model: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKeyHint: string | null;
}

const defaultSettings: AiSettings = {
  model: "gpt-5.6",
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
  model = "gpt-5.6",
): Promise<AiSettings> {
  if (isTauri()) {
    return invoke<AiSettings>("save_ai_settings", {
      apiKey: apiKey.trim() || null,
      baseUrl,
      clearApiKey,
      model,
    });
  }
  browserSettings = {
    model: model.trim(),
    baseUrl: baseUrl.trim().replace(/\/+$/, ""),
    apiKeyConfigured: clearApiKey ? false : Boolean(apiKey.trim()) || browserSettings.apiKeyConfigured,
    apiKeyHint: clearApiKey ? null : apiKey.trim() ? `····${apiKey.trim().slice(-4)}` : browserSettings.apiKeyHint,
  };
  return { ...browserSettings };
}

export async function testAiConnection() {
  if (!isTauri()) throw Error("请在桌面应用中测试已保存的服务配置");
  return invoke<string>("test_ai_connection");
}
