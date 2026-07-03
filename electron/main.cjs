const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const dotenv = require("dotenv");
const net = require("./network-data.cjs");

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "netjarvis-db.json");
let mainWindow = null;
let dbWriteQueue = Promise.resolve();

const JARVIS_INSTRUCTIONS = `# Role and Objective
You are NetJarvis, a realtime voice copilot for a senior network operations engineer. You are their eyes on the network: at the start of a shift and throughout the day you answer questions about network health, BGP, OSPF, edge and core routers, interfaces, traffic, drops, and alerts using your tools.

# Personality and Tone
Talk like a sharp NOC colleague, not a chatbot. Confident, concise, calm under incident pressure. Lead with the answer, then the one or two details that matter. Use plain network-engineer language (peers, flaps, adjacencies, discards, optics).

# Core behavior
- When the engineer starts a shift or asks anything like "how is my network doing", "give me the rundown", or "anything happen overnight", call shift_briefing immediately and summarize the headlines out loud in a few sentences. The full brief renders in the panel; do not read it word for word.
- "How is BGP doing" or anything about peers, transit, prefixes, or flaps: call bgp_status (pass the device if one was named).
- "How is OSPF doing" or anything about adjacencies/areas: call ospf_status.
- "How are my edge routers" / "core routers" / a specific router name: call device_health with that scope.
- Questions about interfaces, errors, CRCs, or a specific link: call interface_report (set problemsOnly true when they ask about errors or issues).
- Questions about traffic levels, spikes, increases, or top talkers: call traffic_report.
- "Any drops overnight" or packet loss questions: call drop_report with the right window.
- "What alerts are active" / "what happened overnight": call active_alerts or overnight_events.
- "Show me the network" / topology questions: call topology_show.
- Show the big picture wall view with network_status_board when they ask for the board, the wall, or an at-a-glance view.
- Use web_search only for outside-world questions like provider outage news or vendor advisories.
- Use note_add when the engineer wants to leave a shift note or handoff note.

# Tool behavior
- Call tools directly when intent is clear; never invent numbers that a tool can give you.
- After a tool runs, speak a short summary. The artifact panel shows the detail.
- Acknowledging an alert changes state: summarize the alert and get a clear yes before calling acknowledge_alert with confirmed true.
- If a question is outside what your tools cover (for example, per-customer circuit detail), say what you can see and what you cannot, briefly.

# Artifacts
Use the artifact panel for briefings, tables, alert detail, topology diagrams, and notes. If the engineer asks to show, hide, or fullscreen the panel, use artifact_show or just tell them the panel state.

# Audio
Let the engineer interrupt you. If audio is unclear, ask one short clarifying question instead of guessing.`;

