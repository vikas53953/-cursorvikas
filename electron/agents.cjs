// NetJarvis specialist agent team with hierarchical org chart and unified
// activity board. Every tool execution (Jarvis direct or delegated) appears on
// the Kanban board so the engineer sees the full session, not just delegate_task.

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");
const logger = require("./logger.cjs");
const customAgents = require("./custom-agents.cjs");

const tasksPath = path.join(process.cwd(), "data", "tasks.json");
let taskWriteQueue = Promise.resolve();

const ORG = {
  jarvis: { id: "jarvis", name: "NetJarvis", role: "SME Lead" },
  groups: [
    {
      id: "data",
      name: "Data Team",
      agents: [{ id: "data", name: "Data Network Agent", scope: "switching, routing, VLANs, spanning tree, interfaces, topology, capacity and performance" }],
    },
    {
      id: "security",
      name: "Security Team",
      agents: [
        { id: "firewall", name: "Firewall Agent", scope: "firewalls and network security policy: rules, zones, NAT, drops by policy, and exposure" },
        { id: "proxy", name: "Proxy Agent", scope: "forward/reverse proxies: access errors, latency, cache behavior, and upstream health" },
        { id: "loadbalancer", name: "Load Balancer Agent", scope: "load balancers: VIPs, pools, health monitors, persistence, and traffic distribution" },
      ],
    },
    {
      id: "incident_mgmt",
      name: "Incident Management",
      agents: [
        { id: "change", name: "Change Management Agent", scope: "change management: pre/post checks, maintenance snapshots, and post-change validation" },
        { id: "incident", name: "Incident Management Agent", scope: "incident operations: triage of active alerts and events, impact assessment, and immediate mitigation steps" },
        { id: "problem", name: "Problem Management Agent", scope: "problem management: root-cause analysis across recurring events, trends, and preventive recommendations" },
      ],
    },
  ],
};

const TEAMS = {};
for (const group of ORG.groups) {
  for (const agent of group.agents) {
    TEAMS[agent.id] = {
      name: agent.name,
      scope: agent.scope,
      group: group.id,
      groupName: group.name,
    };
  }
}

const TOOL_ROUTING = {
  network_overview: { team: "data", title: "Network overview" },
  network_inventory: { team: "data", title: "Network inventory" },
  network_status_board: { team: "data", title: "Status board" },
  device_health: { team: "data", title: "Device health" },
  interface_report: { team: "data", title: "Interface report" },
  run_show_command: { team: "data", title: "CLI show command" },
  topology_show: { team: "data", title: "Topology diagram" },
  bgp_status: { team: "data", title: "BGP status" },
  ospf_status: { team: "data", title: "OSPF status" },
  traffic_report: { team: "data", title: "Traffic report" },
  drop_report: { team: "data", title: "Drop/error report" },
  export_csv: { team: "data", title: "CSV export" },
  vulnerability_check: { team: "firewall", title: "Vulnerability check" },
  active_alerts: { team: "incident", title: "Active alerts" },
  overnight_events: { team: "incident", title: "Overnight events" },
  acknowledge_alert: { team: "incident", title: "Acknowledge alert" },
  incident_ticket_open: { team: "incident", title: "Open incident ticket" },
  incident_ticket_list: { team: "incident", title: "Incident tickets" },
  precheck_capture: { team: "change", title: "Pre-check capture" },
  precheck_compare: { team: "change", title: "Pre/post comparison" },
  problem_trends: { team: "problem", title: "Problem trend history" },
  send_email: { team: "jarvis", title: "Send email" },
  multi_source_status: { team: "jarvis", title: "Multi-source status" },
  shift_briefing: { team: "jarvis", title: "Shift briefing" },
  team_board: { team: "jarvis", title: "Team board" },
  artifact_show: { team: "jarvis", title: "Show artifact" },
  show_menu: { team: "jarvis", title: "Capability menu" },
  web_search: { team: "jarvis", title: "Web search" },
  note_add: { team: "jarvis", title: "Shift note" },
};

