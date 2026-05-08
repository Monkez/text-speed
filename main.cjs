const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

let mainWindow;
let floatingWindow;
let keyboardHook;
let inlineBusy = false;
let hotkeyBusy = false;
const systemStatus = ["Electron shell ready"];
const inlineStatus = ["Inline hook starting"];
const INLINE_RUNNING_MARKER = "[TextSpeed running...]";

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
  registerHotkeys(next);
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
    icon: path.join(__dirname, "build", "icon.ico"),
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
    icon: path.join(__dirname, "build", "icon.ico"),
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
  try {
    pushStatus(inlineStatus, "Inline slash probe");
    const extraction = await selectAllAndCopyFocusedText();
    originalClipboard = extraction.previous;
    const parsed = parseInlineBuffer(extraction.selected);
    if (!parsed) {
      cleanupClipboard(originalClipboard);
      return;
    }

    const command = settings.commands.find((item) => item.enabled && item.name === parsed.command);
    if (!command) {
      pushStatus(inlineStatus, `Inline command disabled or missing: //${parsed.command}`);
      cleanupClipboard(originalClipboard);
      return;
    }

    const runningText = replaceLast(extraction.selected, parsed.fullText, INLINE_RUNNING_MARKER);
    if (!runningText) {
      pushStatus(inlineStatus, "Inline replace failed: command text not found");
      cleanupClipboard(originalClipboard);
      return;
    }

    pushStatus(inlineStatus, `Inline running: //${parsed.command}`);
    await pasteText(runningText);

    const output = await runAi(command.action, command.prompt, parsed.content, settings);
    const finalText = replaceLast(runningText, INLINE_RUNNING_MARKER, output) || output;
    await sendKeys("^a");
    await delay(100);
    await pasteText(finalText);
    pushStatus(inlineStatus, "Inline done");
    cleanupClipboard(originalClipboard);
  } catch (error) {
    pushStatus(inlineStatus, `Inline failed: ${error.message}`);
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
  private const int VK_OEM_2 = 0xBF;
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
      if (vkCode == VK_OEM_2) {
        Console.WriteLine("SLASH");
      }
      bool ctrl = IsDown(VK_CONTROL);
      bool alt = IsDown(VK_MENU);
      bool shift = IsDown(VK_SHIFT);
      bool win = IsDown(VK_LWIN) || IsDown(VK_RWIN);
      if (ctrl || alt || shift || win || (vkCode >= 0x70 && vkCode <= 0x7B)) {
        Console.WriteLine("KEYUP|" + vkCode + "|" + (ctrl ? "1" : "0") + "|" + (alt ? "1" : "0") + "|" + (shift ? "1" : "0") + "|" + (win ? "1" : "0"));
      }
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
        if (line === "SLASH") handleInlineSlashProbe();
        if (line.startsWith("KEYUP|")) {
          const [, vk, ctrl, alt, shift, win] = line.split("|");
          handleHookHotkey(
            Number(vk),
            ctrl === "1",
            alt === "1",
            shift === "1",
            win === "1",
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
ipcMain.handle("hide_main_window", () => mainWindow?.hide());
ipcMain.handle("hide_floating_window", () => floatingWindow?.hide());
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
  system: systemStatus,
  inline: inlineStatus,
}));

app.whenReady().then(() => {
  createWindow();
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
