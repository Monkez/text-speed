import { invoke } from "@tauri-apps/api/core";

export type AiAction = "translate" | "summarize" | "reply" | "explain" | "fix" | "professional" | "mail";

export type AppSettings = {
  preferredLanguage: string;
  translationLanguageA: string;
  translationLanguageB: string;
  provider: "openai" | "gemini";
  model: string;
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
};

export type InlineExecution = {
  command: string;
  action: AiAction;
  input: string;
  output: string;
  typedLength: number;
};

export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke<AppSettings>("save_settings", { settings });
}

export async function runAiAction(action: AiAction, text: string): Promise<string> {
  return invoke<string>("run_ai_action", { action, text });
}

export async function runFloatingAction(actionId: string, text: string): Promise<string> {
  return invoke<string>("run_floating_action", { actionId, text });
}

export async function getModelIds(settings: AppSettings): Promise<string[]> {
  return invoke<string[]>("get_model_ids", { settings });
}

export async function readClipboardText(): Promise<string> {
  return invoke<string>("read_clipboard_text");
}

export async function writeClipboardText(text: string): Promise<void> {
  return invoke<void>("write_clipboard_text", { text });
}

export async function hideFloatingWindow(): Promise<void> {
  return invoke<void>("hide_floating_window");
}

export async function hideMainWindow(): Promise<void> {
  return invoke<void>("hide_main_window");
}

export async function parseInlineBuffer(buffer: string): Promise<InlineMatch | null> {
  return invoke<InlineMatch | null>("parse_inline_buffer", { buffer });
}

export async function executeInlineCommand(buffer: string): Promise<InlineExecution | null> {
  return invoke<InlineExecution | null>("execute_inline_command", { buffer });
}

export type RuntimeStatus = {
  system: string[];
  inline: string[];
};

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("get_runtime_status");
}
