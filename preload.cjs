const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("textspeed", {
  invoke(channel, payload) {
    return ipcRenderer.invoke(channel, payload);
  },
});
