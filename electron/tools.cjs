// NetJarvis tool definitions and execution.
//
// This module has no Electron dependency so it can be exercised directly with
// node for testing. The Electron main process wires it to IPC.

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");
const source = require("./network-source.cjs");
const nvd = require("./sources/nvd.cjs");
const checks = require("./checks.cjs");
const artifacts = require("./artifacts.cjs");
const tickets = require("./tickets.cjs");
const trends = require("./problem-trends.cjs");
const mail = require("./mail.cjs");
const prometheus = require("./sources/prometheus.cjs");
const snmp = require("./sources/snmp.cjs");
const { createScheduler } = require("./scheduler.cjs");
const { createAlertWatcher } = require("./alert-watcher.cjs");
const { createAgents } = require("./agents.cjs");
const logger = require("./logger.cjs");

const sim = source.sim;
const exportsDir = path.join(process.cwd(), "data", "exports");

const JARVIS_INSTRUCTIONS = `# Role and Objective
You are NetJarvis, a realtime voice copilot for a senior network operations engineer. You are their eyes on the network. Network operations means anything from layer 1 to layer 7: physical links and optics, L2 switching (VLANs, MAC tables, spanning tree, CDP/LLDP), L3 routing and addressing, transport, and services. Do not assume it is only about BGP or OSPF.

# Data sources
You run against one of two sources, and your network_overview result always tells you which:
- LIVE mode: a real network managed by Cisco Catalyst Center (by default the Cisco DevNet Always-On sandbox, a real four-switch Catalyst 9000v access network: sw1-sw4). Inventory, health, interfaces, topology, and issues come from the Catalyst Center API. For anything deeper - VLANs, MAC address tables, spanning tree, CDP neighbors, ARP, routes, counters, version - use run_show_command to execute read-only "show" commands on the actual switches and summarize the output.
- SIM mode: a built-in simulated service-provider network, used when the live source is unreachable.
Never invent facts about the network. If a tool fails or the network does not run a protocol (for example BGP on an access switch), say so plainly.

# Personality and Tone
Talk like a sharp NOC colleague, not a chatbot. Confident, concise, calm. Lead with the answer, then the one or two details that matter.

# Core behavior
- Shift start, "how is my network doing", "give me the rundown": call network_overview immediately and speak the headlines in a few sentences. The dashboard on the right side of the app always shows the live picture; reference it ("you can see it on the dashboard").
- "What devices do we have": network_inventory.
- Device health, CPU, memory, reachability: device_health.
- Interfaces, ports, links up/down, VLAN assignment: interface_report (problemsOnly true when they ask about errors or issues).
- Topology, "show me the network": topology_show.
- Alerts, issues, events, "anything happen overnight": active_alerts or overnight_events.
- Anything layer 2/3 or CLI-level in LIVE mode (VLANs, MAC table, spanning tree, CDP neighbors, ARP, routing table, BGP/OSPF state, versions, logs, counters, drops): run_show_command with the right IOS-XE show command, then summarize. Examples: "show vlan brief", "show mac address-table", "show spanning-tree summary", "show cdp neighbors", "show ip arp", "show ip route", "show ip ospf neighbor", "show ip bgp summary", "show interfaces counters errors", "show logging | last 20", "show processes cpu sorted | exclude 0.00".
- In SIM mode, bgp_status, ospf_status, traffic_report, and drop_report answer from the simulator.
- Use web_search only for outside-world questions (vendor advisories, outage news).
- Use note_add for shift or handoff notes.

# Your team (hierarchy and delegation)
You are the SME lead. Your org chart (shown on the left panel):
- Data Team: Data Network Agent (switching, routing, STP, VLANs, interfaces, capacity)
- Security Team: Firewall Agent, Proxy Agent, Load Balancer Agent
- Incident Management: Change Management Agent, Incident Management Agent, Problem Management Agent
Every tool you run AND every delegation appears live on the Team Board and the agent roster on the left.
- Deep investigations or explicit handoffs: announce briefly ("Handing this to the Data agent") and call delegate_task. Teams: data, firewall, loadbalancer, proxy, change, incident, problem.
- Delegation blocks 15-60s until the specialist finishes; summarize the report aloud.
- Quick facts (one show command, a health check): run the tool yourself - it still shows on the board under the routed specialist team.
- Use team_board when the engineer asks what the team is working on.
- Use incident_ticket_open / incident_ticket_list for formal incident records.
- Use problem_trends for recurring-issue history from accumulated snapshots.
- Use send_email when the engineer wants email delivery (not just copy-paste). SMTP must be configured in .env.local.
- Use shift_briefing for an on-demand shift rundown (scheduled briefings also run automatically).
- Use multi_source_status to report Catalyst Center plus optional Prometheus/SNMP adapters.

# Pre-checks and comparisons
- "Run a pre-check" or "take a snapshot": call precheck_capture with a label like "pre-maintenance". It records device health, all interfaces, and error counters.
- "Post-check", "compare", "did anything change": call precheck_capture (label "post-...") then precheck_compare. Report the diff plainly: what changed, what did not.

# Exports and files
- When the engineer wants data as Excel, CSV, a file, or a download: call export_csv with a title, headers, and rows built from data you already gathered. The Reports panel then shows the table with a "Download CSV" button - tell the engineer to click it. Every report also has Copy and Copy-as-email buttons.

# Tool behavior
- Call tools directly when intent is clear; never invent numbers a tool can give you.
- You have NO background work. Every tool returns its result before you speak. NEVER say "I'm still checking", "it's running on my side", or "I'll get back to you" - either call a tool now and answer from its result, or say plainly that you cannot get that data and why.
- If you are interrupted mid-turn, any tool call you had not finished issuing NEVER RAN. Call the tool again immediately; never claim a command is still in progress.
- For spanning tree overviews prefer "show spanning-tree summary" (fast); use the full "show spanning-tree" only for one device at a time.
- Security/vulnerability questions ("any vulnerabilities on these switches?", "any CVEs for this version?"): call vulnerability_check. It reads the devices' real software version and queries the NVD CVE database. Summarize the worst findings by severity and remind that exposure depends on enabled features.
- After a tool runs, speak a short summary; the full detail renders in the Reports tab and the dashboard.
- Acknowledging an alert changes state: summarize the alert and get a clear yes before calling acknowledge_alert with confirmed true.
- run_show_command accepts only read-only "show" commands. Never attempt configuration changes.
- If a tool returns ok false, tell the engineer what failed using the error text. Do not pretend it is still in progress.

# Audio
Let the engineer interrupt you. If audio is unclear, ask one short clarifying question instead of guessing.`;