const SPECIALIST_TOOL_NAMES = [
  "network_overview",
  "network_inventory",
  "device_health",
  "interface_report",
  "run_show_command",
  "topology_show",
  "active_alerts",
  "overnight_events",
  "bgp_status",
  "ospf_status",
  "traffic_report",
  "drop_report",
  "vulnerability_check",
  "precheck_capture",
  "precheck_compare",
  "problem_trends",
  "incident_ticket_open",
  "incident_ticket_list",
];

// Resolve a team/agent spec by key, checking the static org first, then any
// user-created custom agents.
function resolveTeam(teamKey) {
  const key = String(teamKey || "").toLowerCase();
  if (TEAMS[key]) return TEAMS[key];
  const custom = customAgents.get(key);
  if (custom) {
    return {
      name: custom.name,
      scope: custom.scope,
      group: "custom",
      groupName: "Custom Agents",
      custom: true,
    };
  }
  return null;
}

function specialistPrompt(team) {
  const spec = resolveTeam(team) || TEAMS.data;
  return `You are the ${spec.name} on a NOC team. You report to NetJarvis, the SME lead, who delegated this task to you.
Your scope: ${spec.scope}.

You work on the live network your tools expose (currently a Catalyst Center managed network; in the DevNet sandbox that is four Catalyst 9000v access switches, sw1-sw4).

Rules:
- Investigate with your read-only tools. Use several tool calls if needed; do not guess numbers a tool can give you.
- Be honest about scope: if the network contains no devices in your domain (for example, no firewalls or load balancers), state that plainly first, then analyze the nearest relevant evidence you CAN see.
- Only read-only "show" commands are permitted on devices.
- For pre-check or multi-command CLI work: batch ALL show commands into ONE run_show_command call (device + commands array). Never spread show commands across multiple tool rounds.
- Device-specific pre-check (e.g. "precheck on sw1", label "precheck-sw1"): use run_show_command with the standard show bundle. Do NOT call precheck_capture for single-device CLI pre-checks — that tool is for whole-network baseline snapshots only.
- Present a clean, professional report the way a network engineer would in Slack: lead with a one-line **Summary**, then **Details** (bullets/tables with real numbers).
- FORBIDDEN: "Next steps", "Notes and next steps", "Recommended actions", or suggesting follow-up commands unless explicitly asked.
- Only add **⚠ Flag:** when something is genuinely wrong. Otherwise end after Details. Keep it under 300 words.`;
}

function routeTitle(toolName, args) {
  const route = TOOL_ROUTING[toolName];
  if (!route) return toolName.replace(/_/g, " ");
  if (toolName === "run_show_command" && args?.commands?.length) {
    return `CLI: ${args.commands.slice(0, 2).join(" / ")}`;
  }
  if (toolName === "precheck_capture" && args?.label) return `Pre-check: ${args.label}`;
  if (toolName === "delegate_task" && args?.task) return String(args.task).slice(0, 140);
  if (toolName === "send_email" && args?.subject) return `Email: ${args.subject}`;
  return route.title;
}

async function readTasks() {
  try {
    const raw = JSON.parse(await fs.readFile(tasksPath, "utf8"));
    return Array.isArray(raw.tasks) ? raw.tasks : [];
  } catch {
    return [];
  }
}

async function mutateTasks(mutator) {
  const operation = taskWriteQueue.then(async () => {
    const tasks = await readTasks();
    const result = await mutator(tasks);
    await fs.mkdir(path.dirname(tasksPath), { recursive: true });
    await fs.writeFile(tasksPath, JSON.stringify({ tasks: tasks.slice(-500) }, null, 2));
    return result;
  });
  taskWriteQueue = operation.catch(() => {});
  return operation;
}

async function listTasks(options = {}) {
  const tasks = await readTasks();
  const sorted = tasks.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  let filtered = sorted;
  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : String(options.status).split(",");
    filtered = filtered.filter((task) => statuses.includes(task.status));
  }
  const total = filtered.length;
  const limit = Math.min(Math.max(1, Number(options.limit) || 500), 500);
  const offset = Math.max(0, Number(options.offset) || 0);
  return {
    tasks: filtered.slice(offset, offset + limit),
    total,
    limit,
    offset,
    storeCap: 500,
    storeCount: sorted.length,
  };
}

