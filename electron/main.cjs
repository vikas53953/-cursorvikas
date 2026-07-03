const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

// Loaded after dotenv so source adapters see CATC_* / NETJARVIS_SOURCE vars.
const { createTools } = require("./tools.cjs");

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "netjarvis-db.json");
let mainWindow = null;
let dbWriteQueue = Promise.resolve();

// ---------------------------------------------------------------------------
// Local persistence (shift notes + acknowledged alerts)
// ---------------------------------------------------------------------------

function defaultDb() {
  return { notes: [], ackedAlerts: [] };
}

async function ensureData() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dbPath);
  } catch {
    await fs.writeFile(dbPath, JSON.stringify(defaultDb(), null, 2));
  }
}

async function readDb() {
  await ensureData();
  try {
    const raw = JSON.parse(await fs.readFile(dbPath, "utf8"));
    return {
      notes: Array.isArray(raw.notes) ? raw.notes : [],
      ackedAlerts: Array.isArray(raw.ackedAlerts) ? raw.ackedAlerts : [],
    };
  } catch {
    return defaultDb();
  }
}

async function updateDb(mutator) {
  const operation = dbWriteQueue.then(async () => {
    const db = await readDb();
    const result = await mutator(db);
    await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
    return { db, result };
  });
  dbWriteQueue = operation.catch(() => {});
  return operation;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const tools = createTools({ readDb, updateDb });

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

async function createWindow() {
  await ensureData();
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

ipcMain.handle("dashboard:snapshot", async (_event, options) => {
  try {
    return await tools.getSnapshot(options?.force === true);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("realtime:create-token", async () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing in .env.local");
  }

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": crypto.createHash("sha256").update("netjarvis-local").digest("hex"),
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: "gpt-realtime-2",
        instructions: tools.instructions,
        output_modalities: ["audio"],
        reasoning: { effort: "low" },
        tool_choice: "auto",
        tools: tools.toolSpecs,
        audio: {
          input: {
            turn_detection: {
              type: "semantic_vad",
              eagerness: "medium",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            voice: "cedar",
          },
        },
        tracing: {
          workflow_name: "NetJarvis NOC Copilot",
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Realtime token request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const value = data.value || data.client_secret?.value;
  if (!value) {
    throw new Error("Realtime token response did not include a client secret value.");
  }
  return { value, expiresAt: data.expires_at || data.client_secret?.expires_at || null };
});

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
