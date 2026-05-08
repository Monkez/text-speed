const { contextBridge, ipcRenderer } = require("electron");

const invokeChannels = new Set([
  "get_settings",
  "save_settings",
  "read_clipboard_text",
  "write_clipboard_text",
  "hide_main_window",
  "hide_floating_window",
  "parse_inline_buffer",
  "execute_inline_command",
  "run_ai_action",
  "test_provider",
  "run_floating_action",
  "get_model_ids",
  "get_runtime_status",
]);

const eventChannels = new Set(["textspeed-hotkey"]);

contextBridge.exposeInMainWorld("textspeed", {
  invoke(channel, payload) {
    if (!invokeChannels.has(channel)) {
      return Promise.reject(new Error(`Unsupported TextSpeed IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel, callback) {
    if (!eventChannels.has(channel)) {
      return () => undefined;
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