function getOrg() {
  const custom = customAgents.list();
  if (custom.length === 0) return ORG;
  return {
    ...ORG,
    groups: [
      ...ORG.groups,
      {
        id: "custom",
        name: "Custom Agents",
        agents: custom.map((agent) => ({ id: agent.id, name: agent.name, scope: agent.scope, custom: true })),
      },
    ],
  };
}

function getActiveMap(tasks) {
  const active = {};
  for (const task of tasks) {
    if (task.status === "in_progress" || task.status === "queued") {
      const key = task.team || "jarvis";
      active[key] = (active[key] || 0) + 1;
    }
  }
  return active;
}

function compactToolResult(result) {
  const { artifact, ...rest } = result || {};
  const compact = { ...rest };
  if (artifact) {
    compact.artifact = {
      title: artifact.title,
      kind: artifact.kind,
      content: String(artifact.content || "").slice(0, 4000),
    };
  }
  const text = JSON.stringify(compact);
  return text.length > 9000 ? `${text.slice(0, 9000)}...` : text;
}

async function chatCompletion(messages, tools) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing in .env.local");
  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-5-mini", messages, tools, tool_choice: "auto" }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) {
    const text = await response.text();
    logger.log("agent.llm.error", { status: response.status, body: text.slice(0, 300), ms: Date.now() - started });
    throw new Error(`Specialist model call failed: ${response.status} ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  logger.log("agent.llm.ok", { ms: Date.now() - started, usage: data.usage });
  return data.choices?.[0]?.message || {};
}

function createAgents({ executeTool, toolSpecs }) {
  const specialistTools = toolSpecs
    .filter((spec) => SPECIALIST_TOOL_NAMES.includes(spec.name))
    .map((spec) => ({ type: "function", function: { name: spec.name, description: spec.description, parameters: spec.parameters } }));

  async function appendStep(taskId, text) {
    await mutateTasks((tasks) => {
      const task = tasks.find((item) => item.id === taskId);
      if (task) {
        task.steps.push({ ts: new Date().toISOString(), text: String(text).slice(0, 200) });
        task.updatedAt = new Date().toISOString();
      }
    });
  }

  async function setStatus(taskId, status, patch = {}) {
    await mutateTasks((tasks) => {
      const task = tasks.find((item) => item.id === taskId);
      if (task) {
        task.status = status;
        task.updatedAt = new Date().toISOString();
        Object.assign(task, patch);
      }
    });
  }

  async function createTaskRecord({ team, title, request, source, executor, tool }) {
    const teamKey = team && resolveTeam(team) ? String(team).toLowerCase() : "jarvis";
    const spec = resolveTeam(teamKey) || { name: "NetJarvis", group: "jarvis", groupName: "Jarvis" };
    const task = {
      id: `TASK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      team: teamKey,
      teamName: spec.name,
      group: spec.group || "jarvis",
      groupName: spec.groupName || "Jarvis",
      executor: executor || (source === "delegated" ? teamKey : "jarvis"),
      source: source || "jarvis_direct",
      tool: tool || null,
      title: String(title).slice(0, 140),
      request: String(request || title),
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
      result: null,
      error: null,
      artifactId: null,
    };
    await mutateTasks((tasks) => {
      tasks.push(task);
    });
    return task;
  }

  async function recordJarvisActivity(toolName, args, result) {
    if (toolName === "delegate_task" || toolName === "team_board") return null;
    const route = TOOL_ROUTING[toolName] || { team: "jarvis", title: toolName };
    const teamKey = route.team === "jarvis" ? "jarvis" : route.team;
    const title = routeTitle(toolName, args);
    const task = await createTaskRecord({
      team: teamKey,
      title,
      request: title,
      source: "jarvis_direct",
      executor: "jarvis",
      tool: toolName,
    });
    await setStatus(task.id, "in_progress", { startedAt: new Date().toISOString() });
    await appendStep(task.id, `NetJarvis ran ${toolName}`);

    const ok = result?.ok !== false;
    const summary =
      result?.artifact?.title ||
      result?.message ||
      (ok ? `${title} completed` : result?.error || "Tool failed");
    await setStatus(task.id, ok ? "done" : "failed", {
      finishedAt: new Date().toISOString(),
      result: summary,
      error: ok ? null : result?.error || "failed",
      artifactId: result?.artifactId || null,
      artifactTitle: result?.artifact?.title || null,
    });
    if (result?.artifact?.title) {
      await appendStep(task.id, `artifact: ${result.artifact.title}`);
    }
    logger.log("activity.jarvis", { taskId: task.id, tool: toolName, team: teamKey, ok });
    return task;
  }

  async function runSpecialist(taskId, team, taskText) {
    const messages = [
      { role: "system", content: specialistPrompt(team) },
      { role: "user", content: taskText },
    ];
    const cliArtifacts = [];

    for (let round = 0; round < 10; round += 1) {
      const message = await chatCompletion(messages, specialistTools);
      messages.push(message);

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (toolCalls.length === 0) {
        return {
          text: message.content || "The specialist returned no content.",
          cliArtifacts,
        };
      }

      for (const call of toolCalls) {
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          args = {};
        }
        const name = call.function?.name || "";
        await appendStep(taskId, `ran ${name} ${JSON.stringify(args)}`);
        logger.log("agent.tool", { taskId, team, tool: name, args });
        const result = await executeTool(name, args, { skipActivity: true });
        if (result?.artifact?.kind === "code" || result?.artifact?.kind === "table") {
          cliArtifacts.push(result.artifact);
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: compactToolResult(result) });
      }
    }
    return {
      text: "Reached the tool-call limit before completing the investigation. Partial evidence was collected; re-delegate with a narrower task.",
      cliArtifacts,
    };
  }

  async function delegate(team, taskText) {
    const teamKey = String(team || "").toLowerCase();
    const spec = resolveTeam(teamKey);
    if (!spec) {
      const validTeams = [...Object.keys(TEAMS), ...customAgents.list().map((agent) => agent.id)];
      throw new Error(`Unknown team "${team}". Valid teams: ${validTeams.join(", ")}`);
    }
    const task = await createTaskRecord({
      team: teamKey,
      title: String(taskText).slice(0, 140),
      request: String(taskText),
      source: "delegated",
      executor: teamKey,
      tool: "delegate_task",
    });
    logger.log("agent.delegate", { taskId: task.id, team: teamKey, task: task.title });

    await setStatus(task.id, "in_progress", { startedAt: new Date().toISOString() });
    await appendStep(task.id, `handed off by NetJarvis to ${spec.name}`);

    try {
      const outcome = await runSpecialist(task.id, teamKey, String(taskText));
      const resultText = typeof outcome === "string" ? outcome : outcome.text;
      const cliArtifacts = typeof outcome === "string" ? [] : outcome.cliArtifacts || [];
      await setStatus(task.id, "done", { finishedAt: new Date().toISOString(), result: resultText });
      logger.log("agent.done", { taskId: task.id, team: teamKey, cliArtifacts: cliArtifacts.length });
      return { taskId: task.id, team: teamKey, teamName: spec.name, result: resultText, cliArtifacts };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setStatus(task.id, "failed", { finishedAt: new Date().toISOString(), error: message });
      logger.log("agent.failed", { taskId: task.id, team: teamKey, error: message });
      throw error;
    }
  }

  return {
    ORG,
    TEAMS,
    TOOL_ROUTING,
    delegate,
    listTasks,
    recordJarvisActivity,
    getOrg,
    getActiveMap,
    createTaskRecord,
    appendStep,
    setStatus,
    resolveTeam,
    listCustomAgents: customAgents.list,
    createCustomAgent: customAgents.create,
    removeCustomAgent: customAgents.remove,
  };
}

module.exports = { createAgents, TEAMS, ORG, TOOL_ROUTING, chatCompletion, compactToolResult };
