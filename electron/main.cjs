const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");
const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

// Loaded after dotenv so source adapters see CATC_* / NETJARVIS_SOURCE vars.
const logger = require("./logger.cjs");
const db = require("./db.cjs");
const { createTools } = require("./tools.cjs");
const { createRealtimeToken } = require("./realtime-token.cjs");

const tools = createTools({ readDb: db.readDb, updateDb: db.updateDb });
tools.startBackgroundServices();
let mainWindow = null;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

async function createWindow() {
  await db.ensureData();
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 520,
    minHeight: 560,
    title: "NetJarvis",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    icon: nativeImage.createEmpty(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  win.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    await win.loadFile(path.join(process.cwd(), "dist", "index.html"));
  }
  logger.log("app.window", { devUrl: Boolean(devUrl) });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

ipcMain.handle("tools:list", () => tools.toolSpecs);

ipcMain.handle("tools:execute", async (_event, toolCall) => {
  const name = String(toolCall?.name || "");
  const args = asObject(toolCall?.arguments);
  return tools.execute(name, args);
});

ipcMain.handle("tasks:list", async (_event, options) => {
  try {
    const result = await tools.listTasks(options || {});
    return result;
  } catch {
    return { tasks: [], total: 0, limit: 0, offset: 0, storeCap: 500, storeCount: 0 };
  }
});

ipcMain.handle("org:get", () => tools.getOrg());

ipcMain.handle("agents:custom:list", () => tools.listCustomAgents());

ipcMain.handle("agents:custom:create", async (_event, payload) => {
  const body = asObject(payload);
  try {
    const agent = await tools.createCustomAgent({
      name: body.name,
      description: body.description,
      capabilities: body.capabilities,
    });
    return { ok: true, agent };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("agents:custom:delete", async (_event, id) => {
  return tools.removeCustomAgent(String(id || ""));
});

ipcMain.handle("artifacts:list", async (_event, limit) => {
  try {
    return await tools.listArtifacts(Number(limit) || 40);
  } catch {
    return [];
  }
});

ipcMain.handle("proactive:pending", async () => {
  try {
    return await tools.alertWatcher.pendingEvents();
  } catch {
    return [];
  }
});

ipcMain.handle("proactive:spoken", async (_event, id) => {
  return tools.alertWatcher.markSpoken(String(id || ""));
});

ipcMain.handle("dashboard:snapshot", async (_event, options) => {
  try {
    return await tools.getSnapshot(options?.force === true);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("log:event", (_event, event) => {
  const data = asObject(event);
  const type = typeof data.type === "string" && data.type ? data.type : "event";
  delete data.type;
  logger.log(`client.${type}`, data);
  return { ok: true };
});

ipcMain.handle("realtime:create-token", async (_event, options) => {
  const body = asObject(options);
  return createRealtimeToken({
    instructions: tools.instructions,
    toolSpecs: tools.toolSpecs,
    routerMode: body.routerMode !== false,
  });
});

ipcMain.handle("chat:send", async (_event, payload) => {
  const body = asObject(payload);
  return tools.sendChatMessage({
    target: body.target,
    message: body.message,
    channel: body.channel,
  });
});

ipcMain.handle("sessions:list", async (_event, limit) => tools.listSessions(Number(limit) || 30));

ipcMain.handle("sessions:turns", async (_event, payload) => {
  const body = asObject(payload);
  return tools.listSessionTurns(String(body.sessionId || ""), Number(body.limit) || 100);
});

ipcMain.handle("skills:list", () => tools.listSkills());

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
