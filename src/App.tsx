import {
  Bot,
  Check,
  Clipboard,
  Command,
  Copy,
  CopyCheck,
  Cpu,
  FileText,
  Globe2,
  Keyboard,
  Languages,
  MessageSquareReply,
  Minimize2,
  Plus,
  RefreshCw,
  MousePointer2,
  Save,
  ScanText,
  Settings,
  Sparkles,
  TimerReset,
  Trash2,
  Wand2,
  X,
  Zap,
  TerminalSquare,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  type Dispatch,
  type InputHTMLAttributes,
  type SetStateAction,
  type TextareaHTMLAttributes,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fallbackSettings } from "./data/fallback";
import {
  type AiAction,
  type AppSettings,
  type FloatingAction,
  type InlineCommand,
  executeInlineCommand,
  getModelIds,
  getRuntimeStatus,
  getSettings,
  hideFloatingWindow,
  hideMainWindow,
  listenTextSpeedEvent,
  parseInlineBuffer,
  readClipboardText,
  runFloatingAction,
  saveSettings,
  testProvider,
  writeClipboardText,
} from "./lib/tauri";

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: Sparkles },
  { id: "general", label: "General Settings", icon: Settings },
  { id: "providers", label: "AI Providers", icon: Bot },
  { id: "commands", label: "Commands", icon: Command },
  { id: "hotkeys", label: "Hotkeys", icon: Keyboard },
  { id: "ocr", label: "OCR", icon: ScanText },
  { id: "logs", label: "Logs", icon: TerminalSquare },
];

const pageCopy: Record<string, { title: string; description: string }> = {
  dashboard: {
    title: "Dashboard",
    description: "Tổng quan trạng thái TextSpeed và các workflow nhập liệu nhanh.",
  },
  providers: {
    title: "AI Providers",
    description: "Cấu hình OpenAI, Gemini, model và API key dùng cho mọi lệnh AI.",
  },
  general: {
    title: "General Settings",
    description: "Cấu hình ngôn ngữ, hành vi chung và mặc định không phụ thuộc provider.",
  },
  commands: {
    title: "Commands",
    description: "Quản lý lệnh gõ tắt, prompt cá nhân hóa và test inline execution ngay khi gõ /.",
  },
  hotkeys: {
    title: "Hotkeys",
    description: "Cấu hình phím tắt cho floating menu, OCR và thao tác nhanh.",
  },
  ocr: {
    title: "OCR",
    description: "Chuẩn bị workflow khoanh vùng màn hình, nhận diện chữ và xử lý AI.",
  },
  logs: {
    title: "Runtime Logs",
    description: "Chi tiết các hoạt động, lỗi và trạng thái thực thi của hệ thống thời gian thực.",
  },
};

const actions: Array<{ id: AiAction; label: string; icon: typeof Languages; hint: string }> = [
  { id: "translate", label: "Translate", icon: Languages, hint: "Dịch sang ngôn ngữ ưu tiên" },
  { id: "summarize", label: "Summarize", icon: FileText, hint: "Tóm tắt ý chính" },
  { id: "reply", label: "Reply", icon: MessageSquareReply, hint: "Trả lời ngắn trực tiếp" },
  { id: "explain", label: "Explain", icon: Wand2, hint: "Giải thích thuật ngữ hoặc mã" },
];

const actionOptions: AiAction[] = ["translate", "fix", "professional", "mail", "summarize", "reply", "explain"];

const actionMeta: Record<AiAction, { icon: typeof Languages; hint: string }> = {
  translate: { icon: Languages, hint: "Auto A ↔ B" },
  summarize: { icon: FileText, hint: "Key points" },
  reply: { icon: MessageSquareReply, hint: "Short reply" },
  explain: { icon: Wand2, hint: "Explain" },
  fix: { icon: Check, hint: "Fix text" },
  professional: { icon: Sparkles, hint: "Polish" },
  mail: { icon: Clipboard, hint: "Email" },
};

function defaultModelsForProvider(provider: AppSettings["provider"]) {
  return provider === "openai"
    ? { fastModel: "gpt-4.1-mini", balancedModel: "gpt-4.1-mini", powerfulModel: "gpt-4.1", model: "gpt-4.1-mini" }
    : { fastModel: "gemini-2.5-flash-lite", balancedModel: "gemini-2.5-flash", powerfulModel: "gemini-2.5-pro", model: "gemini-2.5-flash" };
}

function App() {
  const isFloatingWindow = new URLSearchParams(window.location.search).get("window") === "floating";
  return isFloatingWindow ? <FloatingWindowApp /> : <MainApp />;
}

