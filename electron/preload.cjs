const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvis", {
  createRealtimeToken: () => ipcRenderer.invoke("realtime:create-token"),
  executeTool: (toolCall) => ipcRenderer.invoke("tools:execute", toolCall),
  getToolSpecs: () => ipcRenderer.invoke("tools:list"),
  getDashboard: (options) => ipcRenderer.invoke("dashboard:snapshot", options),
  getTasks: (options) => ipcRenderer.invoke("tasks:list", options),
  getOrg: () => ipcRenderer.invoke("org:get"),
  listArtifacts: (_event, limit) => ipcRenderer.invoke("artifacts:list", limit),
  getProactiveEvents: () => ipcRenderer.invoke("proactive:pending"),
  markProactiveSpoken: (id) => ipcRenderer.invoke("proactive:spoken", id),
  logEvent: (event) => ipcRenderer.invoke("log:event", event),
});
