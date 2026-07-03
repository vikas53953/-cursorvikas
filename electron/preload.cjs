const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvis", {
  createRealtimeToken: () => ipcRenderer.invoke("realtime:create-token"),
  executeTool: (toolCall) => ipcRenderer.invoke("tools:execute", toolCall),
  getToolSpecs: () => ipcRenderer.invoke("tools:list"),
  getDashboard: (options) => ipcRenderer.invoke("dashboard:snapshot", options),
  getTasks: () => ipcRenderer.invoke("tasks:list"),
  logEvent: (event) => ipcRenderer.invoke("log:event", event),
});
