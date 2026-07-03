const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvis", {
  createRealtimeToken: (options) => ipcRenderer.invoke("realtime:create-token", options),
  sendChatMessage: (payload) => ipcRenderer.invoke("chat:send", payload),
  executeTool: (toolCall) => ipcRenderer.invoke("tools:execute", toolCall),
  getToolSpecs: () => ipcRenderer.invoke("tools:list"),
  getDashboard: (options) => ipcRenderer.invoke("dashboard:snapshot", options),
  getTasks: (options) => ipcRenderer.invoke("tasks:list", options),
  getOrg: () => ipcRenderer.invoke("org:get"),
  listCustomAgents: () => ipcRenderer.invoke("agents:custom:list"),
  createCustomAgent: (payload) => ipcRenderer.invoke("agents:custom:create", payload),
  deleteCustomAgent: (id) => ipcRenderer.invoke("agents:custom:delete", id),
  listArtifacts: (_event, limit) => ipcRenderer.invoke("artifacts:list", limit),
  getProactiveEvents: () => ipcRenderer.invoke("proactive:pending"),
  markProactiveSpoken: (id) => ipcRenderer.invoke("proactive:spoken", id),
  listSessions: (limit) => ipcRenderer.invoke("sessions:list", limit),
  listSessionTurns: (sessionId, limit) => ipcRenderer.invoke("sessions:turns", { sessionId, limit }),
  listSkills: () => ipcRenderer.invoke("skills:list"),
  logEvent: (event) => ipcRenderer.invoke("log:event", event),
});
