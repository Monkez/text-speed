const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, screen, Tray } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

let mainWindow;
let floatingWindow;
let tray;
let keyboardHook;
let inlineBusy = false;
let hotkeyBusy = false;
const inlineTracker = {
  buffer: "",
  slashRun: 0,
  openedAt: 0,
  lastKeyAt: 0,
};
const systemStatus = ["Electron shell ready"];
const inlineStatus = ["Inline hook starting"];
const INLINE_RUNNING_MARKER = "[TextSpeed running...]";

const fallbackSettings = {
  preferredLanguage: "Tiếng Việt",
  translationLanguageA: "Tiếng Việt",
  translationLanguageB: "English",
  provider: "openai",
  model: "gpt-4.1-mini",
  fastProvider: "openai",
  fastModel: "gpt-4.1-mini",
  fastApiKey: "",
  fastBaseUrl: "",
  balancedProvider: "openai",
  balancedModel: "gpt-4.1-mini",
  balancedApiKey: "",
  balancedBaseUrl: "",
  powerfulProvider: "openai",
  powerfulModel: "gpt-4.1",
  powerfulApiKey: "",
  powerfulBaseUrl: "",
  openaiApiKey: "",
  claudeApiKey: "",
  geminiApiKey: "",
  customApiKey: "",
  customBaseUrl: "",
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
    const loaded = { ...fallbackSettings, ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")) };
    return normalizeSettings(loaded);
  } catch {
    return fallbackSettings;
  }
}

function saveSettings(settings) {
  const next = normalizeSettings({ ...fallbackSettings, ...settings });
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  registerHotkeys(next);
  return next;
}

function normalizeSettings(settings) {
  const next = { ...fallbackSettings, ...settings };
  next.fastProvider = next.fastProvider || next.provider || fallbackSettings.fastProvider;
  next.balancedProvider = next.balancedProvider || next.provider || fallbackSettings.balancedProvider;
  next.powerfulProvider = next.powerfulProvider || next.provider || fallbackSettings.powerfulProvider;
  next.fastModel = next.fastModel || next.model || fallbackSettings.fastModel;
  next.balancedModel = next.balancedModel || next.model || fallbackSettings.balancedModel;
  next.powerfulModel = next.powerfulModel || next.model || fallbackSettings.powerfulModel;
  next.fastApiKey = next.fastApiKey || providerKey(next, next.fastProvider);
  next.balancedApiKey = next.balancedApiKey || providerKey(next, next.balancedProvider);
  next.powerfulApiKey = next.powerfulApiKey || providerKey(next, next.powerfulProvider);
  next.fastBaseUrl = next.fastBaseUrl || providerBaseUrl(next, next.fastProvider);
  next.balancedBaseUrl = next.balancedBaseUrl || providerBaseUrl(next, next.balancedProvider);
  next.powerfulBaseUrl = next.powerfulBaseUrl || providerBaseUrl(next, next.powerfulProvider);
  next.provider = next.balancedProvider;
  next.model = next.balancedModel;
  return next;
}

function providerKey(settings, provider) {
  if (provider === "openai") return settings.openaiApiKey || "";
  if (provider === "claude") return settings.claudeApiKey || "";
  if (provider === "gemini") return settings.geminiApiKey || "";
  return settings.customApiKey || "";
}

function providerBaseUrl(settings, provider) {
  return provider === "custom" ? settings.customBaseUrl || "" : "";
}

function parseInlineBuffer(buffer) {
  const trimmed = String(buffer || "").trimEnd();
  if (!trimmed.endsWith("/")) return null;
  const match = trimmed.match(/(?:^|\s)(\/{1,3})([A-Za-z0-9_-]+)\s+([\s\S]+)\/$/);
  if (!match) return null;
  const prefix = match[1];
  const command = match[2];
  const content = match[3].trim();
  if (!content) return null;
  const modelTier = prefix.length === 1 ? "fast" : prefix.length === 2 ? "balanced" : "powerful";
  return { command, content, fullText: `${prefix}${command} ${match[3]}/`, prefix, modelTier };
}