const toolSpecs = [
  {
    type: "function",
    name: "shift_briefing",
    description: "Build the start-of-shift briefing: overall health, overnight headlines, BGP/OSPF state, traffic, drops, and suggested actions. Call this for 'how is my network doing', 'give me the rundown', or at shift start.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "network_status_board",
    description: "Show the NOC wall board: one color-coded tile per device with status, CPU, uptime, and active alerts, plus BGP/OSPF rollups.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "bgp_status",
    description: "BGP session status: eBGP transit and IX peers plus iBGP mesh, with state, uptime, prefixes received, and flaps in the last 24h. Optionally scope to one router.",
    parameters: {
      type: "object",
      properties: {
        device: { type: "string", description: "Optional router name, e.g. EDGE-R3" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "ospf_status",
    description: "OSPF adjacency status across the network: neighbor states, areas, and adjacency changes in the last 24h.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "device_health",
    description: "Hardware and platform health (CPU, memory, temperature, uptime, active alerts) for devices. Scope can be a role (core, edge, distribution, firewall) or a device name.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Role (core, edge, distribution, firewall) or device name. Omit for all devices." },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "interface_report",
    description: "Key interface status: up/down, utilization, throughput, input errors, and output discards. Set problemsOnly to true to list only interfaces with errors, discards, or notes.",
    parameters: {
      type: "object",
      properties: {
        device: { type: "string", description: "Optional device name to scope to" },
        problemsOnly: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "traffic_report",
    description: "Current traffic picture: aggregate in/out, comparison to the same hour yesterday, anomalies (unusual increases), and the busiest links.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "drop_report",
    description: "Packet drop and error report over a time window: CRC errors, discards, and firewall policy drops with an assessment of each. Default window is 12 hours (overnight).",
    parameters: {
      type: "object",
      properties: {
        windowHours: { type: "number", minimum: 1, maximum: 24 },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "overnight_events",
    description: "Chronological event log (flaps, alarms, backups, anomalies) over a time window. Default window is 12 hours.",
    parameters: {
      type: "object",
      properties: {
        windowHours: { type: "number", minimum: 1, maximum: 24 },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "active_alerts",
    description: "Active alerts with severity, device, full detail, and acknowledgement state. Set includeCleared true to also show alerts that cleared in the last 24h.",
    parameters: {
      type: "object",
      properties: {
        includeCleared: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "acknowledge_alert",
    description: "Acknowledge an alert by id (for example ALM-2483). Summarize the alert and get explicit confirmation first, then call with confirmed true.",
    parameters: {
      type: "object",
      properties: {
        alertId: { type: "string" },
        confirmed: { type: "boolean" },
      },
      required: ["alertId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "topology_show",
    description: "Render the network topology diagram: ISP transits, IX peering, edge and core routers, distribution, and firewalls.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "artifact_show",
    description: "Show structured content in the artifact panel. Use for ad-hoc notes, markdown summaries, code/config snippets, or tables you compose yourself.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        kind: { type: "string", enum: ["text", "markdown", "code", "table", "notes", "mermaid", "progress"] },
        content: { type: "string" },
        language: { type: "string" },
        fullscreen: { type: "boolean" },
      },
      required: ["title", "kind", "content"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "show_menu",
    description: "Show NetJarvis's capability menu in the artifact panel. Call when the engineer asks what NetJarvis can do or says 'show me the menu'.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "web_search",
    description: "Search the web with Exa. Use for outside-world context: ISP outage reports, vendor advisories, CVEs, BGP incident news.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        numResults: { type: "number", minimum: 1, maximum: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "note_add",
    description: "Add a shift note or handoff note to the local notes board.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
];

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

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

async function createWindow() {
  await ensureData();
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 460,
    minHeight: 540,
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
// Realtime session token
// ---------------------------------------------------------------------------

ipcMain.handle("tools:list", () => toolSpecs);

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
        instructions: JARVIS_INSTRUCTIONS,
        output_modalities: ["audio"],
        reasoning: { effort: "low" },
        tool_choice: "auto",
        tools: toolSpecs,
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
// Tool execution
// ---------------------------------------------------------------------------

ipcMain.handle("tools:execute", async (_event, toolCall) => {
  const name = String(toolCall?.name || "");
  const args = asObject(toolCall?.arguments);

  try {
    if (name === "shift_briefing") {
      const db = await readDb();
      const briefing = net.buildShiftBriefing(db.ackedAlerts);
      return {
        ok: true,
        activeAlerts: briefing.activeAlerts,
        warnings: briefing.warnings,
        eventsOvernight: briefing.eventsOvernight,
        artifact: { title: "Shift Briefing", kind: "markdown", content: briefing.markdown },
      };
    }

    if (name === "network_status_board") {
      const db = await readDb();
      const board = net.getStatusBoard(db.ackedAlerts);
      return {
        ok: true,
        overall: board.overall,
        summary: board.summary,
        artifact: { title: "Network Status Board", kind: "statusBoard", content: JSON.stringify(board) },
      };
    }

    if (name === "bgp_status") {
      const status = net.getBgpStatus(args.device);
      return {
        ok: true,
        scope: status.scope,
        established: status.established,
        totalSessions: status.totalSessions,
        down: status.down,
        flapsLast24h: status.flapsLast24h,
        flappedSessions: status.flappedSessions,
        artifact: {
          title: `BGP Status (${status.scope})`,
          kind: "table",
          content: JSON.stringify(status.sessions),
        },
      };
    }

    if (name === "ospf_status") {
      const status = net.getOspfStatus();
      return {
        ok: true,
        full: status.full,
        totalAdjacencies: status.totalAdjacencies,
        down: status.down,
        adjacencyChanges24h: status.adjacencyChanges24h,
        areas: status.areas,
        artifact: { title: "OSPF Adjacencies", kind: "table", content: JSON.stringify(status.neighbors) },
      };
    }

    if (name === "device_health") {
      const db = await readDb();
      const health = net.getDeviceHealth(args.scope, db.ackedAlerts);
      return {
        ok: true,
        scope: health.scope,
        devices: health.devices,
        artifact: { title: `Device Health (${health.scope})`, kind: "table", content: JSON.stringify(health.devices) },
      };
    }

    if (name === "interface_report") {
      const report = net.getInterfaceReport(args.device, args.problemsOnly === true);
      return {
        ok: true,
        scope: report.scope,
        interfaces: report.interfaces,
        artifact: { title: `Interfaces (${report.scope})`, kind: "table", content: JSON.stringify(report.interfaces) },
      };
    }

    if (name === "traffic_report") {
      const report = net.getTrafficReport();
      return {
        ok: true,
        ...report,
        artifact: { title: "Traffic Report", kind: "markdown", content: trafficMarkdown(report) },
      };
    }

    if (name === "drop_report") {
      const report = net.getDropReport(args.windowHours);
      return {
        ok: true,
        windowHours: report.windowHours,
        drops: report.drops,
        artifact: { title: `Drops (last ${report.windowHours}h)`, kind: "table", content: JSON.stringify(report.drops) },
      };
    }

    if (name === "overnight_events") {
      const windowHours = Number(args.windowHours) > 0 ? Number(args.windowHours) : 12;
      const events = net.getEvents(windowHours);
      return {
        ok: true,
        windowHours,
        count: events.length,
        events,
        artifact: { title: `Event Log (last ${windowHours}h)`, kind: "table", content: JSON.stringify(events) },
      };
    }

    if (name === "active_alerts") {
      const db = await readDb();
      const alerts = net.getAlerts(args.includeCleared === true, db.ackedAlerts);
      return {
        ok: true,
        count: alerts.length,
        alerts: alerts.map(({ detail, ...rest }) => rest),
        artifact: { title: "Alerts", kind: "markdown", content: alertsMarkdown(alerts) },
      };
    }

    if (name === "acknowledge_alert") {
      const alert = net.findAlert(args.alertId);
      if (!alert) {
        return { ok: false, error: `No alert found with id ${args.alertId}.` };
      }
      if (args.confirmed !== true) {
        return {
          ok: false,
          requiresConfirmation: true,
          alert: { id: alert.id, severity: alert.severity, device: alert.device, title: alert.title },
          message: `Confirmation required before acknowledging ${alert.id} (${alert.title}). Ask the engineer to confirm, then call again with confirmed true.`,
        };
      }
      const { db } = await updateDb(async (current) => {
        if (!current.ackedAlerts.includes(alert.id)) current.ackedAlerts.push(alert.id);
      });
      const alerts = net.getAlerts(false, db.ackedAlerts);
      return {
        ok: true,
        acknowledged: alert.id,
        artifact: { title: "Alerts", kind: "markdown", content: alertsMarkdown(alerts) },
      };
    }

    if (name === "topology_show") {
      return {
        ok: true,
        artifact: { title: "Network Topology", kind: "mermaid", content: net.topologyMermaid() },
      };
    }

    if (name === "artifact_show") {
      return { ok: true, artifact: args };
    }

    if (name === "show_menu") {
      return {
        ok: true,
        artifact: { title: "NetJarvis Menu", kind: "markdown", content: buildMenuMarkdown() },
      };
    }

    if (name === "web_search") {
      return await webSearch(args);
    }

    if (name === "note_add") {
      const { db, result } = await updateDb(async (current) => {
        const note = {
          id: crypto.randomUUID(),
          text: String(args.text || ""),
          tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
          createdAt: new Date().toISOString(),
        };
        current.notes.unshift(note);
        return note;
      });
      return {
        ok: true,
        note: result,
        artifact: { title: "Shift Notes", kind: "notes", content: JSON.stringify(db.notes.slice(0, 20), null, 2) },
      };
    }

    return { ok: false, error: `Unknown tool: ${name}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function trafficMarkdown(report) {
  const lines = [];
  lines.push(`# Traffic Report - ${report.measuredAt}`);
  lines.push("");
  lines.push(`Aggregate across key links: ${report.aggregateInGbps} Gbps in / ${report.aggregateOutGbps} Gbps out (${report.vsSameHourYesterday}).`);
  lines.push("");
  if (report.anomalies.length > 0) {
    lines.push("## Anomalies");
    for (const anomaly of report.anomalies) {
      lines.push(`- ${anomaly.device} (${anomaly.alert}): ${anomaly.summary}`);
    }
    lines.push("");
  }
  lines.push("## Busiest links");
  for (const link of report.busiestLinks) {
    lines.push(`- ${link.device} ${link.interface} at ${link.utilization} (${link.inGbps} Gbps in / ${link.outGbps} Gbps out) - ${link.description}`);
  }
  return lines.join("\n");
}

function alertsMarkdown(alerts) {
  if (alerts.length === 0) {
    return "# Alerts\n\nNo active alerts. The board is green.";
  }
  const lines = ["# Alerts", ""];
  for (const alert of alerts) {
    const ack = alert.acknowledged ? " - acknowledged" : "";
    lines.push(`## ${alert.id} - ${alert.title}`);
    lines.push(`- Severity: ${alert.severity} (${alert.state}${ack})`);
    lines.push(`- Device: ${alert.device}`);
    lines.push(`- Raised: ${alert.raised}`);
    lines.push("");
    lines.push(alert.detail);
    lines.push("");
  }
  return lines.join("\n");
}

function buildMenuMarkdown() {
  return `# NetJarvis Menu

Your voice copilot for network operations. Here is what you can ask.

## Start of shift

- "How is my network doing?"
- "Give me the overnight rundown."
- "Anything happen overnight?"

## Routing protocols

- "How is BGP doing?" / "BGP status on EDGE-R3."
- "Any BGP flaps last night?"
- "What's the OSPF status?" / "Are all adjacencies up?"

## Devices and interfaces

- "How are my edge routers?" / "How are the core routers?"
- "What's the health of EDGE-R2?"
- "Any interfaces with errors?"
- "Show me the interface report for CORE-R1."

## Traffic and drops

- "Any increase in traffic?" / "How's traffic looking?"
- "Any drops reported overnight?"
- "What are the busiest links right now?"

## Alerts and events

- "What alerts are active?"
- "Show me the overnight event log."
- "Acknowledge alert ALM-2483." (NetJarvis confirms before acting)

## Big picture

- "Show me the status board."
- "Show me the network topology."

## Extras

- "Search the web for Lumen outage reports."
- "Add a shift note: optic replacement scheduled for EDGE-R2."`;
}

async function webSearch(args) {
  const exaKey = process.env.EXA_API_KEY;
  if (!exaKey) {
    return {
      ok: false,
      missingEnv: "EXA_API_KEY",
      message: "EXA_API_KEY is not set. Add it to .env.local to enable NetJarvis's web search tool.",
    };
  }

  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": exaKey,
    },
    body: JSON.stringify({
      query: String(args.query || ""),
      type: "auto",
      numResults: Math.max(1, Math.min(10, Number(args.numResults || 5))),
      contents: { text: { maxCharacters: 900 } },
    }),
  });

  if (!response.ok) {
    return { ok: false, error: `Exa search failed: ${response.status} ${await response.text()}` };
  }
  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];
  return {
    ok: true,
    results,
    artifact: {
      title: `Web Search: ${args.query}`,
      kind: "markdown",
      content: formatSearchMarkdown(String(args.query || ""), results),
    },
  };
}

function formatSearchMarkdown(query, results) {
  const cleanQuery = query.trim() || "Search";
  if (results.length === 0) {
    return `# ${cleanQuery}\n\nNo strong web results came back for this search. Try a narrower query.`;
  }

  const sections = results.slice(0, 8).map((result, index) => {
    const title = cleanMarkdownText(result.title || result.url || `Result ${index + 1}`);
    const url = String(result.url || "");
    const source = cleanMarkdownText(result.author || hostname(url) || "Source");
    const text = cleanMarkdownText(result.text || result.summary || "").slice(0, 700);
    const published = result.publishedDate ? `\n- Published: ${cleanMarkdownText(result.publishedDate)}` : "";
    const link = url ? `[Open source](${url})` : "Source link unavailable";

    return `### ${index + 1}. ${title}\n\n${text || "No snippet was returned for this result."}\n\n- Source: ${source}${published}\n- ${link}`;
  });

  return [`# ${cleanQuery}`, `NetJarvis found ${results.length} source${results.length === 1 ? "" : "s"}.`, ...sections].join("\n\n");
}

function cleanMarkdownText(value) {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim();
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

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
