import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";

declare global {
  interface Window {
    textspeed?: {
      invoke<T>(channel: string, payload?: Record<string, unknown>): Promise<T>;
      on<T>(channel: string, callback: (payload: T) => void): () => void;
    };
  }
}

export type AiAction = "translate" | "summarize" | "reply" | "explain" | "fix" | "professional" | "mail";

export type AppSettings = {
  preferredLanguage: string;
  translationLanguageA: string;
  translationLanguageB: string;
  provider: "openai" | "gemini";
  model: string;
  fastModel: string;
  balancedModel: string;
  powerfulModel: string;
  openaiApiKey: string;
  geminiApiKey: string;
  popupHotkey: string;
  ocrHotkey: string;
  inlineEnabled: boolean;
  commands: InlineCommand[];
  floatingActions: FloatingAction[];
};

export type InlineCommand = {
  name: string;
  label: string;
  action: AiAction;
  prompt: string;
  enabled: boolean;
};

export type FloatingAction = {
  id: string;
  label: string;
  action: AiAction;
  prompt: string;
  enabled: boolean;
};

export type InlineMatch = {
  command: string;
  content: string;
  fullText: string;
  prefix: "/" | "//" | "///";
  modelTier: "fast" | "balanced" | "powerful";
};

export type InlineExecution = {
  command: string;
  action: AiAction;
  input: string;
  output: string;
  model: string;
  modelTier: "fast" | "balanced" | "powerful";
  typedLength: number;
};

export async function getSettings(): Promise<AppSettings> {
  return call<AppSettings>("get_settings");
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  return call<AppSettings>("save_settings", { settings });
}

export async function runAiAction(action: AiAction, text: string): Promise<string> {
  return call<string>("run_ai_action", { action, text });
}

export async function runFloatingAction(actionId: string, text: string): Promise<string> {
  return call<string>("run_floating_action", { actionId, text });
}

export async function getModelIds(settings: AppSettings): Promise<string[]> {
  return call<string[]>("get_model_ids", { settings });
}

export async function testProvider(settings: AppSettings): Promise<string> {
  return call<string>("test_provider", { settings });
}

export async function readClipboardText(): Promise<string> {
  return call<string>("read_clipboard_text");
}

export async function writeClipboardText(text: string): Promise<void> {
  return call<void>("write_clipboard_text", { text });
}

export async function hideFloatingWindow(): Promise<void> {
  return call<void>("hide_floating_window");
}

export async function hideMainWindow(): Promise<void> {
  return call<void>("hide_main_window");
}

export async function parseInlineBuffer(buffer: string): Promise<InlineMatch | null> {
  return call<InlineMatch | null>("parse_inline_buffer", { buffer });
}

export async function executeInlineCommand(buffer: string): Promise<InlineExecution | null> {
  return call<InlineExecution | null>("execute_inline_command", { buffer });
}

export type RuntimeStatus = {
  system: string[];
  inline: string[];
};

function call<T>(channel: string, payload?: Record<string, unknown>): Promise<T> {
  if (window.textspeed?.invoke) {
    return window.textspeed.invoke<T>(channel, payload);
  }
  return invoke<T>(channel, payload);
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  return call<RuntimeStatus>("get_runtime_status");
}

export async function listenTextSpeedEvent<T>(
  channel: string,
  callback: (event: { payload: T }) => void,
): Promise<() => void> {
  if (window.textspeed?.on) {
    return window.textspeed.on<T>(channel, (payload) => callback({ payload }));
  }
  return tauriListen<T>(channel, callback);
}
