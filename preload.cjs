const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("textspeed", {
  invoke(channel, payload) {
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel, callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