function profileForTier(settings, tier) {
  const prefix = tier === "fast" ? "fast" : tier === "powerful" ? "powerful" : "balanced";
  const provider = settings[`${prefix}Provider`] || settings.provider || "openai";
  return {
    provider,
    model: settings[`${prefix}Model`] || settings.model || fallbackSettings[`${prefix}Model`],
    apiKey: settings[`${prefix}ApiKey`] || providerKey(settings, provider),
    baseUrl: settings[`${prefix}BaseUrl`] || providerBaseUrl(settings, provider),
  };
}

function modelForTier(settings, tier) {
  return profileForTier(settings, tier).model;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function settingsForProfile(settings, profile) {
  return {
    ...settings,
    provider: profile.provider,
    model: profile.model,
    openaiApiKey: profile.provider === "openai" ? profile.apiKey : settings.openaiApiKey,
    claudeApiKey: profile.provider === "claude" ? profile.apiKey : settings.claudeApiKey,
    geminiApiKey: profile.provider === "gemini" ? profile.apiKey : settings.geminiApiKey,
    customApiKey: profile.provider === "custom" ? profile.apiKey : settings.customApiKey,
    customBaseUrl: profile.provider === "custom" ? profile.baseUrl : settings.customBaseUrl,
  };
}

function openAiCompatibleText(value) {
  return value?.choices?.[0]?.message?.content?.trim()
    || value?.choices?.[0]?.text?.trim()
    || value?.output_text
    || "";
}

function claudeText(value) {
  return (value?.content || []).map((part) => part?.text || "").join("").trim();
}

function replaceLast(source, needle, replacement) {
  const index = source.lastIndexOf(needle);
  if (index < 0) return null;
  return `${source.slice(0, index)}${replacement}${source.slice(index + needle.length)}`;
}

function pushStatus(target, value) {
  const timestamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
  target.push(`[${timestamp}] ${value}`);
  while (target.length > 60) target.shift();
  console.log(value);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendKeys(keys) {
  return new Promise((resolve, reject) => {
    const escaped = keys.replace(/'/g, "''");
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `$ws = New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 25; $ws.SendKeys('${escaped}')`,
    ], { windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`SendKeys failed: ${code}`))));
  });
}

async function copySelectionToClipboard() {
  const previous = clipboard.readText();
  clipboard.writeText("");
  await delay(40);
  await sendKeys("^c");
  await delay(160);
  const selected = clipboard.readText();
  return { selected, previous };
}

async function selectAllAndCopyFocusedText() {
  const previous = clipboard.readText();
  clipboard.writeText("");
  await delay(40);
  await sendKeys("^a");
  await delay(100);
  await sendKeys("^c");
  await delay(180);
  const selected = clipboard.readText();
  return { selected, previous };
}

async function pasteText(text) {
  clipboard.writeText(text);
  await delay(170);
  await sendKeys("^v");
  await delay(220);
}

function cleanupClipboard(previous) {
  setTimeout(() => clipboard.writeText(previous || ""), 2000);
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

async function runAi(action, prompt, text, settings, modelOverride, providerOverride) {
  const instruction = `${instructionFor(action, settings)}\n${prompt || ""}\n\nText:\n${text}`;
  const provider = providerOverride || settings.provider;

  if (provider === "custom") {
    const key = settings.customApiKey || process.env.TEXTSPEED_CUSTOM_API_KEY;
    if (!key) throw new Error("Custom provider API key is not set");
    const baseUrl = normalizeBaseUrl(settings.customBaseUrl);
    if (!baseUrl) throw new Error("Custom provider base URL is not set");
    const model = modelOverride || settings.model || settings.balancedModel;
    if (!model) throw new Error("Custom provider model is not set");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: instruction }] }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(value));
    return openAiCompatibleText(value);
  }

  if (provider === "claude") {
    const key = settings.claudeApiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("Claude API key is not set");
    const model = modelOverride || settings.model || settings.balancedModel || "claude-3-5-haiku-latest";
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: "user", content: instruction }] }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(value));
    return claudeText(value);
  }

  if (provider === "gemini") {
    const key = settings.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    const model = modelOverride || settings.model || settings.balancedModel || "gemini-2.5-flash-lite";
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
  const model = modelOverride || settings.model || settings.balancedModel || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, input: instruction }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(value));
  return value.output_text || value.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("").trim() || "";
}

function iconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icon.ico");
  }
  return path.join(__dirname, "build", "icon.ico");
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function createTray() {
  if (tray) return tray;

  tray = new Tray(iconPath());
  tray.setToolTip("TextSpeed");
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "Open TextSpeed",
      click: showMainWindow,
    },
    {
      type: "separator",
    },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ]));
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
  pushStatus(systemStatus, "Tray icon ready");
  return tray;
}

function hideToTray() {
  createTray();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 680,
    autoHideMenuBar: true,
    icon: iconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
}

function createFloatingWindow() {
  if (floatingWindow && !floatingWindow.isDestroyed()) return floatingWindow;
  floatingWindow = new BrowserWindow({
    width: 330,
    height: 300,
    resizable: false,
    movable: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    autoHideMenuBar: true,
    icon: iconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  floatingWindow.loadFile(path.join(__dirname, "dist", "index.html"), { query: { window: "floating" } });
  floatingWindow.on("blur", () => {
    if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.hide();
  });
  return floatingWindow;
}

function emitHotkey(action, hotkey) {
  const payload = { action, hotkey };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("textspeed-hotkey", payload);
  if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.webContents.send("textspeed-hotkey", payload);
}

async function openFloatingMenu(hotkey) {
  pushStatus(systemStatus, `Hotkey: floating menu (${hotkey})`);
  let previous = clipboard.readText();
  try {
    const capture = await copySelectionToClipboard();
    previous = capture.previous;
  } catch (error) {
    pushStatus(systemStatus, `Floating copy failed: ${error.message}`);
  }

  const point = screen.getCursorScreenPoint();
  const popup = createFloatingWindow();
  popup.setPosition(point.x + 12, point.y + 12, false);
  popup.show();
  popup.focus();
  emitHotkey("popup", hotkey);
  cleanupClipboard(previous);
}

function toElectronAccelerator(value) {
  const keyMap = {
    ctrl: "CommandOrControl",
    control: "CommandOrControl",
    alt: "Alt",
    shift: "Shift",
    win: "Super",
    windows: "Super",
    meta: "Super",
    cmd: "Command",
    command: "Command",
    space: "Space",
    esc: "Esc",
    escape: "Esc",
  };
  return String(value || "")
    .split("+")
    .map((part) => {
      const trimmed = part.trim();
      return keyMap[trimmed.toLowerCase()] || trimmed.toUpperCase();
    })
    .filter(Boolean)
    .join("+");
}

function hotkeyId(value) {
  return String(value || "")
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => {
      if (part === "control") return "ctrl";
      if (["windows", "meta", "cmd", "command"].includes(part)) return "win";
      if (part === "escape") return "esc";
      return part;
    })
    .join("+");
}

function vkLabel(vkCode) {
  if (vkCode >= 0x41 && vkCode <= 0x5a) return String.fromCharCode(vkCode);
  if (vkCode >= 0x30 && vkCode <= 0x39) return String.fromCharCode(vkCode);
  if (vkCode >= 0x70 && vkCode <= 0x7b) return `F${vkCode - 0x6f}`;
  const labels = {
    0x08: "Backspace",
    0x09: "Tab",
    0x0d: "Enter",
    0x1b: "Esc",
    0x20: "Space",
    0x21: "PageUp",
    0x22: "PageDown",
    0x23: "End",
    0x24: "Home",
    0x25: "Left",
    0x26: "Up",
    0x27: "Right",
    0x28: "Down",
    0x2d: "Insert",
    0x2e: "Delete",
    0xbf: "/",
  };
  return labels[vkCode] || "";
}

function comboFromHook(vkCode, ctrl, alt, shift, win) {
  const key = vkLabel(vkCode);
  if (!key) return "";
  const parts = [];
  if (ctrl) parts.push("Ctrl");
  if (alt) parts.push("Alt");
  if (shift) parts.push("Shift");
  if (win) parts.push("Win");
  if (parts.length === 0 && !key.startsWith("F")) return "";
  parts.push(key);
  return parts.join(" + ");
}

function resetInlineTracker() {
  inlineTracker.buffer = "";
  inlineTracker.slashRun = 0;
  inlineTracker.openedAt = 0;
  inlineTracker.lastKeyAt = 0;
}

function charFromVk(vkCode, shift) {
  if (vkCode >= 0x41 && vkCode <= 0x5a) {
    const letter = String.fromCharCode(vkCode);
    return shift ? letter : letter.toLowerCase();
  }
  if (vkCode >= 0x30 && vkCode <= 0x39) {
    const shifted = {
      0x30: ")",
      0x31: "!",
      0x32: "@",
      0x33: "#",
      0x34: "$",
      0x35: "%",
      0x36: "^",
      0x37: "&",
      0x38: "*",
      0x39: "(",
    };
    return shift ? shifted[vkCode] : String.fromCharCode(vkCode);
  }
  const map = {
    0x20: " ",
    0xba: shift ? ":" : ";",
    0xbb: shift ? "+" : "=",
    0xbc: shift ? "<" : ",",
    0xbd: shift ? "_" : "-",
    0xbe: shift ? ">" : ".",
    0xbf: shift ? "?" : "/",
    0xc0: shift ? "~" : "`",
    0xdb: shift ? "{" : "[",
    0xdc: shift ? "|" : "\\",
    0xdd: shift ? "}" : "]",
    0xde: shift ? '"' : "'",
  };
  return map[vkCode] || "";
}

function shouldProbeInlineFromTracker(vkCode, ctrl, alt, shift, win) {
  if (ctrl || alt || win) {
    inlineTracker.lastKeyAt = Date.now();
    return false;
  }

  const now = Date.now();
  const previousBuffer = inlineTracker.buffer;
  inlineTracker.lastKeyAt = now;

  if (vkCode === 0x08) {
    inlineTracker.buffer = inlineTracker.buffer.slice(0, -1);
    inlineTracker.slashRun = 0;
    return false;
  }

  if ([0x09, 0x0d, 0x1b, 0x25, 0x26, 0x27, 0x28, 0x2e].includes(vkCode)) {
    resetInlineTracker();
    return false;
  }

  const char = charFromVk(vkCode, shift);
  if (!char) return false;

  inlineTracker.buffer += char;
  if (inlineTracker.buffer.length > 600) {
    inlineTracker.buffer = inlineTracker.buffer.slice(-600);
  }

  if (char === "/") {
    inlineTracker.slashRun += 1;
  } else {
    inlineTracker.slashRun = 0;
  }

  if (char !== "/" || !previousBuffer.includes("/") || inlineTracker.openedAt === 0) {
    if (char === "/" && inlineTracker.slashRun >= 1 && inlineTracker.slashRun <= 3) {
      inlineTracker.openedAt = now;
    }
    if (inlineTracker.slashRun > 3) {
      resetInlineTracker();
    }
    return false;
  }

  if (now - inlineTracker.openedAt > 120000) {
    resetInlineTracker();
    return false;
  }

  if (previousBuffer.endsWith("/")) {
    return false;
  }

  if (parseInlineBuffer(inlineTracker.buffer)) {
    resetInlineTracker();
    return true;
  }

  if (inlineTracker.slashRun > 3) {
    resetInlineTracker();
    return false;
  }

  const candidateMatch = inlineTracker.buffer.match(/\/{1,3}[A-Za-z0-9_-]*\s*\/$/);
  const commandThenMaybeSpace = Boolean(candidateMatch);
  if (commandThenMaybeSpace) {
    resetInlineTracker();
    return true;
  }

  return false;
}

async function handleHookHotkey(vkCode, ctrl, alt, shift, win) {
  if (hotkeyBusy) return;
  if ((mainWindow && mainWindow.isFocused()) || (floatingWindow && floatingWindow.isFocused())) return;

  const combo = comboFromHook(vkCode, ctrl, alt, shift, win);
  if (!combo) return;

  const settings = loadSettings();
  if (hotkeyId(combo) === hotkeyId(settings.popupHotkey)) {
    hotkeyBusy = true;
    try {
      await openFloatingMenu(settings.popupHotkey);
    } finally {
      setTimeout(() => {
        hotkeyBusy = false;
      }, 350);
    }
    return;
  }

  if (hotkeyId(combo) === hotkeyId(settings.ocrHotkey)) {
    hotkeyBusy = true;
    pushStatus(systemStatus, `Hotkey: OCR (${settings.ocrHotkey})`);
    emitHotkey("ocr", settings.ocrHotkey);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    setTimeout(() => {
      hotkeyBusy = false;
    }, 350);
  }
}

function registerHotkeys(settings = loadSettings()) {
  if (!app.isReady()) return;
  globalShortcut.unregisterAll();
  const popupAccelerator = toElectronAccelerator(settings.popupHotkey);
  if (popupAccelerator) {
    const ok = globalShortcut.register(popupAccelerator, () => openFloatingMenu(settings.popupHotkey));
    pushStatus(systemStatus, ok ? `Registered floating hotkey: ${settings.popupHotkey}` : `Failed to register floating hotkey: ${settings.popupHotkey}`);
  }

  const ocrAccelerator = toElectronAccelerator(settings.ocrHotkey);
  if (ocrAccelerator) {
    const ok = globalShortcut.register(ocrAccelerator, () => {
      pushStatus(systemStatus, `Hotkey: OCR (${settings.ocrHotkey})`);
      emitHotkey("ocr", settings.ocrHotkey);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    pushStatus(systemStatus, ok ? `Registered OCR hotkey: ${settings.ocrHotkey}` : `Failed to register OCR hotkey: ${settings.ocrHotkey}`);
  }
}

async function handleInlineSlashProbe() {
  if (inlineBusy) return;
  if ((mainWindow && mainWindow.isFocused()) || (floatingWindow && floatingWindow.isFocused())) return;

  const settings = loadSettings();
  if (!settings.inlineEnabled) return;
  inlineBusy = true;

  let originalClipboard = clipboard.readText();
  let selectedTextForError = "";
  let runningTextForError = "";
  let parsedForError = null;
  try {
    pushStatus(inlineStatus, "Inline slash probe");
    const extraction = await selectAllAndCopyFocusedText();
    originalClipboard = extraction.previous;
    selectedTextForError = extraction.selected;
    const parsed = parseInlineBuffer(extraction.selected);
    parsedForError = parsed;
    if (!parsed) {
      await sendKeys("{RIGHT}");
      cleanupClipboard(originalClipboard);
      return;
    }

    const command = settings.commands.find((item) => item.enabled && item.name === parsed.command);
    if (!command) {
      pushStatus(inlineStatus, `Inline command disabled or missing: //${parsed.command}`);
      await sendKeys("{RIGHT}");
      cleanupClipboard(originalClipboard);
      return;
    }

    const runningText = replaceLast(extraction.selected, parsed.fullText, INLINE_RUNNING_MARKER);
    if (!runningText) {
      pushStatus(inlineStatus, "Inline replace failed: command text not found");
      await sendKeys("{RIGHT}");
      cleanupClipboard(originalClipboard);
      return;
    }

    const profile = profileForTier(settings, parsed.modelTier);
    const profileSettings = settingsForProfile(settings, profile);
    pushStatus(inlineStatus, `Inline running: ${parsed.prefix}${parsed.command} (${parsed.modelTier}: ${profile.provider} / ${profile.model})`);
    await pasteText(runningText);
    runningTextForError = runningText;

    const output = await runAi(command.action, command.prompt, parsed.content, profileSettings, profile.model, profile.provider);
    const finalText = replaceLast(runningText, INLINE_RUNNING_MARKER, output) || output;
    await sendKeys("^a");
    await delay(100);
    await pasteText(finalText);
    pushStatus(inlineStatus, "Inline done");
    cleanupClipboard(originalClipboard);
  } catch (error) {
    pushStatus(inlineStatus, `Inline failed: ${error.message}`);
    const errorText = "[TextSpeed error!]";
    const finalText = runningTextForError
      ? replaceLast(runningTextForError, INLINE_RUNNING_MARKER, errorText)
      : parsedForError && selectedTextForError
        ? replaceLast(selectedTextForError, parsedForError.fullText, errorText)
        : errorText;
    try {
      await sendKeys("^a");
      await delay(100);
      await pasteText(finalText || errorText);
    } catch (pasteError) {
      pushStatus(inlineStatus, `Inline error display failed: ${pasteError.message}`);
    }
    cleanupClipboard(originalClipboard);
  } finally {
    await delay(150);
    inlineBusy = false;
  }
}

function startKeyboardHook() {
  if (keyboardHook) return;
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$source = @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class TextSpeedKeyboardHook {
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYUP = 0x0101;
  private const int VK_CONTROL = 0x11;
  private const int VK_MENU = 0x12;
  private const int VK_SHIFT = 0x10;
  private const int VK_LWIN = 0x5B;
  private const int VK_RWIN = 0x5C;
  private static LowLevelKeyboardProc proc = HookCallback;
  private static IntPtr hookID = IntPtr.Zero;

  public static void Run() {
    hookID = SetHook(proc);
    Application.Run();
    UnhookWindowsHookEx(hookID);
  }

  private static IntPtr SetHook(LowLevelKeyboardProc proc) {
    using (Process curProcess = Process.GetCurrentProcess())
    using (ProcessModule curModule = curProcess.MainModule) {
      return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(curModule.ModuleName), 0);
    }
  }

  private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

  private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0 && wParam == (IntPtr)WM_KEYUP) {
      int vkCode = Marshal.ReadInt32(lParam);
      bool ctrl = IsDown(VK_CONTROL);
      bool alt = IsDown(VK_MENU);
      bool shift = IsDown(VK_SHIFT);
      bool win = IsDown(VK_LWIN) || IsDown(VK_RWIN);
      Console.WriteLine("KEYUP|" + vkCode + "|" + (ctrl ? "1" : "0") + "|" + (alt ? "1" : "0") + "|" + (shift ? "1" : "0") + "|" + (win ? "1" : "0"));
      Console.Out.Flush();
    }
    return CallNextHookEx(hookID, nCode, wParam, lParam);
  }

  private static bool IsDown(int vkCode) {
    return (GetAsyncKeyState(vkCode) & 0x8000) != 0;
  }

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool UnhookWindowsHookEx(IntPtr hhk);
  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr GetModuleHandle(string lpModuleName);
  [DllImport("user32.dll")]
  private static extern short GetAsyncKeyState(int vKey);
}
"@
Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms
[TextSpeedKeyboardHook]::Run()
`;
  keyboardHook = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
  });
  keyboardHook.stdout.on("data", (chunk) => {
    String(chunk)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        if (line.startsWith("KEYUP|")) {
          const [, vk, ctrl, alt, shift, win] = line.split("|");
          const vkCode = Number(vk);
          const ctrlDown = ctrl === "1";
          const altDown = alt === "1";
          const shiftDown = shift === "1";
          const winDown = win === "1";
          if (shouldProbeInlineFromTracker(vkCode, ctrlDown, altDown, shiftDown, winDown)) {
            handleInlineSlashProbe();
          }
          handleHookHotkey(
            vkCode,
            ctrlDown,
            altDown,
            shiftDown,
            winDown,
          );
        }
      });
  });
  keyboardHook.stderr.on("data", (chunk) => pushStatus(inlineStatus, `Hook error: ${String(chunk).trim()}`));
  keyboardHook.on("exit", (code) => {
    pushStatus(inlineStatus, `Keyboard hook stopped: ${code}`);
    keyboardHook = undefined;
  });
  pushStatus(inlineStatus, "Keyboard hook listening for /");
}

ipcMain.handle("get_settings", () => loadSettings());
ipcMain.handle("save_settings", (_event, payload) => saveSettings(payload.settings));
ipcMain.handle("read_clipboard_text", () => clipboard.readText());
ipcMain.handle("write_clipboard_text", (_event, payload) => clipboard.writeText(payload.text || ""));
ipcMain.handle("hide_main_window", () => hideToTray());
ipcMain.handle("hide_floating_window", () => floatingWindow?.hide());
ipcMain.handle("parse_inline_buffer", (_event, payload) => parseInlineBuffer(payload.buffer));
ipcMain.handle("execute_inline_command", async (_event, payload) => {
  const settings = loadSettings();
  const parsed = parseInlineBuffer(payload.buffer);
  if (!parsed || !settings.inlineEnabled) return null;
  const command = settings.commands.find((item) => item.enabled && item.name === parsed.command);
  if (!command) return null;
  const profile = profileForTier(settings, parsed.modelTier);
  const profileSettings = settingsForProfile(settings, profile);
  const output = await runAi(command.action, command.prompt, parsed.content, profileSettings, profile.model, profile.provider);
  return { command: parsed.command, action: command.action, input: parsed.content, output, model: profile.model, modelTier: parsed.modelTier, typedLength: parsed.fullText.length };
});
ipcMain.handle("run_ai_action", async (_event, payload) => {
  const settings = loadSettings();
  return runAi(payload.action, "", payload.text, settings);
});
ipcMain.handle("test_provider", async (_event, payload) => {
  const settings = normalizeSettings({ ...fallbackSettings, ...(payload.settings || {}) });
  const profile = payload.tier ? profileForTier(settings, payload.tier) : profileForTier(settings, "balanced");
  const profileSettings = settingsForProfile(settings, profile);
  const output = await runAi(
    "explain",
    "Provider connectivity test. Reply with only this exact text if the provider works: TextSpeed provider OK",
    "TextSpeed provider connectivity test",
    profileSettings,
    profile.model,
    profile.provider,
  );
  return output || "TextSpeed provider OK";
});
ipcMain.handle("run_floating_action", async (_event, payload) => {
  const settings = loadSettings();
  const action = settings.floatingActions.find((item) => item.enabled && item.id === payload.actionId);
  if (!action) throw new Error(`Floating action disabled or missing: ${payload.actionId}`);
  return runAi(action.action, action.prompt, payload.text, settings);
});
ipcMain.handle("get_model_ids", async (_event, payload) => {
  const settings = normalizeSettings(payload.settings || loadSettings());
  const profile = payload.tier ? profileForTier(settings, payload.tier) : profileForTier(settings, "balanced");
  const profileSettings = settingsForProfile(settings, profile);
  if (profile.provider === "claude") {
    return [
      "claude-3-5-haiku-latest",
      "claude-3-5-sonnet-latest",
      "claude-sonnet-4-5",
      "claude-opus-4-1",
    ];
  }
  if (profile.provider === "custom") {
    const key = profileSettings.customApiKey || process.env.TEXTSPEED_CUSTOM_API_KEY;
    if (!key) throw new Error("Custom provider API key is not set");
    const baseUrl = normalizeBaseUrl(profileSettings.customBaseUrl);
    if (!baseUrl) throw new Error("Custom provider base URL is not set");
    const response = await fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${key}` } });
    const value = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(value));
    return (value.data || value.models || []).map((model) => String(model.id || model.name || "").replace(/^models\//, "")).filter(Boolean);
  }
  if (profile.provider === "gemini") {
    const key = profileSettings.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const value = await response.json();
    return (value.models || []).map((model) => String(model.name || "").replace(/^models\//, "")).filter(Boolean);
  }
  const key = profileSettings.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const response = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } });
  const value = await response.json();
  return (value.data || []).map((model) => model.id).filter(Boolean);
});
ipcMain.handle("get_runtime_status", () => ({
  system: systemStatus,
  inline: inlineStatus,
}));

app.whenReady().then(() => {
  createWindow();
  createTray();
  registerHotkeys(loadSettings());
  startKeyboardHook();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (keyboardHook && !keyboardHook.killed) keyboardHook.kill();
});
