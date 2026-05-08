const { app, BrowserWindow, clipboard, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

let mainWindow;

const fallbackSettings = {
  preferredLanguage: "Tiếng Việt",
  translationLanguageA: "Tiếng Việt",
  translationLanguageB: "English",
  provider: "openai",
  model: "gpt-4.1-mini",
  openaiApiKey: "",
  geminiApiKey: "",
  popupHotkey: "Ctrl + Space",
  ocrHotkey: "Ctrl + Shift + S",
  inlineEnabled: true,
  commands: [
    {
      name: "trans",
      label: "Translate",
      action: "translate",
      prompt: "Dịch theo cặp ngôn ngữ ưu tiên; nếu nguồn nằm ngoài cặp này thì dịch sang ngôn ngữ ưu tiên.",
      enabled: true,
    },
    { name: "fix", label: "Fix grammar", action: "fix", prompt: "Sửa chính tả, ngữ pháp, dấu câu. Không giải thích.", enabled: true },
    { name: "pro", label: "Professional", action: "professional", prompt: "Viết lại theo phong cách chuyên nghiệp, ngắn gọn và lịch sự.", enabled: true },
    { name: "mail", label: "Email draft", action: "mail", prompt: "Tạo email hoàn chỉnh có tiêu đề, lời chào, nội dung, kết thúc.", enabled: true },
  ],
  floatingActions: [
    { id: "translate", label: "Translate", action: "translate", prompt: "Dịch theo cặp ngôn ngữ ưu tiên; nếu nguồn nằm ngoài cặp này thì dịch sang ngôn ngữ ưu tiên.", enabled: true },
    { id: "summary", label: "Summary", action: "summarize", prompt: "Tóm tắt ý chính, ngắn gọn.", enabled: true },
    { id: "reply", label: "Reply", action: "reply", prompt: "Viết một phản hồi ngắn, tự nhiên.", enabled: true },
    { id: "explain", label: "Explain", action: "explain", prompt: "Giải thích dễ hiểu, trực tiếp.", enabled: true },
  ],
};

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    return { ...fallbackSettings, ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")) };
  } catch {
    return fallbackSettings;
  }
}

function saveSettings(settings) {
  const next = { ...fallbackSettings, ...settings };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function parseInlineBuffer(buffer) {
  const trimmed = String(buffer || "").trimEnd();
  if (!trimmed.endsWith("/")) return null;
  const start = trimmed.lastIndexOf("//");
  if (start < 0) return null;
  const fullText = trimmed.slice(start);
  const body = fullText.slice(2, -1).trimStart();
  const match = body.match(/^(\S+)\s+([\s\S]+)$/);
  if (!match) return null;
  return { command: match[1], content: match[2].trim(), fullText };
}

function instructionFor(action, settings) {
  if (action === "translate") {
    return [
      "Translate using TextSpeed language routing.",
      `Preferred bilingual pair: ${settings.translationLanguageA} and ${settings.translationLanguageB}.`,
      `Fallback target language: ${settings.preferredLanguage}.`,
      `If the input language is primarily ${settings.translationLanguageA}, translate it to ${settings.translationLanguageB}.`,
      `If the input language is primarily ${settings.translationLanguageB}, translate it to ${settings.translationLanguageA}.`,
      `If the input language is not primarily ${settings.translationLanguageA} or ${settings.translationLanguageB}, translate it to ${settings.preferredLanguage}.`,
      "Return only the translated text.",
    ].join("\n");
  }
  if (action === "summarize") return "Summarize the text into concise key points.";
  if (action === "reply") return "Read the text and write one short, natural reply. Return only the reply.";
  if (action === "explain") return "Explain the text clearly and briefly.";
  if (action === "fix") return "Fix spelling, grammar, and punctuation. Return only the corrected text.";
  if (action === "mail") return "Create a complete email with subject, greeting, body, and closing.";
  return "Rewrite the text professionally, concisely, and politely.";
}

async function runAi(action, prompt, text, settings) {
  const instruction = `${instructionFor(action, settings)}\n${prompt || ""}\n\nText:\n${text}`;
  if (settings.provider === "gemini") {
    const key = settings.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    const model = settings.model || "gemini-2.5-flash-lite";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: instruction }] }] }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(value));
    return value?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
  }

  const key = settings.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: settings.model || "gpt-4.1-mini", input: instruction }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(value));
  return value.output_text || value.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("").trim() || "";
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 680,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
}

ipcMain.handle("get_settings", () => loadSettings());
ipcMain.handle("save_settings", (_event, payload) => saveSettings(payload.settings));
ipcMain.handle("read_clipboard_text", () => clipboard.readText());
ipcMain.handle("write_clipboard_text", (_event, payload) => clipboard.writeText(payload.text || ""));
ipcMain.handle("hide_main_window", () => mainWindow?.hide());
ipcMain.handle("hide_floating_window", () => undefined);
ipcMain.handle("parse_inline_buffer", (_event, payload) => parseInlineBuffer(payload.buffer));
ipcMain.handle("execute_inline_command", async (_event, payload) => {
  const settings = loadSettings();
  const parsed = parseInlineBuffer(payload.buffer);
  if (!parsed || !settings.inlineEnabled) return null;
  const command = settings.commands.find((item) => item.enabled && item.name === parsed.command);
  if (!command) return null;
  const output = await runAi(command.action, command.prompt, parsed.content, settings);
  return { command: parsed.command, action: command.action, input: parsed.content, output, typedLength: parsed.fullText.length };
});
ipcMain.handle("run_ai_action", async (_event, payload) => {
  const settings = loadSettings();
  return runAi(payload.action, "", payload.text, settings);
});
ipcMain.handle("run_floating_action", async (_event, payload) => {
  const settings = loadSettings();
  const action = settings.floatingActions.find((item) => item.enabled && item.id === payload.actionId);
  if (!action) throw new Error(`Floating action disabled or missing: ${payload.actionId}`);
  return runAi(action.action, action.prompt, payload.text, settings);
});
ipcMain.handle("get_model_ids", async (_event, payload) => {
  const settings = payload.settings || loadSettings();
  if (settings.provider === "gemini") {
    const key = settings.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const value = await response.json();
    return (value.models || []).map((model) => String(model.name || "").replace(/^models\//, "")).filter(Boolean);
  }
  const key = settings.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const response = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } });
  const value = await response.json();
  return (value.data || []).map((model) => model.id).filter(Boolean);
});
ipcMain.handle("get_runtime_status", () => ({
  system: ["Electron shell ready", "Chromium IME input enabled", "Rust hook sidecar migration pending"],
  inline: ["Settings UI is running outside Tauri WebView2"],
}));

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