function MainApp() {
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const [savedSettings, setSavedSettings] = useState<AppSettings>(fallbackSettings);
  const [activeNav, setActiveNav] = useState("dashboard");
  const [selectedFloatingActionId, setSelectedFloatingActionId] = useState("translate");
  const [selectedText, setSelectedText] = useState(
    "Can you send me the final deck before tomorrow morning? I need to review the timeline and budget.",
  );
  const [result, setResult] = useState("Bản dịch và phản hồi AI sẽ xuất hiện tại đây.");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{system: string[], inline: string[]}>({system: ["Đang khởi tạo TextSpeed"], inline: []});
  const [inlineBuffer, setInlineBuffer] = useState("//pro gửi file cho anh nhé/ ");
  const [inlinePreview, setInlinePreview] = useState("Chưa nhận diện lệnh.");
  const [inlineResult, setInlineResult] = useState("Kết quả inline sẽ xuất hiện sau khi bấm Execute Inline.");
  const [saveState, setSaveState] = useState("Saved");
  const [providerTestState, setProviderTestState] = useState("Not tested");
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [modelFetchState, setModelFetchState] = useState("Not loaded");
  const [recordingHotkey, setRecordingHotkey] = useState<HotkeyTarget | null>(null);
  const [hotkeyApplyState, setHotkeyApplyState] = useState("Applied");
  const [hotkeyPopupOpen, setHotkeyPopupOpen] = useState(false);
  const [hotkeyPopupSource, setHotkeyPopupSource] = useState("");
  const activePage = pageCopy[activeNav] ?? pageCopy.dashboard;
  const enabledCommands = useMemo(() => settings.commands.filter((item) => item.enabled), [settings.commands]);
  const enabledFloatingActions = useMemo(
    () => settings.floatingActions.filter((item) => item.enabled),
    [settings.floatingActions],
  );
  const activeProviderReady =
    settings.provider === "openai" ? Boolean(settings.openaiApiKey.trim()) : Boolean(settings.geminiApiKey.trim());
  const inlineReady = settings.inlineEnabled && enabledCommands.length > 0;
  const settingsDirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [settings, savedSettings],
  );
  const saveButtonLabel = saveState === "Saving" ? "Saving" : settingsDirty ? "Save" : "Saved";

  useEffect(() => {
    document.body.classList.add("floating-window-body");
    getSettings()
      .then((loaded) => {
        setSettings(loaded);
        setSavedSettings(loaded);
        setSaveState("Saved");
      })
      .catch(() => {
        setSettings(fallbackSettings);
        setSavedSettings(fallbackSettings);
      });
    getRuntimeStatus().then(setStatus).catch(() => setStatus({system: ["UI ready", "Rust runtime chưa phản hồi"], inline: []}));
    const statusTimer = window.setInterval(() => {
      getRuntimeStatus().then(setStatus).catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(statusTimer);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listenTextSpeedEvent<{ action: "popup" | "ocr"; hotkey: string }>("textspeed-hotkey", async (event) => {
      if (event.payload.action === "ocr") {
        setActiveNav("ocr");
        setHotkeyPopupOpen(false);
        return;
      }

      setActiveNav("dashboard");
      setHotkeyPopupSource(event.payload.hotkey);
      setHotkeyPopupOpen(false);

      try {
        const text = await readClipboardText();
        if (text.trim()) {
          setSelectedText(text);
        }
      } catch {
        // Tauri event bridge is unavailable in browser preview.
      }
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => undefined);

    return () => {
      document.body.classList.remove("floating-window-body");
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!hotkeyPopupOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setHotkeyPopupOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [hotkeyPopupOpen]);

  useEffect(() => {
    parseInlineBuffer(inlineBuffer)
      .then((match) => {
        if (!match) {
          setInlinePreview("Gõ /function nội dung/ cho model nhanh, //function nội dung/ cho model trung bình, ///function nội dung/ cho model mạnh.");
          return;
        }
        setInlinePreview(`Nhận diện ${match.prefix}${match.command} (${match.modelTier}): "${match.content}"`);
      })
      .catch(() => setInlinePreview("Parser chỉ hoạt động trong Tauri runtime."));
  }, [inlineBuffer]);

  useEffect(() => {
    setProviderTestState("Not tested");
  }, [settings.provider, settings.model, settings.fastModel, settings.balancedModel, settings.powerfulModel, settings.openaiApiKey, settings.geminiApiKey]);

  async function handleFloatingAction(actionId: string) {
    const actionConfig = settings.floatingActions.find((item) => item.id === actionId);
    if (!actionConfig) return;

    setBusy(true);
    setSelectedFloatingActionId(actionId);
    try {
      const response = await runFloatingAction(actionId, selectedText);
      setResult(response);
    } catch {
      setResult(localFallback(actionConfig.action, selectedText, settings.translationLanguageA, settings.translationLanguageB, settings.preferredLanguage));
    } finally {
      setBusy(false);
    }
  }

  async function handleExecuteInline() {
    setBusy(true);
    try {
      const execution = await executeInlineCommand(inlineBuffer);
      if (!execution) {
        setInlineResult("Không có lệnh hợp lệ hoặc lệnh đang bị tắt.");
        return;
      }
      setSelectedText(execution.input);
      setResult(execution.output);
      setInlineResult(`${execution.modelTier} · ${execution.model}\n${execution.output}`);
    } catch {
      const fallback = localFallback("professional", "gửi file cho anh nhé", settings.translationLanguageA, settings.translationLanguageB, settings.preferredLanguage);
      setResult(fallback);
      setInlineResult(`Browser preview fallback:\n${fallback}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setSaveState("Saving");
    try {
      const saved = await saveSettings(settings);
      setSettings(saved);
      setSavedSettings(saved);
      getRuntimeStatus().then(setStatus).catch(() => undefined);
      setSaveState("Saved");
    } catch {
      setSaveState("Save failed");
    }
  }

  async function handleTestProvider() {
    setProviderTestState("Testing");
    try {
      const response = await testProvider(settings);
      const compact = response.trim().replace(/\s+/g, " ");
      setProviderTestState(compact || "Provider responded");
      setResult(compact || "Provider responded");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider test failed";
      setProviderTestState(message);
      setResult(`Provider test failed: ${message}`);
    }
  }

  async function handleFetchModelIds() {
    setModelFetchState("Loading");
    try {
      const ids = await getModelIds(settings);
      setModelIds(ids);
      setModelFetchState(ids.length ? `${ids.length} models loaded` : "No models returned");
    } catch (error) {
      setModelIds([]);
      setModelFetchState(error instanceof Error ? error.message : "Load failed");
    }
  }

  function updateHotkey(target: HotkeyTarget, value: string) {
    setHotkeyApplyState("Pending");
    setSettings((current) => ({
      ...current,
      [target === "popup" ? "popupHotkey" : "ocrHotkey"]: value,
    }));
  }

  async function handleApplyHotkeys() {
    const validation = validateHotkeys(settings.popupHotkey, settings.ocrHotkey);
    if (validation) {
      setHotkeyApplyState("Fix required");
      return;
    }

    setHotkeyApplyState("Applying");
    try {
      const saved = await saveSettings({
        ...settings,
        popupHotkey: normalizeHotkeyText(settings.popupHotkey),
        ocrHotkey: normalizeHotkeyText(settings.ocrHotkey),
      });
      setSettings(saved);
      setSavedSettings(saved);
      getRuntimeStatus().then(setStatus).catch(() => undefined);
      setHotkeyApplyState("Applied");
      setSaveState("Saved");
    } catch {
      setHotkeyApplyState("Apply failed");
    }
  }

  async function handleHideToTray() {
    try {
      await hideMainWindow();
    } catch {
      setSaveState("Tray failed");
    }
  }

  function updateModelField(field: "fastModel" | "balancedModel" | "powerfulModel", value: string) {
    setSettings((current) => ({
      ...current,
      [field]: value,
      model: field === "balancedModel" ? value : current.model,
    }));
  }

  function renderModelField(field: "fastModel" | "balancedModel" | "powerfulModel", label: string, hint: string) {
    const value = settings[field] || settings.model;
    return (
      <label className="field">
        <span>{label}</span>
        {modelIds.length > 0 ? (
          <select value={value} onChange={(event) => updateModelField(field, event.target.value)}>
            {!modelIds.includes(value) && <option value={value}>{value}</option>}
            {modelIds.map((modelId) => (
              <option key={`${field}-${modelId}`} value={modelId}>
                {modelId}
              </option>
            ))}
          </select>
        ) : (
          <ImeInput value={value} onValueChange={(next) => updateModelField(field, next)} />
        )}
        <small className="field-help">{hint}</small>
      </label>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#0d0d0d] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_14%,rgba(20,184,166,0.16),transparent_28%),radial-gradient(circle_at_78%_8%,rgba(99,102,241,0.14),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.035),transparent_45%)]" />
      <div className="app-shell relative grid min-h-screen grid-cols-[248px_1fr]">
        <aside className="side-nav flex flex-col border-r border-white/10 bg-black/35 px-4 py-5 backdrop-blur-xl">
          <div className="mb-7 flex items-center gap-3 px-2">
            <div className="grid size-10 place-items-center rounded-lg border border-teal-300/30 bg-teal-300/10 text-teal-200 shadow-[0_0_28px_rgba(45,212,191,0.18)]">
              <Zap size={19} />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-normal">TextSpeed</div>
              <div className="text-xs text-zinc-500">AI Smart Typist</div>
            </div>
          </div>
          <nav className="flex-1 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  className={`nav-item ${active ? "nav-item-active" : ""}`}
                  onClick={() => setActiveNav(item.id)}
                  type="button"
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="side-nav-actions">
            <button className="tray-nav-button" onClick={handleHideToTray} title="Hide TextSpeed to system tray" type="button">
              <Minimize2 size={16} />
              <span>Tray</span>
            </button>
          </div>
        </aside>

        <section className="app-main grid min-h-screen grid-rows-[72px_minmax(0,1fr)] overflow-hidden">
          <header className="topbar flex items-center justify-between border-b border-white/10 px-7 backdrop-blur-xl">
            <div>
              <h1 className="text-xl font-semibold tracking-normal">{activePage.title}</h1>
              <p className="text-sm text-zinc-500">{activePage.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={`${settingsDirty || saveState === "Save failed" ? "ghost-button save-button-unsaved" : "primary-button save-button-saved"}`}
                disabled={saveState === "Saving"}
                onClick={handleSave}
                type="button"
              >
                <Save size={16} />
                {saveState === "Save failed" ? "Save failed" : saveButtonLabel}
              </button>
            </div>
          </header>

          <div className={`content-grid content-scroll ${activeNav === "commands" || activeNav === "logs" ? "content-grid-wide" : ""} grid grid-cols-[minmax(0,1fr)_390px] gap-5 p-6`}>
            {activeNav !== "logs" && (
            <div className="space-y-5">
              {activeNav === "dashboard" && (
                <>
                <section className="metric-grid">
                  <div className="metric-card">
                    <span>Provider</span>
                    <strong>{activeProviderReady ? "Ready" : "Needs API key"}</strong>
                    <small>{settings.provider === "openai" ? "OpenAI" : "Gemini"} · / {settings.fastModel} · // {settings.balancedModel} · /// {settings.powerfulModel}</small>
                  </div>
                  <div className="metric-card">
                    <span>Translate Pair</span>
                    <strong>{settings.translationLanguageA} ↔ {settings.translationLanguageB}</strong>
                    <small>Outside pair → {settings.preferredLanguage}</small>
                  </div>
                  <div className="metric-card">
                    <span>Inline</span>
                    <strong>{inlineReady ? "Ready" : settings.inlineEnabled ? "No active command" : "Disabled"}</strong>
                    <small>{enabledCommands.length} active commands · / // /// model tiers</small>
                  </div>
                  <div className="metric-card">
                    <span>Floating Menu</span>
                    <strong>{settings.popupHotkey}</strong>
                    <small>{enabledFloatingActions.length || actions.length} configurable actions</small>
                  </div>
                  <div className="metric-card">
                    <span>OCR</span>
                    <strong>Roadmap</strong>
                    <small>Snipping/OCR native module is not wired yet</small>
                  </div>
                </section>
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>Quick Setup</h2>
                      <p>Đi thẳng tới nhóm cấu hình cần chỉnh, không lặp lại toàn bộ form ở Dashboard.</p>
                    </div>
                  </div>
                  <div className="quick-grid">
                    <button className="provider-card" onClick={() => setActiveNav("general")} type="button">
                      <Settings size={18} />
                      <span>General Settings</span>
                      <small>Language pair, fallback target</small>
                    </button>
                    <button className="provider-card" onClick={() => setActiveNav("providers")} type="button">
                      <Bot size={18} />
                      <span>AI Providers</span>
                      <small>API key, model, provider</small>
                    </button>
                    <button className="provider-card" onClick={() => setActiveNav("commands")} type="button">
                      <Command size={18} />
                      <span>Commands</span>
                      <small>Prompt, action, inline parser</small>
                    </button>
                    <button className="provider-card" onClick={() => setActiveNav("hotkeys")} type="button">
                      <Keyboard size={18} />
                      <span>Hotkeys</span>
                      <small>Floating menu và OCR snip</small>
                    </button>
                    <button className="provider-card" onClick={() => setActiveNav("ocr")} type="button">
                      <ScanText size={18} />
                      <span>OCR</span>
                      <small>Roadmap, hotkey and pipeline notes</small>
                    </button>
                  </div>
                </section>
                </>
              )}

              {activeNav === "general" && (
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>General Settings</h2>
                      <p>Ngôn ngữ và các mặc định dùng chung, tách riêng khỏi provider/model/API key.</p>
                    </div>
                    <span className="status-pill">Saved with app settings</span>
                  </div>

                  <section className="translation-card">
                    <div className="translation-card-head">
                      <div>
                        <span>Translation Pair</span>
                        <strong>{settings.translationLanguageA} ↔ {settings.translationLanguageB}</strong>
                        <small>Outside pair → {settings.preferredLanguage}</small>
                      </div>
                      <Languages size={18} />
                    </div>
                    <p>
                      Nếu input thuộc Language A hoặc B, TextSpeed dịch sang ngôn ngữ còn lại. Nếu input nằm ngoài cặp này, TextSpeed dịch sang Preferred target.
                    </p>
                    <div className="translation-pair">
                      <label className="field">
                        <span>Language A</span>
                        <ImeInput
                          placeholder="Tiếng Việt"
                          value={settings.translationLanguageA}
                          onValueChange={(value) => setSettings({ ...settings, translationLanguageA: value })}
                        />
                      </label>
                      <label className="field">
                        <span>Language B</span>
                        <ImeInput
                          placeholder="English"
                          value={settings.translationLanguageB}
                          onValueChange={(value) => setSettings({ ...settings, translationLanguageB: value })}
                        />
                      </label>
                    </div>
                    <label className="field preferred-language-field">
                      <span>Preferred target when outside pair</span>
                      <ImeInput
                        placeholder="Tiếng Việt"
                        value={settings.preferredLanguage}
                        onValueChange={(value) => setSettings({ ...settings, preferredLanguage: value })}
                      />
                      <small className="field-help">
                        Ví dụ: input tiếng Pháp với cặp Tiếng Việt ↔ English sẽ được dịch sang {settings.preferredLanguage || "ngôn ngữ này"}.
                      </small>
                    </label>
                  </section>
                </section>
              )}

              {activeNav === "providers" && (
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>AI Providers</h2>
                    <p>Chọn engine nhanh cho inline command và floating actions.</p>
                  </div>
                  <span className={`status-pill ${activeProviderReady ? "" : "status-pill-warn"}`}>
                    {activeProviderReady ? "Ready" : "API key required"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(["openai", "gemini"] as const).map((provider) => (
                    <button
                      key={provider}
                      className={`provider-card ${settings.provider === provider ? "provider-card-active" : ""}`}
                      onClick={() => {
                        setModelIds([]);
                        setModelFetchState("Not loaded");
                        setSettings((current) => ({
                          ...current,
                          provider,
                          ...defaultModelsForProvider(provider),
                        }));
                      }}
                      type="button"
                    >
                      <Globe2 size={19} />
                      <span>{provider === "openai" ? "OpenAI" : "Gemini"}</span>
                      <small>{provider === "openai" ? "Fast text actions" : "Low latency multimodal"}</small>
                    </button>
                  ))}
                </div>

                <div className="mt-4">
                  <div className="model-tier-head">
                    <div>
                      <h3>Inline model tiers</h3>
                      <p>/ gọi model nhanh, // gọi model trung bình, /// gọi model mạnh.</p>
                    </div>
                    <button
                      className="ghost-button model-fetch-button"
                      disabled={!activeProviderReady || modelFetchState === "Loading"}
                      onClick={handleFetchModelIds}
                      type="button"
                    >
                      <RefreshCw size={15} className={modelFetchState === "Loading" ? "spin-icon" : ""} />
                      Get model IDs
                    </button>
                  </div>
                  <div className="model-tier-grid">
                    {renderModelField("fastModel", "Fast · /function", "Dùng cho lệnh nhẹ cần phản hồi nhanh.")}
                    {renderModelField("balancedModel", "Balanced · //function", "Mặc định cho floating actions và test provider.")}
                    {renderModelField("powerfulModel", "Powerful · ///function", "Dùng cho tác vụ khó, cần chất lượng cao hơn.")}
                  </div>
                  <small
                    className={
                      modelFetchState.toLowerCase().includes("error") ||
                      modelFetchState.toLowerCase().includes("failed")
                        ? "field-error"
                        : "field-help"
                    }
                  >
                    {activeProviderReady ? modelFetchState : "Add the active provider API key first"}
                  </small>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="field">
                    <span>OpenAI API key</span>
                    <ImeInput
                      autoComplete="off"
                      placeholder="sk-..."
                      type="password"
                      value={settings.openaiApiKey}
                      onValueChange={(value) => {
                        setModelIds([]);
                        setModelFetchState("Not loaded");
                        setSettings({ ...settings, openaiApiKey: value });
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Gemini API key</span>
                    <ImeInput
                      autoComplete="off"
                      placeholder="AIza..."
                      type="password"
                      value={settings.geminiApiKey}
                      onValueChange={(value) => {
                        setModelIds([]);
                        setModelFetchState("Not loaded");
                        setSettings({ ...settings, geminiApiKey: value });
                      }}
                    />
                  </label>
                </div>
              </section>
              )}

              {activeNav === "commands" && (
                <>
                  <CommandsPanel
                    inlineBuffer={inlineBuffer}
                    inlinePreview={inlinePreview}
                    inlineResult={inlineResult}
                    onExecuteInline={handleExecuteInline}
                    setInlineBuffer={setInlineBuffer}
                    setInlineResult={setInlineResult}
                    setSettings={setSettings}
                    onSettingsSaved={setSavedSettings}
                    setStatus={setStatus}
                    settings={settings}
                  />
                  <FloatingActionsPanel
                    onSettingsSaved={setSavedSettings}
                    setSettings={setSettings}
                    setStatus={setStatus}
                    settings={settings}
                  />
                </>
              )}

              {activeNav === "hotkeys" && (
              <section className="panel hotkey-workbench">
                <div className="section-heading">
                  <div>
                    <h2>Hotkey Settings</h2>
                    <p>Bấm Record, nhấn tổ hợp phím mới, rồi Apply để hook Rust dùng ngay cấu hình vừa đổi.</p>
                  </div>
                  <div className="command-toolbar">
                    <span className={`status-pill ${hotkeyApplyState === "Pending" || hotkeyApplyState === "Fix required" ? "status-pill-warn" : ""}`}>
                      {hotkeyApplyState}
                    </span>
                    <button className="primary-button" disabled={Boolean(validateHotkeys(settings.popupHotkey, settings.ocrHotkey))} onClick={handleApplyHotkeys} type="button">
                      <Check size={16} />
                      Apply
                    </button>
                  </div>
                </div>

                <div className="hotkey-grid">
                  <HotkeyRecorder
                    description="Mở TextSpeed nhanh để xử lý đoạn text đã chọn bằng Translate, Summarize, Reply hoặc Explain."
                    icon={MousePointer2}
                    isRecording={recordingHotkey === "popup"}
                    label="Floating action menu"
                    onChange={(value) => updateHotkey("popup", value)}
                    onRecordingChange={(recording) => setRecordingHotkey(recording ? "popup" : null)}
                    value={settings.popupHotkey}
                  />
                  <HotkeyRecorder
                    description="Chuẩn bị cho workflow khoanh vùng màn hình. Hotkey được lưu sẵn, OCR native vẫn nằm trong roadmap."
                    icon={ScanText}
                    isRecording={recordingHotkey === "ocr"}
                    label="OCR screen snip"
                    onChange={(value) => updateHotkey("ocr", value)}
                    onRecordingChange={(recording) => setRecordingHotkey(recording ? "ocr" : null)}
                    value={settings.ocrHotkey}
                  />
                </div>

                {validateHotkeys(settings.popupHotkey, settings.ocrHotkey) && (
                  <div className="hotkey-alert">{validateHotkeys(settings.popupHotkey, settings.ocrHotkey)}</div>
                )}

                <div className="hotkey-note">
                  <Keyboard size={17} />
                  <span>Hotkey cần có ít nhất Ctrl, Alt hoặc Windows để tránh xung đột khi gõ. Inline command dùng <code>/function text/</code>, <code>//function text/</code>, hoặc <code>///function text/</code> để chọn model.</span>
                </div>
              </section>
              )}

              {activeNav === "ocr" && (
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>Smart OCR</h2>
                      <p>Module native chưa bật trong bản hiện tại; tab này giữ hotkey và checklist triển khai để không trộn với chức năng đã chạy.</p>
                    </div>
                    <span className="status-pill status-pill-warn">Roadmap</span>
                  </div>
                  <div className="metric-grid">
                    <div className="metric-card">
                      <span>Snip hotkey</span>
                      <strong>{settings.ocrHotkey}</strong>
                      <small>Có thể đổi trong tab Hotkeys</small>
                    </div>
                    <div className="metric-card">
                      <span>OCR engine</span>
                      <strong>Windows OCR</strong>
                      <small>Not connected yet</small>
                    </div>
                    <div className="metric-card">
                      <span>Post actions</span>
                      <strong>Copy, Translate, Summarize</strong>
                      <small>Dùng chung Floating Action Menu</small>
                    </div>
                    <div className="metric-card">
                      <span>Status</span>
                      <strong>Planned</strong>
                      <small>Capture hook and OCR bridge pending</small>
                    </div>
                  </div>
                  <div className="empty-state">
                    <ScanText size={22} />
                    <div>
                      <strong>OCR chưa chạy native trong bản hiện tại.</strong>
                      <span>Không còn hiển thị như một chức năng đã sẵn sàng; hiện chỉ là roadmap có hotkey và pipeline rõ ràng.</span>
                    </div>
                  </div>
                </section>
              )}
            </div>
            )}

            {activeNav !== "commands" && activeNav !== "logs" && (
            <aside className="space-y-5">
              {activeNav === "dashboard" && (
                <>
                  <FloatingActionMenu
                    busy={busy}
                    onAction={handleFloatingAction}
                    result={result}
                    actions={enabledFloatingActions}
                    shortcut={settings.popupHotkey}
                    selectedActionId={selectedFloatingActionId}
                  />
                  <section className="panel selected-text-panel">
                    <div className="section-heading compact">
                      <h2>Selected Text</h2>
                      <MousePointer2 size={18} />
                    </div>
                    <ImeTextarea className="selected-text-input" value={selectedText} onValueChange={setSelectedText} />
                    <button className="primary-button mt-3 w-full justify-center" onClick={() => handleFloatingAction(selectedFloatingActionId)} type="button">
                      <Sparkles size={16} />
                      Run {settings.floatingActions.find((item) => item.id === selectedFloatingActionId)?.label ?? "Action"}
                    </button>
                  </section>
                </>
              )}

              {activeNav === "providers" && (
                <section className="panel">
                  <div className="section-heading compact">
                    <h2>Provider Readiness</h2>
                    <Bot size={18} />
                  </div>
                  <div className="readiness-list">
                    <div>
                      <span>Active provider</span>
                      <strong>{settings.provider === "openai" ? "OpenAI" : "Gemini"}</strong>
                    </div>
                    <div>
                      <span>Required API key</span>
                      <strong>{activeProviderReady ? "Configured" : "Missing"}</strong>
                    </div>
                    <div>
                      <span>Fast model · /</span>
                      <strong>{settings.fastModel}</strong>
                    </div>
                    <div>
                      <span>Balanced model · //</span>
                      <strong>{settings.balancedModel}</strong>
                    </div>
                    <div>
                      <span>Powerful model · ///</span>
                      <strong>{settings.powerfulModel}</strong>
                    </div>
                  </div>
                  <button
                    className="primary-button mt-3 w-full justify-center"
                    disabled={!activeProviderReady || providerTestState === "Testing"}
                    onClick={handleTestProvider}
                    type="button"
                  >
                    {providerTestState === "Testing" ? <RefreshCw className="spin-icon" size={16} /> : <Sparkles size={16} />}
                    Test Provider
                  </button>
                  <div className={`provider-test-state ${providerTestState.includes("failed") || providerTestState.includes("Error") || providerTestState.includes("API") ? "provider-test-state-error" : ""}`}>
                    {providerTestState}
                  </div>
                </section>
              )}

              {activeNav === "general" && (
                <section className="panel">
                  <div className="section-heading compact">
                    <h2>Language Routing</h2>
                    <Languages size={18} />
                  </div>
                  <div className="readiness-list">
                    <div>
                      <span>Preferred pair</span>
                      <strong>{settings.translationLanguageA} ↔ {settings.translationLanguageB}</strong>
                    </div>
                    <div>
                      <span>Outside pair target</span>
                      <strong>{settings.preferredLanguage}</strong>
                    </div>
                    <div>
                      <span>Translate actions</span>
                      <strong>Inline + Floating</strong>
                    </div>
                  </div>
                </section>
              )}

              {activeNav === "hotkeys" && (
                <section className="panel">
                  <div className="section-heading compact">
                    <h2>Shortcut Map</h2>
                    <Keyboard size={18} />
                  </div>
                  <div className="readiness-list">
                    <div>
                      <span>Open floating menu</span>
                      <strong>{settings.popupHotkey}</strong>
                    </div>
                    <div>
                      <span>Capture OCR region</span>
                      <strong>{settings.ocrHotkey} · roadmap</strong>
                    </div>
                    <div>
                      <span>Inline trigger</span>
                      <strong>/ · // · /// function text/</strong>
                    </div>
                  </div>
                </section>
              )}

              {activeNav === "ocr" && (
                <section className="panel">
                  <div className="section-heading compact">
                    <h2>OCR Pipeline</h2>
                    <ScanText size={18} />
                  </div>
                  <div className="readiness-list">
                    <div>
                      <span>1. Capture</span>
                      <strong>{settings.ocrHotkey}</strong>
                    </div>
                    <div>
                      <span>2. Recognize</span>
                      <strong>Not implemented</strong>
                    </div>
                    <div>
                      <span>3. Act</span>
                      <strong>Copy, Translate, Summarize</strong>
                    </div>
                  </div>
                </section>
              )}
            </aside>
            )}

            {activeNav === "logs" && (
              <div className="logs-grid">
                <section className="panel flex flex-col h-full overflow-hidden">
                  <div className="section-heading mb-4 shrink-0">
                    <h2>System Status</h2>
                    <Cpu size={18} />
                  </div>
                  <div className="flex-1 rounded-lg border border-white/10 bg-black/50 p-4 overflow-y-auto font-mono text-sm shadow-[inset_0_2px_15px_rgba(0,0,0,0.5)]">
                    {status.system.length === 0 ? (
                      <div className="text-zinc-500 italic">No system logs...</div>
                    ) : (
                      <div className="space-y-3">
                        {status.system.map((line, idx) => {
                          const isError = line.toLowerCase().includes("failed") || line.toLowerCase().includes("error");
                          const isSuccess = line.toLowerCase().includes("ready") || line.toLowerCase().includes("enabled");
                          return (
                            <div key={`${line}-${idx}`} className="flex items-start gap-3">
                              <span className="mt-1 flex size-2 shrink-0 rounded-full bg-teal-400/20">
                                <span className={`size-1.5 m-auto rounded-full ${isError ? 'bg-rose-400' : isSuccess ? 'bg-emerald-400' : 'bg-teal-300'}`} />
                              </span>
                              <span className={isError ? "text-rose-200 break-words flex-1 whitespace-pre-wrap" : isSuccess ? "text-emerald-200 break-words flex-1 whitespace-pre-wrap" : "text-zinc-300 break-words flex-1 whitespace-pre-wrap"}>
                                {line}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>

                <section className="panel flex flex-col h-full overflow-hidden">
                  <div className="section-heading mb-4 shrink-0">
                    <h2>Inline Actions</h2>
                    <TerminalSquare size={18} />
                  </div>
                  <div className="flex-1 rounded-lg border border-white/10 bg-black/50 p-4 overflow-y-auto font-mono text-sm shadow-[inset_0_2px_15px_rgba(0,0,0,0.5)]">
                    {status.inline.length === 0 ? (
                      <div className="text-zinc-500 italic">Awaiting inline triggers...</div>
                    ) : (
                      <div className="space-y-3">
                        {status.inline.map((line, idx) => {
                          const isError = line.toLowerCase().includes("failed") || line.toLowerCase().includes("error");
                          const isSuccess = line.toLowerCase().includes("done");
                          const isAction = line.includes("---");
                          return (
                            <div key={`${line}-${idx}`} className="flex items-start gap-3">
                              <span className="mt-1 flex size-2 shrink-0 rounded-full bg-teal-400/20">
                                <span className={`size-1.5 m-auto rounded-full ${isError ? 'bg-rose-400' : isSuccess ? 'bg-emerald-400' : isAction ? 'bg-indigo-400' : 'bg-teal-300'}`} />
                              </span>
                              <span className={isError ? "text-rose-200 break-words flex-1 whitespace-pre-wrap" : isSuccess ? "text-emerald-200 break-words flex-1 whitespace-pre-wrap" : isAction ? "text-indigo-300 font-bold break-words flex-1 whitespace-pre-wrap" : "text-zinc-400 break-words flex-1 whitespace-pre-wrap"}>
                                {line}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        </section>
      </div>
      <AnimatePresence>
        {hotkeyPopupOpen && (
          <motion.div
            animate={{ opacity: 1 }}
            className="hotkey-popup-layer"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onMouseDown={() => setHotkeyPopupOpen(false)}
          >
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="hotkey-popup-shell"
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              onMouseDown={(event) => event.stopPropagation()}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
            >
              <div className="hotkey-popup-title">
                <div>
                  <span>Floating menu</span>
                  <strong>{hotkeyPopupSource || settings.popupHotkey}</strong>
                </div>
                <button className="icon-button" onClick={() => setHotkeyPopupOpen(false)} title="Close popup" type="button">
                  <X size={16} />
                </button>
              </div>
              <FloatingActionMenu
                busy={busy}
                onAction={handleFloatingAction}
                result={result}
                actions={enabledFloatingActions}
                shortcut={hotkeyPopupSource || settings.popupHotkey}
                selectedActionId={selectedFloatingActionId}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function FloatingWindowApp() {
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const [selectedFloatingActionId, setSelectedFloatingActionId] = useState("translate");
  const [selectedText, setSelectedText] = useState("");
  const [result, setResult] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shortcut, setShortcut] = useState("Hotkey");

  useEffect(() => {
    getSettings().then(setSettings).catch(() => setSettings(fallbackSettings));
    readClipboardText()
      .then((text) => {
        if (text.trim()) setSelectedText(text);
      })
      .catch(() => undefined);

    let unlisten: (() => void) | undefined;
    listenTextSpeedEvent<{ action: "popup" | "ocr"; hotkey: string }>("textspeed-hotkey", async (event) => {
      if (event.payload.action !== "popup") return;
      setShortcut(event.payload.hotkey);
      setResult("");
      setCopied(false);
      try {
        const text = await readClipboardText();
        setSelectedText(text.trim() ? text : "");
      } catch {
        setSelectedText("");
      }
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => undefined);

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        hideFloatingWindow().catch(() => undefined);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function handleFloatingAction(actionId: string) {
    const actionConfig = settings.floatingActions.find((item) => item.id === actionId && item.enabled);
    if (!actionConfig) return;
    const input = selectedText.trim();
    setSelectedFloatingActionId(actionConfig.id);
    if (!input) {
      setResult("");
      return;
    }

    setBusy(true);
    setCopied(false);
    try {
      const response = await runFloatingAction(actionConfig.id, input);
      setResult(response);
    } catch {
      setResult(localFallback(actionConfig.action, input, settings.translationLanguageA, settings.translationLanguageB, settings.preferredLanguage));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyResult() {
    const output = result.trim();
    if (!output) return;
    try {
      await writeClipboardText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="floating-window-root">
      <FloatingActionMenu
        busy={busy}
        copied={copied}
        onCopyResult={handleCopyResult}
        onAction={handleFloatingAction}
        result={result}
        actions={settings.floatingActions.filter((item) => item.enabled)}
        shortcut={shortcut}
        selectedActionId={selectedFloatingActionId}
      />
      <div className="floating-selection-preview">
        {selectedText.trim() ? selectedText : "No selected text captured"}
      </div>
    </main>
  );
}

type HotkeyTarget = "popup" | "ocr";

type ImeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  onValueChange: (value: string) => void;
  value: string;
};

function ImeInput({ onValueChange, value, ...props }: ImeInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);

  function commit(next: string) {
    if (next !== value) {
      onValueChange(next);
    }
  }

  useEffect(() => {
    const input = inputRef.current;
    if (input && document.activeElement !== input && input.value !== value) {
      input.value = value;
    }
  }, [value]);

  return (
    <input
      {...props}
      defaultValue={value}
      onInput={(event) => {
        props.onInput?.(event);
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        commit(event.currentTarget.value);
        props.onCompositionEnd?.(event);
      }}
      onCompositionStart={(event) => {
        composing.current = true;
        props.onCompositionStart?.(event);
      }}
      onBlur={(event) => {
        commit(event.currentTarget.value);
        props.onBlur?.(event);
      }}
      ref={inputRef}
    />
  );
}

type ImeTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
  onValueChange: (value: string) => void;
  value: string;
};

function ImeTextarea({ onValueChange, value, ...props }: ImeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);

  function commit(next: string) {
    if (next !== value) {
      onValueChange(next);
    }
  }

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea && document.activeElement !== textarea && textarea.value !== value) {
      textarea.value = value;
    }
  }, [value]);

  return (
    <textarea
      {...props}
      defaultValue={value}
      onInput={(event) => {
        props.onInput?.(event);
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        commit(event.currentTarget.value);
        props.onCompositionEnd?.(event);
      }}
      onCompositionStart={(event) => {
        composing.current = true;
        props.onCompositionStart?.(event);
      }}
      onBlur={(event) => {
        commit(event.currentTarget.value);
        props.onBlur?.(event);
      }}
      ref={textareaRef}
    />
  );
}

type HotkeyRecorderProps = {
  description: string;
  icon: typeof Keyboard;
  isRecording: boolean;
  label: string;
  onChange: (value: string) => void;
  onRecordingChange: (recording: boolean) => void;
  value: string;
};

function HotkeyRecorder({
  description,
  icon: Icon,
  isRecording,
  label,
  onChange,
  onRecordingChange,
  value,
}: HotkeyRecorderProps) {
  useEffect(() => {
    if (!isRecording) return;

    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        onRecordingChange(false);
        return;
      }

      const next = hotkeyFromEvent(event);
      if (!next) return;

      onChange(next);
      onRecordingChange(false);
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isRecording, onChange, onRecordingChange]);

  const normalized = normalizeHotkeyText(value);
  const parts = normalized.split(" + ").filter(Boolean);

  return (
    <section className={`hotkey-card ${isRecording ? "hotkey-card-recording" : ""}`}>
      <div className="hotkey-card-head">
        <span className="hotkey-icon">
          <Icon size={18} />
        </span>
        <div>
          <h3>{label}</h3>
          <p>{description}</p>
        </div>
      </div>

      <button className="hotkey-recorder" onClick={() => onRecordingChange(true)} type="button">
        {isRecording ? (
          <span className="recording-copy">
            <TimerReset size={16} />
            Press shortcut...
          </span>
        ) : (
          <span className="hotkey-keys">
            {parts.map((part) => (
              <kbd key={part}>{part}</kbd>
            ))}
          </span>
        )}
      </button>

      <div className="hotkey-actions">
        <button className="ghost-button" onClick={() => onRecordingChange(true)} type="button">
          <Keyboard size={15} />
          Record
        </button>
        <button className="ghost-button" onClick={() => onChange(label.includes("OCR") ? "Ctrl + Shift + S" : "Alt + V")} type="button">
          Reset
        </button>
      </div>
    </section>
  );
}

function CommandsPanel({
  inlineBuffer,
  inlinePreview,
  inlineResult,
  onSettingsSaved,
  onExecuteInline,
  setInlineBuffer,
  setInlineResult,
  setSettings,
  setStatus,
  settings,
}: {
  inlineBuffer: string;
  inlinePreview: string;
  inlineResult: string;
  onSettingsSaved: Dispatch<SetStateAction<AppSettings>>;
  onExecuteInline: () => void;
  setInlineBuffer: Dispatch<SetStateAction<string>>;
  setInlineResult: Dispatch<SetStateAction<string>>;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  setStatus: Dispatch<SetStateAction<{system: string[], inline: string[]}>>;
  settings: AppSettings;
}) {
  const [draftCommands, setDraftCommands] = useState<InlineCommand[]>(() => cloneCommands(settings.commands));
  const [draftInlineEnabled, setDraftInlineEnabled] = useState(settings.inlineEnabled);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [applyState, setApplyState] = useState("Applied");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraftCommands(cloneCommands(settings.commands));
    setDraftInlineEnabled(settings.inlineEnabled);
    setSelectedIndex((index) => Math.min(index, Math.max(settings.commands.length - 1, 0)));
    setDirty(false);
    setApplyState("Applied");
  }, [settings.commands, settings.inlineEnabled]);

  const selectedCommand = draftCommands[selectedIndex];
  function markDirty() {
    setDirty(true);
    setApplyState("Pending");
  }

  function updateSelectedCommand(patch: Partial<InlineCommand>) {
    setDraftCommands((commands) => {
      const next = [...commands];
      next[selectedIndex] = { ...next[selectedIndex], ...patch };
      return next;
    });
    markDirty();
  }

  function addCommand() {
    const name = nextCommandName(draftCommands);
    setDraftCommands((commands) => [
      ...commands,
      {
        name,
        label: "Custom function",
        action: "professional",
        prompt: "Viết lại nội dung theo yêu cầu của người dùng. Chỉ trả về kết quả cuối cùng.",
        enabled: true,
      },
    ]);
    setSelectedIndex(draftCommands.length);
    markDirty();
  }

  function duplicateSelectedCommand() {
    if (!selectedCommand) return;
    const name = nextCommandName(draftCommands, `${selectedCommand.name}_copy`);
    setDraftCommands((commands) => [
      ...commands,
      {
        ...selectedCommand,
        name,
        label: `${selectedCommand.label} copy`,
      },
    ]);
    setSelectedIndex(draftCommands.length);
    markDirty();
  }

  function deleteSelectedCommand() {
    if (!selectedCommand) return;
    setDraftCommands((commands) => commands.filter((_, index) => index !== selectedIndex));
    setSelectedIndex((index) => Math.max(0, index - 1));
    markDirty();
  }

  async function applyDraft() {
    const normalizedNames = draftCommands.map((command) => command.name.trim());
    const hasInvalidName = normalizedNames.some((name) => !/^[a-zA-Z0-9_-]+$/.test(name));
    const hasDuplicateName = new Set(normalizedNames).size !== normalizedNames.length;
    const hasEmptyPrompt = draftCommands.some((command) => !command.prompt.trim());

    if (draftCommands.length === 0) {
      setApplyState("Fix required");
      setInlineResult("Cần ít nhất một function trước khi Apply.");
      return;
    }

    if (hasInvalidName || hasDuplicateName || hasEmptyPrompt) {
      setApplyState("Fix required");
      setInlineResult("Không thể Apply: tên lệnh chỉ dùng chữ/số/_/-, không trùng nhau, prompt không được trống.");
      return;
    }

    setApplyState("Applying");
    const nextSettings: AppSettings = {
      ...settings,
      inlineEnabled: draftInlineEnabled,
      commands: draftCommands.map((command, index) => ({
        ...command,
        name: normalizedNames[index],
        label: command.label.trim() || normalizedNames[index],
        prompt: command.prompt.trim(),
      })),
    };

    try {
      const saved = await saveSettings(nextSettings);
      setSettings(saved);
      onSettingsSaved(saved);
      setDirty(false);
      setApplyState("Applied");
      setInlineResult("Đã Apply. Inline hook đang dùng prompt và function mới.");
      getRuntimeStatus().then(setStatus).catch(() => undefined);
    } catch {
      setApplyState("Apply failed");
      setInlineResult("Không Apply được trong browser preview. Hãy chạy desktop app để lưu vào backend.");
    }
  }

  return (
    <section className="panel command-workbench">
      <div className="section-heading">
        <div>
          <h2>Inline Function Config</h2>
          <p>Chọn một function ở bên trái, chỉnh prompt AI trực tiếp ở bên phải, rồi bấm Apply để cập nhật hook ngay.</p>
        </div>
        <div className="command-toolbar">
          <span className={`status-pill ${dirty ? "status-pill-warn" : ""}`}>{applyState}</span>
          <label className="switch">
            <input
              checked={draftInlineEnabled}
              onChange={(event) => {
                setDraftInlineEnabled(event.target.checked);
                markDirty();
              }}
              type="checkbox"
            />
            <span />
          </label>
          <button className="ghost-button" onClick={addCommand} type="button">
            <Plus size={16} />
            Add
          </button>
          <button className="primary-button" onClick={applyDraft} type="button">
            <Check size={16} />
            Apply
          </button>
        </div>
      </div>

      <div className="command-workbench-grid">
        <aside className="function-list" aria-label="Inline functions">
          {draftCommands.map((command, index) => (
            <button
              className={`function-list-item ${selectedIndex === index ? "function-list-item-active" : ""}`}
              key={`${command.name}-${index}`}
              onClick={() => setSelectedIndex(index)}
              type="button"
            >
              <span className="function-command">/{command.name || "unnamed"}</span>
              <strong>{command.label || "Untitled function"}</strong>
              <small>{command.action}</small>
              <i className={command.enabled ? "dot-on" : "dot-off"} />
            </button>
          ))}
        </aside>

        <div className="function-editor">
          {selectedCommand ? (
            <>
              <div className="function-editor-head">
                <div>
                  <span className="function-command">/{selectedCommand.name || "unnamed"}</span>
                  <h3>{selectedCommand.label || "Untitled function"}</h3>
                </div>
                <div className="command-toolbar">
                  <button className="ghost-button" onClick={duplicateSelectedCommand} type="button">
                    <Copy size={16} />
                    Duplicate
                  </button>
                  <button className="icon-button danger" onClick={deleteSelectedCommand} title="Delete function" type="button">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="function-fields">
                <label className="field">
                  <span>Trigger command</span>
                  <div className="command-input-wrap">
                    <b>//</b>
                    <ImeInput
                      className="code-input"
                      value={selectedCommand.name}
                      onValueChange={(value) =>
                        updateSelectedCommand({ name: value.replace(/^\/{1,3}/, "").replace(/\/$/, "").trim() })
                      }
                    />
                  </div>
                </label>
                <label className="field">
                  <span>Display name</span>
                  <ImeInput
                    value={selectedCommand.label}
                    onValueChange={(value) => updateSelectedCommand({ label: value })}
                  />
                </label>
                <label className="field">
                  <span>AI action</span>
                  <select
                    value={selectedCommand.action}
                    onChange={(event) => updateSelectedCommand({ action: event.target.value as AiAction })}
                  >
                    {actionOptions.map((action) => (
                      <option key={action} value={action}>
                        {action}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field function-enabled">
                  <span>Enabled</span>
                  <label className="switch">
                    <input
                      checked={selectedCommand.enabled}
                      onChange={(event) => updateSelectedCommand({ enabled: event.target.checked })}
                      type="checkbox"
                    />
                    <span />
                  </label>
                </label>
              </div>

              <label className="field prompt-editor-field">
                <span>Prompt sent directly to AI</span>
                <ImeTextarea
                  className="prompt-editor"
                  value={selectedCommand.prompt}
                  onValueChange={(value) => updateSelectedCommand({ prompt: value })}
                  spellCheck={false}
                />
              </label>

              <div className="syntax-preview">
                <span>Use anywhere</span>
                <code>/{selectedCommand.name || "function"} nhanh/ · //{selectedCommand.name || "function"} trung bình/ · ///{selectedCommand.name || "function"} mạnh/</code>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Command size={22} />
              <div>
                <strong>Chưa có function nào.</strong>
                <span>Bấm Add để tạo function đầu tiên.</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="parser-test-strip">
        <div>
          <h3>Parser Test</h3>
          <p>{inlinePreview}</p>
        </div>
        <ImeTextarea value={inlineBuffer} onValueChange={setInlineBuffer} />
        <button className="ghost-button" onClick={onExecuteInline} type="button">
          <Command size={16} />
          Execute Inline
        </button>
        <div className="inline-result">{inlineResult}</div>
      </div>
    </section>
  );
}

function FloatingActionsPanel({
  onSettingsSaved,
  setSettings,
  setStatus,
  settings,
}: {
  onSettingsSaved: Dispatch<SetStateAction<AppSettings>>;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  setStatus: Dispatch<SetStateAction<{system: string[], inline: string[]}>>;
  settings: AppSettings;
}) {
  const [draftActions, setDraftActions] = useState<FloatingAction[]>(() => cloneFloatingActions(settings.floatingActions));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [applyState, setApplyState] = useState("Applied");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraftActions(cloneFloatingActions(settings.floatingActions));
    setSelectedIndex((index) => Math.min(index, Math.max(settings.floatingActions.length - 1, 0)));
    setDirty(false);
    setApplyState("Applied");
  }, [settings.floatingActions]);

  const selectedAction = draftActions[selectedIndex];

  function markDirty() {
    setDirty(true);
    setApplyState("Pending");
  }

  function updateSelectedAction(patch: Partial<FloatingAction>) {
    setDraftActions((actions) => {
      const next = [...actions];
      next[selectedIndex] = { ...next[selectedIndex], ...patch };
      return next;
    });
    markDirty();
  }

  function addAction() {
    const id = nextFloatingActionId(draftActions);
    setDraftActions((actions) => [
      ...actions,
      {
        id,
        label: "Custom",
        action: "professional",
        prompt: "Xử lý văn bản theo yêu cầu. Chỉ trả về kết quả cuối cùng.",
        enabled: true,
      },
    ]);
    setSelectedIndex(draftActions.length);
    markDirty();
  }

  function deleteSelectedAction() {
    if (!selectedAction) return;
    setDraftActions((actions) => actions.filter((_, index) => index !== selectedIndex));
    setSelectedIndex((index) => Math.max(0, index - 1));
    markDirty();
  }

  async function applyDraft() {
    const normalizedIds = draftActions.map((action) => action.id.trim());
    const hasInvalidId = normalizedIds.some((id) => !/^[a-zA-Z0-9_-]+$/.test(id));
    const hasDuplicateId = new Set(normalizedIds).size !== normalizedIds.length;
    const hasEmptyPrompt = draftActions.some((action) => !action.prompt.trim());

    if (draftActions.length === 0 || hasInvalidId || hasDuplicateId || hasEmptyPrompt) {
      setApplyState("Fix required");
      return;
    }

    setApplyState("Applying");
    const nextSettings: AppSettings = {
      ...settings,
      floatingActions: draftActions.map((action, index) => ({
        ...action,
        id: normalizedIds[index],
        label: action.label.trim() || normalizedIds[index],
        prompt: action.prompt.trim(),
      })),
    };

    try {
      const saved = await saveSettings(nextSettings);
      setSettings(saved);
      onSettingsSaved(saved);
      setDirty(false);
      setApplyState("Applied");
      getRuntimeStatus().then(setStatus).catch(() => undefined);
    } catch {
      setApplyState("Apply failed");
    }
  }

  return (
    <section className="panel command-workbench floating-action-workbench">
      <div className="section-heading">
        <div>
          <h2>Floating Menu Actions</h2>
          <p>Thêm, xóa, đổi tên và sửa prompt cho các nút xuất hiện trong popup cạnh con trỏ.</p>
        </div>
        <div className="command-toolbar">
          <span className={`status-pill ${dirty ? "status-pill-warn" : ""}`}>{applyState}</span>
          <button className="ghost-button" onClick={addAction} type="button">
            <Plus size={16} />
            Add
          </button>
          <button className="primary-button" onClick={applyDraft} type="button">
            <Check size={16} />
            Apply
          </button>
        </div>
      </div>

      <div className="command-workbench-grid">
        <aside className="function-list" aria-label="Floating menu actions">
          {draftActions.map((action, index) => {
            const Icon = actionMeta[action.action].icon;
            return (
              <button
                className={`function-list-item ${selectedIndex === index ? "function-list-item-active" : ""}`}
                key={`${action.id}-${index}`}
                onClick={() => setSelectedIndex(index)}
                type="button"
              >
                <span className="function-command">{action.id || "unnamed"}</span>
                <strong>{action.label || "Untitled action"}</strong>
                <small><Icon size={13} /> {action.action}</small>
                <i className={action.enabled ? "dot-on" : "dot-off"} />
              </button>
            );
          })}
        </aside>

        <div className="function-editor">
          {selectedAction ? (
            <>
              <div className="function-editor-head">
                <div>
                  <span className="function-command">{selectedAction.id || "unnamed"}</span>
                  <h3>{selectedAction.label || "Untitled action"}</h3>
                </div>
                <button className="icon-button danger" onClick={deleteSelectedAction} title="Delete action" type="button">
                  <Trash2 size={16} />
                </button>
              </div>

              <div className="function-fields floating-action-fields">
                <label className="field">
                  <span>Action ID</span>
                  <ImeInput
                    className="code-input"
                    value={selectedAction.id}
                    onValueChange={(value) => updateSelectedAction({ id: value.trim() })}
                  />
                </label>
                <label className="field">
                  <span>Button label</span>
                  <ImeInput
                    value={selectedAction.label}
                    onValueChange={(value) => updateSelectedAction({ label: value })}
                  />
                </label>
                <label className="field">
                  <span>AI action</span>
                  <select
                    value={selectedAction.action}
                    onChange={(event) => updateSelectedAction({ action: event.target.value as AiAction })}
                  >
                    {actionOptions.map((action) => (
                      <option key={action} value={action}>
                        {action}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field function-enabled">
                  <span>Enabled</span>
                  <label className="switch">
                    <input
                      checked={selectedAction.enabled}
                      onChange={(event) => updateSelectedAction({ enabled: event.target.checked })}
                      type="checkbox"
                    />
                    <span />
                  </label>
                </label>
              </div>

              <label className="field prompt-editor-field">
                <span>Prompt sent directly to AI</span>
                <ImeTextarea
                  className="prompt-editor floating-prompt-editor"
                  value={selectedAction.prompt}
                  onValueChange={(value) => updateSelectedAction({ prompt: value })}
                  spellCheck={false}
                />
              </label>
            </>
          ) : (
            <div className="empty-state">
              <MousePointer2 size={22} />
              <div>
                <strong>Chưa có action nào.</strong>
                <span>Bấm Add để tạo nút đầu tiên cho Floating Action Menu.</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function cloneCommands(commands: InlineCommand[]) {
  return commands.map((command) => ({ ...command }));
}

function cloneFloatingActions(actions: FloatingAction[]) {
  return actions.map((action) => ({ ...action }));
}

function nextCommandName(commands: InlineCommand[], base = "custom") {
  const names = new Set(commands.map((command) => command.name));
  if (!names.has(base)) return base;

  let suffix = commands.length + 1;
  let name = `${base}${suffix}`;
  while (names.has(name)) {
    suffix += 1;
    name = `${base}${suffix}`;
  }
  return name;
}

function nextFloatingActionId(actions: FloatingAction[], base = "custom") {
  const ids = new Set(actions.map((action) => action.id));
  if (!ids.has(base)) return base;

  let suffix = actions.length + 1;
  let id = `${base}${suffix}`;
  while (ids.has(id)) {
    suffix += 1;
    id = `${base}${suffix}`;
  }
  return id;
}

function hotkeyFromEvent(event: KeyboardEvent) {
  const key = normalizeHotkeyKey(event.key);
  if (!key) return null;

  const modifiers = [
    event.ctrlKey ? "Ctrl" : null,
    event.altKey ? "Alt" : null,
    event.shiftKey ? "Shift" : null,
    event.metaKey ? "Win" : null,
  ].filter(Boolean) as string[];

  if (modifiers.includes(key)) return null;
  if (modifiers.length === 0 && !/^F\d{1,2}$/.test(key)) return null;

  return [...modifiers, key].join(" + ");
}

function normalizeHotkeyKey(key: string) {
  const aliases: Record<string, string> = {
    " ": "Space",
    Spacebar: "Space",
    Control: "Ctrl",
    Ctrl: "Ctrl",
    AltGraph: "Alt",
    Meta: "Win",
    OS: "Win",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Escape: "Esc",
  };

  if (aliases[key]) return aliases[key];
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F\d{1,2}$/i.test(key)) return key.toUpperCase();
  if (["Backspace", "Delete", "Enter", "Tab", "Home", "End", "PageUp", "PageDown", "Insert"].includes(key)) return key;
  return null;
}

function normalizeHotkeyText(value: string) {
  const parts = value
    .split("+")
    .map((part) => normalizeHotkeyKey(part.trim()) ?? part.trim())
    .filter(Boolean);
  const ordered = ["Ctrl", "Alt", "Shift", "Win"];
  const modifiers = ordered.filter((modifier) => parts.includes(modifier));
  const key = parts.find((part) => !ordered.includes(part));
  return [...modifiers, key].filter(Boolean).join(" + ");
}

function validateHotkeys(popupHotkey: string, ocrHotkey: string) {
  const popup = normalizeHotkeyText(popupHotkey);
  const ocr = normalizeHotkeyText(ocrHotkey);
  const popupError = validateOneHotkey(popup, "Floating menu");
  if (popupError) return popupError;
  const ocrError = validateOneHotkey(ocr, "OCR snip");
  if (ocrError) return ocrError;
  if (popup.toLowerCase() === ocr.toLowerCase()) {
    return "Floating menu và OCR snip không được dùng cùng một hotkey.";
  }
  return "";
}

function validateOneHotkey(value: string, label: string) {
  const parts = value.split(" + ").filter(Boolean);
  if (parts.length < 2) return `${label}: cần một phím chính và ít nhất một modifier.`;
  const hasModifier = parts.some((part) => ["Ctrl", "Alt", "Win"].includes(part));
  if (!hasModifier) return `${label}: nên có Ctrl, Alt hoặc Windows để tránh xung đột khi nhập liệu.`;
  const key = parts[parts.length - 1];
  if (["Ctrl", "Alt", "Shift", "Win"].includes(key)) return `${label}: thiếu phím chính.`;
  return "";
}

function FloatingActionMenu({
  actions,
  busy,
  copied,
  onCopyResult,
  onAction,
  result,
  shortcut,
  selectedActionId,
}: {
  actions: FloatingAction[];
  busy: boolean;
  copied?: boolean;
  onCopyResult?: () => void;
  onAction: (actionId: string) => void;
  result: string;
  shortcut: string;
  selectedActionId: string;
}) {
  return (
    <motion.section
      animate={{ opacity: 1, scale: 1, y: 0 }}
      className="floating-panel floating-panel-compact"
      initial={{ opacity: 0, scale: 0.96, y: 12 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
    >
      <div className="floating-compact-head">
        <div>
          <h2>TextSpeed</h2>
          <p>{shortcut}</p>
        </div>
        <div className="floating-head-actions">
          {result.trim() && onCopyResult && (
            <button className="icon-button tiny" onClick={onCopyResult} title="Copy result" type="button">
              {copied ? <CopyCheck size={14} /> : <Copy size={14} />}
            </button>
          )}
          <button className="icon-button tiny" onClick={() => hideFloatingWindow().catch(() => undefined)} title="Close popup" type="button">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="floating-action-grid">
        {actions.map((action) => {
          const Icon = actionMeta[action.action].icon;
          const active = selectedActionId === action.id;
          return (
            <button className={`action-button compact-action ${active ? "action-button-active" : ""}`} key={action.id} onClick={() => onAction(action.id)} type="button">
              <span className="compact-action-icon">
                <Icon size={14} />
              </span>
              <span className="compact-action-label">{action.label}</span>
              <small>{actionMeta[action.action].hint}</small>
            </button>
          );
        })}
      </div>
      <div className={`result-box compact-result-box ${busy || result.trim() ? "compact-result-visible" : ""}`}>
        <AnimatePresence mode="wait">
          <motion.p
            key={busy ? "busy" : result}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            initial={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
          >
            {busy ? "Đang xử lý..." : result}
          </motion.p>
        </AnimatePresence>
      </div>
    </motion.section>
  );
}

function localFallback(action: AiAction, text: string, languageA: string, languageB: string, preferredLanguage: string) {
  const compact = text.length > 130 ? `${text.slice(0, 130)}...` : text;
  const language = `${languageA} ↔ ${languageB}`;
  const responses: Record<AiAction, string> = {
    translate: `Dịch theo ${language}; nếu ngoài cặp thì sang ${preferredLanguage}: ${compact}`,
    summarize: `Tóm tắt: Người gửi cần nhận tài liệu cuối cùng sớm để kiểm tra timeline và ngân sách.`,
    reply: "Tôi sẽ gửi trước sáng mai và ưu tiên kiểm tra phần timeline cùng budget.",
    explain: `Giải thích ngắn: "${compact}" là nội dung cần AI xử lý theo ngữ cảnh hiện tại.`,
    fix: compact,
    professional: `Anh vui lòng gửi giúp em file khi thuận tiện. Cảm ơn anh.`,
    mail: "Subject: Follow-up\n\nChào anh/chị,\n\nEm gửi nội dung theo yêu cầu và sẵn sàng bổ sung nếu cần.\n\nTrân trọng,",
  };
  return responses[action];
}

export default App;