const toolSpecs = [
  {
    type: "function",
    name: "network_overview",
    description: "Start-of-shift overview of the whole network: source mode (live Catalyst Center or simulator), overall health, per-device state, links, active issues, and recent events. Call for 'how is my network doing', 'give me the rundown', or at shift start.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "network_inventory",
    description: "List every managed device: hostname, management IP, role, platform, software, reachability, uptime.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "network_status_board",
    description: "Show the color-coded status board (one tile per device) in the panel. The right-hand dashboard shows this continuously; use this tool when the engineer explicitly asks for the board.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "device_health",
    description: "Health for devices: reachability, health score, CPU, memory, uptime. Scope can be a device name, or a role in SIM mode (core, edge, distribution, firewall). Omit for all devices.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Device name (e.g. sw1, EDGE-R2) or role. Omit for all." },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "interface_report",
    description: "Interface status per device: up/down, admin state, speed, port mode, VLAN, IP. Set problemsOnly true to list only down or flagged interfaces.",
    parameters: {
      type: "object",
      properties: {
        device: { type: "string", description: "Optional device name, or 'all'" },
        problemsOnly: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "run_show_command",
    description: "LIVE mode: run one or two read-only IOS-XE 'show' commands on a device (or all devices) through Catalyst Center Command Runner and get the raw CLI output. Use for anything L1-L7: 'show vlan brief', 'show mac address-table', 'show spanning-tree summary', 'show cdp neighbors', 'show ip route', 'show ip arp', 'show ip ospf neighbor', 'show ip bgp summary', 'show interfaces counters errors', 'show version', 'show logging | last 20'. Only 'show' commands are permitted.",
    parameters: {
      type: "object",
      properties: {
        device: { type: "string", description: "Device hostname, or 'all' for every device" },
        commands: { type: "array", items: { type: "string" }, description: "One or two read-only show commands" },
      },
      required: ["commands"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "topology_show",
    description: "Render the network topology diagram (devices and links) in the panel.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "active_alerts",
    description: "Active alerts/issues with severity and detail. In LIVE mode these are Catalyst Center issues; in SIM mode, simulator alerts.",
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
    name: "overnight_events",
    description: "Recent event log over a time window (default 12 hours): alarms, flaps, syncs, logins, anomalies.",
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
    name: "acknowledge_alert",
    description: "Acknowledge a simulator alert by id (e.g. ALM-2483). Summarize the alert and get explicit confirmation first, then call with confirmed true. In LIVE mode issues are managed in Catalyst Center and cannot be acknowledged from here.",
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
    name: "bgp_status",
    description: "BGP status. LIVE mode runs 'show ip bgp summary' on the devices; SIM mode reports the simulated eBGP/iBGP sessions.",
    parameters: {
      type: "object",
      properties: {
        device: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "ospf_status",
    description: "OSPF status. LIVE mode runs 'show ip ospf neighbor' and 'show ip protocols' on the devices; SIM mode reports simulated adjacencies.",
    parameters: {
      type: "object",
      properties: {
        device: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "traffic_report",
    description: "Traffic picture. LIVE mode runs 'show interfaces counters' on the device(s); SIM mode reports utilization, anomalies, and busiest links.",
    parameters: {
      type: "object",
      properties: {
        device: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "drop_report",
    description: "Packet drop and error report. LIVE mode runs 'show interfaces counters errors' on the device(s); SIM mode reports simulated drops over a window.",
    parameters: {
      type: "object",
      properties: {
        device: { type: "string" },
        windowHours: { type: "number", minimum: 1, maximum: 24 },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "delegate_task",
    description: "Hand a task off to a specialist agent on your team. The task shows up on the Team Board (Kanban) and the left agent roster; the specialist investigates with read-only network tools and returns a written report. Blocks until done (15-60s). Teams: data (switching/routing/STP/VLANs/interfaces/capacity), firewall, loadbalancer, proxy, change (pre/post checks), incident (alert triage/tickets), problem (root cause/trends).",
    parameters: {
      type: "object",
      properties: {
        team: { type: "string", enum: ["data", "firewall", "loadbalancer", "proxy", "change", "incident", "problem"] },
        task: { type: "string", description: "Precise task for the specialist, e.g. 'Check spanning tree health across all switches: root bridge, blocked ports, any loops or flapping.'" },
      },
      required: ["team", "task"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "team_board",
    description: "Show the team's Kanban board: every delegated task with its agent, status (queued/in progress/done/failed), steps taken, and results.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "precheck_capture",
    description: "Capture a labeled pre/post-check snapshot of the network: device health, every interface (status/admin/vlan/ip), and interface error counters. Use before and after changes or at shift boundaries.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Snapshot label, e.g. 'pre-maintenance' or 'post-change'" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "precheck_compare",
    description: "Compare two pre/post-check snapshots and report exactly what changed: device reachability/health, interface status/admin/vlan/ip changes, and error-counter increases. Defaults to the two most recent snapshots.",
    parameters: {
      type: "object",
      properties: {
        before: { type: "string", description: "Snapshot id or label (optional; defaults to second-most-recent)" },
        after: { type: "string", description: "Snapshot id or label (optional; defaults to most recent)" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "export_csv",
    description: "Create a downloadable CSV file (opens in Excel) from data you have already gathered. The Reports panel shows the table with a Download CSV button. Use whenever the engineer asks for Excel, CSV, a spreadsheet, or a downloadable file.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "File title, e.g. 'IOS-XE vulnerabilities'" },
        headers: { type: "array", items: { type: "string" } },
        rows: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Data rows matching the headers" },
      },
      required: ["title", "headers", "rows"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "vulnerability_check",
    description: "Check for known vulnerabilities (CVEs) affecting the network's software. Reads the devices' real software type/version from inventory and queries the NVD CVE database for recent published CVEs. Use for any 'vulnerabilities / CVEs / security advisories on these switches' question. No API key needed.",
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Optional override search keyword, e.g. 'Cisco IOS XE 17.12'. Defaults to the software the devices actually run." },
        windowDays: { type: "number", minimum: 7, maximum: 119, description: "How far back to search (days, max 119). Default 119." },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "artifact_show",
    description: "Show structured content in the Reports panel. Use for ad-hoc notes, markdown summaries, code/config snippets, or tables you compose yourself.",
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
    description: "Show NetJarvis's capability menu. Call when the engineer asks what NetJarvis can do or says 'show me the menu'.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "web_search",
    description: "Search the web with Exa. Use for outside-world context: vendor advisories, CVEs, ISP outage news.",
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
    name: "incident_ticket_open",
    description: "Open a formal incident ticket in the Incident Management Agent ticket store. Use when triaging a real incident that needs tracking.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        device: { type: "string" },
        summary: { type: "string" },
        sourceAlertId: { type: "string" },
      },
      required: ["title", "summary"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "incident_ticket_list",
    description: "List open and recent incident tickets from the Incident Management Agent ticket store.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "problem_trends",
    description: "Problem Management Agent: trend history built from accumulated pre-check snapshots (health score, down interfaces, error counter totals over time).",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", minimum: 2, maximum: 30 },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "send_email",
    description: "Send a report by SMTP email (not copy-paste). Requires SMTP_HOST, SMTP_USER, SMTP_PASS in .env.local.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "shift_briefing",
    description: "Run an on-demand shift briefing: network overview headlines plus active issues. Scheduled automatic briefings also run in the background.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "multi_source_status",
    description: "Report status across all configured data sources: Catalyst Center (primary), plus optional Prometheus and SNMP adapters.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
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

function createTools({ readDb, updateDb }) {
  const agents = createAgents({
    executeTool: (name, args, context) => execute(name, args, context),
    toolSpecs,
  });

  let scheduler;
  const alertWatcher = createAlertWatcher({ getSnapshot: source.getSnapshot });

  async function execute(name, args, context = {}) {
    const started = Date.now();
    const result = await executeInner(name, args, context);
    logger.log("tool.execute", {
      tool: name,
      args,
      ms: Date.now() - started,
      ok: result.ok !== false,
      error: result.error,
      artifactKind: result.artifact?.kind,
      artifactTitle: result.artifact?.title,
    });
    if (result.artifact?.title && result.artifact?.content) {
      const route = agents.TOOL_ROUTING?.[name];
      const saved = await artifacts.saveArtifact({
        tool: name,
        team: route?.team || "jarvis",
        artifact: result.artifact,
      });
      if (saved) {
        result.artifactId = saved.id;
        result.artifact = { ...result.artifact, downloadUrl: saved.downloadUrl, downloadName: saved.downloadName || result.artifact.downloadName };
      }
    }
    if (!context.skipActivity) {
      await agents.recordJarvisActivity(name, args, result);
    }
    return result;
  }

  async function executeInner(name, args, context = {}) {
    try {
      switch (name) {
        case "network_overview":
          return await networkOverview();
        case "network_inventory":
          return await networkInventory();
        case "network_status_board":
          return await networkStatusBoard();
        case "device_health":
          return await deviceHealth(args);
        case "interface_report":
          return await interfaceReport(args);
        case "run_show_command":
          return await runShowCommand(args);
        case "topology_show":
          return await topologyShow();
        case "active_alerts":
          return await activeAlerts(args);
        case "overnight_events":
          return await overnightEvents(args);
        case "acknowledge_alert":
          return await acknowledgeAlert(args);
        case "bgp_status":
          return await protocolStatus(args, "bgp");
        case "ospf_status":
          return await protocolStatus(args, "ospf");
        case "traffic_report":
          return await trafficReport(args);
        case "drop_report":
          return await dropReport(args);
        case "vulnerability_check":
          return await vulnerabilityCheck(args);
        case "delegate_task":
          return await delegateTask(args);
        case "team_board":
          return await teamBoard();
        case "precheck_capture":
          return await precheckCapture(args);
        case "precheck_compare":
          return await precheckCompare(args);
        case "export_csv":
          return await exportCsv(args);
        case "artifact_show":
          return { ok: true, artifact: args };
        case "show_menu":
          return await showMenu();
        case "web_search":
          return await webSearch(args);
        case "incident_ticket_open":
          return await incidentTicketOpen(args);
        case "incident_ticket_list":
          return await incidentTicketList();
        case "problem_trends":
          return await problemTrends(args);
        case "send_email":
          return await sendEmailTool(args);
        case "shift_briefing":
          return await shiftBriefing(context);
        case "multi_source_status":
          return await multiSourceStatus();
        case "note_add":
          return await noteAdd(args);
        default:
          return { ok: false, error: `Unknown tool: ${name}` };
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // -------------------------------------------------------------------------
  // Overview / inventory / board
  // -------------------------------------------------------------------------

  async function networkOverview() {
    const snapshot = await source.getSnapshot();
    const markdown = overviewMarkdown(snapshot);
    return {
      ok: true,
      mode: snapshot.mode,
      source: snapshot.source,
      overall: snapshot.overall,
      healthScore: snapshot.health.score,
      devices: snapshot.devices.map((device) => `${device.name} ${device.status}${device.note ? ` (${device.note})` : ""}`),
      activeIssues: snapshot.issues.active,
      artifact: { title: "Network Overview", kind: "markdown", content: markdown },
    };
  }

  async function networkInventory() {
    const rows = await source.getInventoryRows();
    const { mode } = await source.getMode();
    return {
      ok: true,
      mode,
      count: rows.length,
      devices: rows,
      artifact: { title: `Inventory (${rows.length} devices)`, kind: "table", content: JSON.stringify(rows) },
    };
  }

  async function networkStatusBoard() {
    const snapshot = await source.getSnapshot();
    return {
      ok: true,
      mode: snapshot.mode,
      overall: snapshot.overall,
      healthScore: snapshot.health.score,
      activeIssues: snapshot.issues.active,
      artifact: { title: "Network Status Board", kind: "statusBoard", content: JSON.stringify(snapshot) },
    };
  }

  // -------------------------------------------------------------------------
  // Devices / interfaces / CLI
  // -------------------------------------------------------------------------

  async function deviceHealth(args) {
    const { mode } = await source.getMode();
    if (mode === "live") {
      const snapshot = await source.getSnapshot();
      const query = String(args.scope || "").trim().toLowerCase();
      let rows = snapshot.devices;
      if (query && query !== "all") rows = rows.filter((device) => device.name.toLowerCase().includes(query));
      const table = rows.map((device) => ({
        device: device.name,
        ip: device.ip,
        role: device.role,
        status: device.status,
        healthScore: device.healthScore != null ? `${device.healthScore}/10` : "",
        reachability: device.reachability,
        cpu: device.cpu,
        memory: device.memory,
        uptime: device.uptime,
        software: device.software,
      }));
      return {
        ok: true,
        mode,
        devices: table,
        artifact: { title: `Device Health (${query || "all"})`, kind: "table", content: JSON.stringify(table) },
      };
    }
    const db = await readDb();
    const health = sim.getDeviceHealth(args.scope, db.ackedAlerts);
    return {
      ok: true,
      mode,
      scope: health.scope,
      devices: health.devices,
      artifact: { title: `Device Health (${health.scope})`, kind: "table", content: JSON.stringify(health.devices) },
    };
  }

  async function interfaceReport(args) {
    const { mode } = await source.getMode();
    if (mode === "live") {
      let rows = await source.getLiveInterfaces(args.device);
      let scope = args.device ? String(args.device) : "all devices";
      if (args.problemsOnly === true) {
        rows = rows.filter((row) => row.status !== "up" || String(row.adminStatus).toUpperCase() !== "UP");
        scope += " (problems only)";
      }
      return {
        ok: true,
        mode,
        count: rows.length,
        interfaces: rows,
        artifact: { title: `Interfaces (${scope})`, kind: "table", content: JSON.stringify(rows) },
      };
    }
    const report = sim.getInterfaceReport(args.device, args.problemsOnly === true);
    return {
      ok: true,
      mode,
      scope: report.scope,
      interfaces: report.interfaces,
      artifact: { title: `Interfaces (${report.scope})`, kind: "table", content: JSON.stringify(report.interfaces) },
    };
  }

  async function runShowCommand(args) {
    const { mode } = await source.getMode();
    const commands = (Array.isArray(args.commands) ? args.commands : []).map(String).filter(Boolean);
    if (commands.length === 0) {
      return { ok: false, error: "Provide at least one read-only 'show' command." };
    }
    if (mode !== "live") {
      return {
        ok: false,
        mode,
        error: "run_show_command needs the live Catalyst Center source, which is not reachable right now. Answer from the simulator tools instead.",
      };
    }
    const result = await source.runLiveShowCommands(args.device, commands);
    return {
      ok: true,
      mode,
      scope: result.scope,
      outputs: trimOutputs(result.outputs),
      artifact: { title: `CLI: ${commands.join(" / ")}`, kind: "code", content: formatCliOutputs(result.outputs) },
    };
  }

  async function topologyShow() {
    const { mode } = await source.getMode();
    if (mode === "live") {
      const { mermaid, topology } = await source.getLiveTopologyMermaid();
      return {
        ok: true,
        mode,
        nodes: topology.nodes.map((node) => node.label),
        linkCount: topology.links.length,
        links: topology.links.map((link) => `${link.source} ${link.sourcePort} <-> ${link.target} ${link.targetPort} (${link.status})`),
        artifact: { title: "Network Topology (live)", kind: "mermaid", content: mermaid },
      };
    }
    return {
      ok: true,
      mode,
      artifact: { title: "Network Topology (simulated)", kind: "mermaid", content: sim.topologyMermaid() },
    };
  }

  // -------------------------------------------------------------------------
  // Alerts / events
  // -------------------------------------------------------------------------

  async function activeAlerts(args) {
    const { mode } = await source.getMode();
    if (mode === "live") {
      const snapshot = await source.getSnapshot();
      const items = snapshot.issues.items || [];
      const markdown =
        items.length === 0
          ? "# Alerts\n\nCatalyst Center reports no active issues. The board is green."
          : ["# Alerts (Catalyst Center issues)", "", ...items.map((issue) => `- **${issue.name || issue.issueId}** - priority ${issue.priority || "n/a"}, status ${issue.status || "active"}`)].join("\n");
      return { ok: true, mode, count: items.length, issues: items, artifact: { title: "Alerts", kind: "markdown", content: markdown } };
    }
    const db = await readDb();
    const alerts = sim.getAlerts(args.includeCleared === true, db.ackedAlerts);
    return {
      ok: true,
      mode,
      count: alerts.length,
      alerts: alerts.map(({ detail, ...rest }) => rest),
      artifact: { title: "Alerts", kind: "markdown", content: alertsMarkdown(alerts) },
    };
  }

  async function overnightEvents(args) {
    const { mode } = await source.getMode();
    const windowHours = Number(args.windowHours) > 0 ? Number(args.windowHours) : 12;
    if (mode === "live") {
      const snapshot = await source.getSnapshot();
      const events = snapshot.events;
      return {
        ok: true,
        mode,
        count: events.length,
        events,
        artifact: { title: "Recent Events (Catalyst Center)", kind: "table", content: JSON.stringify(events) },
      };
    }
    const events = sim.getEvents(windowHours);
    return {
      ok: true,
      mode,
      windowHours,
      count: events.length,
      events,
      artifact: { title: `Event Log (last ${windowHours}h)`, kind: "table", content: JSON.stringify(events) },
    };
  }

  async function acknowledgeAlert(args) {
    const { mode } = await source.getMode();
    if (mode === "live") {
      return { ok: false, mode, error: "Live issues are managed in Catalyst Center and cannot be acknowledged from NetJarvis yet." };
    }
    const alert = sim.findAlert(args.alertId);
    if (!alert) return { ok: false, error: `No alert found with id ${args.alertId}.` };
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
    const alerts = sim.getAlerts(false, db.ackedAlerts);
    return { ok: true, acknowledged: alert.id, artifact: { title: "Alerts", kind: "markdown", content: alertsMarkdown(alerts) } };
  }

  // -------------------------------------------------------------------------
  // Protocols / traffic / drops
  // -------------------------------------------------------------------------

  async function protocolStatus(args, protocol) {
    const { mode } = await source.getMode();
    if (mode === "live") {
      const commands = protocol === "bgp" ? ["show ip bgp summary"] : ["show ip ospf neighbor", "show ip protocols"];
      const result = await source.runLiveShowCommands(args.device, commands);
      return {
        ok: true,
        mode,
        scope: result.scope,
        outputs: trimOutputs(result.outputs),
        note: "Raw CLI output; summarize honestly. If the device does not run this protocol, say so.",
        artifact: { title: `${protocol.toUpperCase()} Status (live CLI)`, kind: "code", content: formatCliOutputs(result.outputs) },
      };
    }
    if (protocol === "bgp") {
      const status = sim.getBgpStatus(args.device);
      return {
        ok: true,
        mode,
        scope: status.scope,
        established: status.established,
        totalSessions: status.totalSessions,
        down: status.down,
        flapsLast24h: status.flapsLast24h,
        flappedSessions: status.flappedSessions,
        artifact: { title: `BGP Status (${status.scope})`, kind: "table", content: JSON.stringify(status.sessions) },
      };
    }
    const status = sim.getOspfStatus();
    return {
      ok: true,
      mode,
      full: status.full,
      totalAdjacencies: status.totalAdjacencies,
      down: status.down,
      adjacencyChanges24h: status.adjacencyChanges24h,
      areas: status.areas,
      artifact: { title: "OSPF Adjacencies", kind: "table", content: JSON.stringify(status.neighbors) },
    };
  }

  async function trafficReport(args) {
    const { mode } = await source.getMode();
    if (mode === "live") {
      const result = await source.runLiveShowCommands(args.device, ["show interfaces counters"]);
      return {
        ok: true,
        mode,
        scope: result.scope,
        outputs: trimOutputs(result.outputs),
        artifact: { title: "Traffic Counters (live CLI)", kind: "code", content: formatCliOutputs(result.outputs) },
      };
    }
    const report = sim.getTrafficReport();
    return {
      ok: true,
      mode,
      ...report,
      artifact: { title: "Traffic Report", kind: "markdown", content: trafficMarkdown(report) },
    };
  }

  async function dropReport(args) {
    const { mode } = await source.getMode();
    if (mode === "live") {
      const result = await source.runLiveShowCommands(args.device, ["show interfaces counters errors"]);
      return {
        ok: true,
        mode,
        scope: result.scope,
        outputs: trimOutputs(result.outputs),
        note: "Raw error counters; call out any non-zero columns.",
        artifact: { title: "Interface Errors (live CLI)", kind: "code", content: formatCliOutputs(result.outputs) },
      };
    }
    const report = sim.getDropReport(args.windowHours);
    return {
      ok: true,
      mode,
      windowHours: report.windowHours,
      drops: report.drops,
      artifact: { title: `Drops (last ${report.windowHours}h)`, kind: "table", content: JSON.stringify(report.drops) },
    };
  }

  // -------------------------------------------------------------------------
  // Vulnerabilities
  // -------------------------------------------------------------------------

  async function vulnerabilityCheck(args) {
    const rows = await source.getInventoryRows();
    const softwareSet = [...new Set(rows.map((row) => row.software).filter(Boolean))];
    const platformSet = [...new Set(rows.map((row) => row.platform).filter(Boolean))];

    // "IOS-XE 17.12.1prd9" -> "Cisco IOS XE"; version reported separately so
    // the NVD keyword stays broad enough to match advisories.
    const primary = softwareSet[0] || "Cisco IOS XE";
    const softwareFamily = primary.replace(/-/g, " ").replace(/\s+[\d.].*$/, "").trim();
    const keyword = String(args.keyword || "").trim() || `Cisco ${softwareFamily}`.replace(/^Cisco Cisco/i, "Cisco");

    const windowDays = Number(args.windowDays) >= 7 ? Number(args.windowDays) : 119;
    const result = await nvd.searchCves(keyword, { windowDays, limit: 12 });

    const counts = {};
    for (const cve of result.cves) counts[cve.severity || "UNRATED"] = (counts[cve.severity || "UNRATED"] || 0) + 1;

    const lines = [];
    lines.push(`# Vulnerability Check - ${keyword}`);
    lines.push("");
    lines.push(`Devices run: ${softwareSet.join(", ") || "unknown"} on ${platformSet.join(", ") || "unknown platforms"}.`);
    lines.push(`NVD reports **${result.totalInWindow}** published CVEs matching "${keyword}" in the last ${result.windowDays} days. Top ${result.cves.length} by severity:`);
    lines.push("");
    for (const cve of result.cves) {
      lines.push(`## ${cve.id} - ${cve.severity || "UNRATED"}${cve.score != null ? ` (${cve.score})` : ""}`);
      lines.push(`- Published: ${cve.published}`);
      lines.push(`- [NVD entry](${cve.url})`);
      lines.push("");
      lines.push(cve.description.slice(0, 400));
      lines.push("");
    }
    lines.push("---");
    lines.push("Note: NVD keyword matches are broad. Whether a CVE actually applies depends on the exact release train and which features are enabled. Cross-check the Cisco Security Advisories portal for fixed-in versions.");

    return {
      ok: true,
      keyword,
      software: softwareSet,
      totalInWindow: result.totalInWindow,
      severityCounts: counts,
      topCves: result.cves.map((cve) => ({ id: cve.id, severity: cve.severity, score: cve.score, published: cve.published })),
      artifact: { title: `Vulnerabilities: ${keyword}`, kind: "markdown", content: lines.join("\n") },
    };
  }

  // -------------------------------------------------------------------------
  // Team delegation / Kanban
  // -------------------------------------------------------------------------

  async function delegateTask(args) {
    const outcome = await agents.delegate(args.team, args.task);
    return {
      ok: true,
      taskId: outcome.taskId,
      team: outcome.teamName,
      report: outcome.result,
      artifact: {
        title: `${outcome.teamName}: ${String(args.task).slice(0, 60)}`,
        kind: "markdown",
        content: `# ${outcome.teamName} report\n\nTask: ${args.task}\n\n---\n\n${outcome.result}`,
      },
    };
  }

  async function teamBoard() {
    const listResult = await agents.listTasks({ limit: 500 });
    const tasks = listResult.tasks || [];
    return {
      ok: true,
      counts: {
        queued: tasks.filter((task) => task.status === "queued").length,
        inProgress: tasks.filter((task) => task.status === "in_progress").length,
        done: tasks.filter((task) => task.status === "done").length,
        failed: tasks.filter((task) => task.status === "failed").length,
      },
      storeCap: listResult.storeCap,
      storeCount: listResult.storeCount,
      tasks: tasks.slice(0, 10).map((task) => ({ id: task.id, team: task.teamName, title: task.title, status: task.status })),
      artifact: { title: "Team Board", kind: "taskBoard", content: JSON.stringify({ tasks }) },
    };
  }

  // -------------------------------------------------------------------------
  // Pre-checks
  // -------------------------------------------------------------------------

  async function precheckCapture(args) {
    const snapshot = await checks.captureSnapshot(args.label);
    const all = await checks.listSnapshots();
    return {
      ok: true,
      id: snapshot.id,
      label: snapshot.label,
      devices: snapshot.devices.length,
      interfaces: snapshot.interfaces.length,
      errorCountersCaptured: Object.keys(snapshot.errorCounters || {}).length > 0,
      totalSnapshots: all.length,
      artifact: {
        title: `Pre-check captured: ${snapshot.label}`,
        kind: "markdown",
        content: [
          `# Pre-check snapshot: ${snapshot.label}`,
          "",
          `- Id: ${snapshot.id}`,
          `- Taken: ${snapshot.at}`,
          `- Source: ${snapshot.mode === "live" ? "live network" : "simulator"}`,
          `- Devices captured: ${snapshot.devices.length}`,
          `- Interfaces captured: ${snapshot.interfaces.length}`,
          `- Error counters captured: ${Object.keys(snapshot.errorCounters || {}).length > 0 ? "yes" : "no"}`,
          "",
          `Existing snapshots: ${all.map((snap) => `${snap.label} (${snap.at.slice(11, 16)})`).join(", ")}`,
          "",
          "Run the change, then say \"run a post-check and compare\" to see exactly what changed.",
        ].join("\n"),
      },
    };
  }

  async function precheckCompare(args) {
    const diff = await checks.compareSnapshots(args.before, args.after);
    const lines = [];
    lines.push(`# Pre/post comparison`);
    lines.push("");
    lines.push(`Before: **${diff.before.label}** (${diff.before.at}) - After: **${diff.after.label}** (${diff.after.at})`);
    lines.push("");
    if (diff.totalChanges === 0) {
      lines.push("**No changes detected.** Devices, interfaces, and error counters are identical between the two snapshots.");
    } else {
      lines.push(`**${diff.totalChanges} change${diff.totalChanges === 1 ? "" : "s"} detected.**`);
      if (diff.changes.devices.length > 0) {
        lines.push("", "## Device changes");
        for (const change of diff.changes.devices) lines.push(`- ${change}`);
      }
      if (diff.changes.interfaces.length > 0) {
        lines.push("", "## Interface changes");
        for (const change of diff.changes.interfaces) lines.push(`- ${change}`);
      }
      if (diff.changes.errorCounters.length > 0) {
        lines.push("", "## Error counter increases");
        for (const change of diff.changes.errorCounters) lines.push(`- ${change}`);
      }
    }
    return { ok: true, ...diff, artifact: { title: "Pre/Post Comparison", kind: "markdown", content: lines.join("\n") } };
  }

  // -------------------------------------------------------------------------
  // CSV export
  // -------------------------------------------------------------------------

  async function exportCsv(args) {
    const headers = (Array.isArray(args.headers) ? args.headers : []).map(String);
    const rows = (Array.isArray(args.rows) ? args.rows : []).map((row) => (Array.isArray(row) ? row.map(String) : [String(row)]));
    if (headers.length === 0 || rows.length === 0) {
      return { ok: false, error: "export_csv needs headers and at least one row." };
    }
    const escape = (value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const csv = [headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))].join("\r\n");

    const slug = String(args.title || "export").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "export";
    const filename = `${slug}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.csv`;
    await fs.mkdir(exportsDir, { recursive: true });
    await fs.writeFile(path.join(exportsDir, filename), csv, "utf8");
    logger.log("export.csv", { filename, rows: rows.length });

    const tableRows = rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
    return {
      ok: true,
      filename,
      rows: rows.length,
      downloadUrl: `/api/exports/${filename}`,
      artifact: {
        title: String(args.title || "Export"),
        kind: "table",
        content: JSON.stringify(tableRows),
        downloadUrl: `/api/exports/${filename}`,
        downloadName: filename,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Menu / search / notes
  // -------------------------------------------------------------------------

  async function showMenu() {
    const { mode, source: label } = await source.getMode();
    return {
      ok: true,
      artifact: { title: "NetJarvis Menu", kind: "markdown", content: buildMenuMarkdown(mode, label) },
    };
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

  async function incidentTicketOpen(args) {
    const ticket = await tickets.openTicket(args);
    const lines = [
      `# Incident ticket opened`,
      "",
      `- Id: ${ticket.id}`,
      `- Title: ${ticket.title}`,
      `- Severity: ${ticket.severity}`,
      `- Device: ${ticket.device || "n/a"}`,
      "",
      ticket.summary,
    ];
    return {
      ok: true,
      ticket,
      artifact: { title: `Ticket ${ticket.id}`, kind: "markdown", content: lines.join("\n") },
    };
  }

  async function incidentTicketList() {
    const list = await tickets.listTickets();
    const open = list.filter((ticket) => ticket.status === "open");
    return {
      ok: true,
      count: list.length,
      open: open.length,
      tickets: list.slice(0, 20),
      artifact: { title: "Incident Tickets", kind: "table", content: JSON.stringify(list.slice(0, 20)) },
    };
  }

  async function problemTrends(args) {
    const history = await trends.buildTrendHistory(Number(args.limit) || 12);
    const lines = ["# Problem trend history", "", `Snapshots analyzed: ${history.snapshotCount}`, ""];
    if (history.points.length > 0) {
      lines.push("## Timeline");
      for (const point of history.points) {
        lines.push(`- ${point.label} (${point.at.slice(0, 16)}): health ${point.healthScore ?? "n/a"}%, down ifaces ${point.downInterfaces}, error counters ${point.errorCounterTotal}`);
      }
    }
    if (history.trends.length > 0) {
      lines.push("", "## Detected shifts");
      for (const trend of history.trends) {
        lines.push(`- ${trend.from} -> ${trend.to}: ${trend.changes.join("; ")}`);
      }
    } else {
      lines.push("", "No significant shifts detected between snapshots yet. Run more pre-checks to build trend history.");
    }
    return {
      ok: true,
      ...history,
      artifact: { title: "Problem Trend History", kind: "markdown", content: lines.join("\n") },
    };
  }

  async function sendEmailTool(args) {
    const outcome = await mail.sendEmail(args);
    if (!outcome.ok) return outcome;
    return {
      ok: true,
      messageId: outcome.messageId,
      artifact: {
        title: `Email sent: ${args.subject}`,
        kind: "markdown",
        content: `# Email sent\n\n- To: ${args.to}\n- Subject: ${args.subject}\n- Message id: ${outcome.messageId}`,
      },
    };
  }

  async function shiftBriefing(context = {}) {
    const snapshot = await source.getSnapshot();
    const markdown = overviewMarkdown(snapshot);
    const prefix = context.scheduled ? "# Scheduled shift briefing\n\n" : "# Shift briefing\n\n";
    return {
      ok: true,
      scheduled: Boolean(context.scheduled),
      overall: snapshot.overall,
      healthScore: snapshot.health?.score,
      activeIssues: snapshot.issues?.active,
      artifact: { title: context.scheduled ? "Scheduled Shift Briefing" : "Shift Briefing", kind: "markdown", content: prefix + markdown },
    };
  }

  async function multiSourceStatus() {
    const snapshot = await source.getSnapshot();
    const prom = await prometheus.getSummary();
    const snmpStatus = await snmp.getSummary();
    const lines = [
      "# Multi-source status",
      "",
      `## Catalyst Center (${snapshot.mode === "live" ? "LIVE" : "SIM"})`,
      `- Overall: ${snapshot.overall}`,
      `- Devices: ${snapshot.devices?.length || 0}`,
      `- Active issues: ${snapshot.issues?.active || 0}`,
      "",
      "## Prometheus",
      prom.ok ? `- Targets: ${prom.targets}, up ${prom.up}, down ${prom.down}` : `- ${prom.error || "not configured"}`,
      "",
      "## SNMP",
      snmpStatus.ok ? `- Host: ${snmpStatus.host} (${snmpStatus.note})` : `- ${snmpStatus.error || "not configured"}`,
    ];
    return {
      ok: true,
      catalyst: { mode: snapshot.mode, overall: snapshot.overall },
      prometheus: prom,
      snmp: snmpStatus,
      artifact: { title: "Multi-source Status", kind: "markdown", content: lines.join("\n") },
    };
  }

  async function noteAdd(args) {
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

  scheduler = createScheduler({
    runBriefing: async () => {
      const result = await execute("shift_briefing", {}, { scheduled: true });
      return { title: result.artifact?.title, overall: result.overall };
    },
  });

  function startBackgroundServices() {
    scheduler.start();
    alertWatcher.start();
  }

  return {
    toolSpecs,
    instructions: JARVIS_INSTRUCTIONS,
    execute,
    getSnapshot: source.getSnapshot,
    listTasks: agents.listTasks,
    getOrg: agents.getOrg,
    listArtifacts: artifacts.listArtifacts,
    getArtifactDownload: artifacts.getDownload,
    scheduler,
    alertWatcher,
    startBackgroundServices,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function overviewMarkdown(snapshot) {
  const lines = [];
  const modeLabel = snapshot.mode === "live" ? "LIVE" : "SIMULATED";
  lines.push(`# Network Overview - ${snapshot.updatedAt}`);
  lines.push("");
  lines.push(`Source: ${modeLabel} - ${snapshot.source}`);
  lines.push("");
  const score = snapshot.health.score != null ? ` Health score ${snapshot.health.score}/100.` : "";
  lines.push(
    `Overall the network is **${snapshot.overall}**.${score} ${snapshot.health.healthyDevices}/${snapshot.health.totalDevices} devices healthy, ${snapshot.issues.active} active issue${snapshot.issues.active === 1 ? "" : "s"}.`,
  );
  lines.push("");
  lines.push("## Devices");
  for (const device of snapshot.devices) {
    const bits = [
      device.role || null,
      device.ip || null,
      device.reachability || null,
      device.healthScore != null ? `health ${device.healthScore}/10` : null,
      device.cpu ? `CPU ${device.cpu}` : null,
      device.memory ? `mem ${device.memory}` : null,
      device.uptime ? `up ${device.uptime}` : null,
    ].filter(Boolean);
    lines.push(`- **${device.name}** (${device.status}): ${bits.join(", ")}${device.note ? ` - ${device.note}` : ""}`);
  }
  if (snapshot.links.length > 0) {
    lines.push("");
    lines.push("## Links");
    const down = snapshot.links.filter((link) => link.status !== "up");
    lines.push(`- ${snapshot.links.length} inter-device links discovered, ${down.length === 0 ? "all up" : `${down.length} not up`}.`);
    for (const link of down) {
      lines.push(`- DOWN: ${link.source} ${link.sourcePort} to ${link.target} ${link.targetPort}`);
    }
  }
  if ((snapshot.issues.items || []).length > 0) {
    lines.push("");
    lines.push("## Active issues");
    for (const issue of snapshot.issues.items) {
      lines.push(`- ${issue.name || issue.issueId} (priority ${issue.priority || "n/a"}, ${issue.status || "active"})`);
    }
  }
  if (snapshot.events.length > 0) {
    lines.push("");
    lines.push("## Recent events");
    for (const event of snapshot.events.slice(0, 6)) {
      lines.push(`- ${event.time} ${event.severity ? `[${event.severity}] ` : ""}${event.text || event.event || ""}`);
    }
  }
  if (snapshot.mode === "live") {
    lines.push("");
    lines.push("## Dig deeper");
    lines.push("- Ask for VLANs, MAC tables, spanning tree, CDP neighbors, routes, ARP, counters, logs - NetJarvis runs the show commands on the switches for you.");
  }
  return lines.join("\n");
}

function trimOutputs(outputs) {
  const trimmed = {};
  for (const [host, commands] of Object.entries(outputs || {})) {
    trimmed[host] = {};
    for (const [command, output] of Object.entries(commands)) {
      const text = String(output || "");
      trimmed[host][command] = text.length > 1500 ? `${text.slice(0, 1500)}\n... (truncated)` : text;
    }
  }
  return trimmed;
}

function formatCliOutputs(outputs) {
  const blocks = [];
  for (const [host, commands] of Object.entries(outputs || {})) {
    for (const [command, output] of Object.entries(commands)) {
      blocks.push(`${host}# ${command}\n${String(output || "").trim()}`);
    }
  }
  return blocks.join("\n\n" + "=".repeat(64) + "\n\n") || "No output returned.";
}

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

function buildMenuMarkdown(mode, sourceLabel) {
  return `# NetJarvis Menu

Your voice copilot for network operations, layer 1 through layer 7.

Current source: **${mode === "live" ? "LIVE" : "SIMULATED"}** - ${sourceLabel}

## Start of shift

- "How is my network doing?"
- "Give me the rundown." / "Anything happen overnight?"

## Inventory and health

- "What devices do we have?"
- "How is sw1 doing?" / "Device health for all switches."
- "Any interfaces down?" / "Interface report for sw2."

## Layer 2

- "What VLANs are configured?"
- "Show me the MAC address table on sw1."
- "What's the spanning tree state?"
- "Who are sw3's CDP neighbors?"

## Layer 3

- "Show me the routing table on sw1."
- "Any OSPF neighbors?" / "Is BGP running anywhere?"
- "Show the ARP table."

## Traffic, errors, logs

- "Any drops or errors on the interfaces?"
- "Show interface counters on sw2."
- "Show me the last 20 log lines on sw1."

## Security

- "Any vulnerabilities on these switches?"
- "Any recent CVEs for this IOS-XE version?"

## Team delegation (Kanban + left agent roster)

- "Hand this to the data team: full spanning tree health check."
- "Ask the incident agent to triage the current alerts."
- "Ask change management to run a pre-check."
- "What is the team working on?" (or open the Team Board tab)

## Incident and problem management

- "Open an incident ticket for sw2 reachability flap."
- "Show me open incident tickets."
- "What trends do you see across our pre-check snapshots?"

## Email and multi-source

- "Email this report to noc@company.com."
- "What data sources are you watching?" (Catalyst Center + Prometheus + SNMP)

## Pre-checks and comparisons

- "Run a pre-check on all four switches." / "Take a snapshot labeled pre-maintenance."
- "Run a post-check and compare." / "Did anything change since the pre-check?"

## Exports

- "Put this in Excel / CSV so I can download it." (Reports panel gets a Download CSV button)
- Every report has Copy and Copy-as-email buttons.

## Big picture

- "Show me the status board." (the dashboard on the right always shows this)
- "Show me the network topology."

## Extras

- "Search the web for IOS-XE 17.12 advisories."
- "Add a shift note: checked overnight events, all clear."`;
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

module.exports = { createTools, toolSpecs, JARVIS_INSTRUCTIONS };
