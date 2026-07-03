// NetJarvis specialist agent team.
//
// NetJarvis (the realtime voice SME) delegates domain work to specialist
// agents via the delegate_task tool. Each specialist is an LLM run (Chat
// Completions, gpt-5-mini) with its own persona and access to the read-only
// network tools. Every task moves through a Kanban board persisted in
// data/tasks.json: queued -> in_progress -> done/failed, with each tool step
// recorded so the board shows exactly what each agent did.

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");
const logger = require("./logger.cjs");

const tasksPath = path.join(process.cwd(), "data", "tasks.json");
let taskWriteQueue = Promise.resolve();

const TEAMS = {
  data: {
    name: "Data Network Agent",
    scope: "the data network: switching, routing, VLANs, spanning tree, interfaces, topology, capacity and performance",
  },
  firewall: {
    name: "Firewall Agent",
    scope: "firewalls and network security policy: rules, zones, NAT, drops by policy, and exposure",
  },
  loadbalancer: {
    name: "Load Balancer Agent",
    scope: "load balancers: VIPs, pools, health monitors, persistence, and traffic distribution",
  },
  proxy: {
    name: "Proxy Agent",
    scope: "forward/reverse proxies: access errors, latency, cache behavior, and upstream health",
  },
  incident: {
    name: "Incident Operations Agent",
    scope: "incident operations: triage of active alerts and events, impact assessment, and immediate mitigation steps",
  },
  problem: {
    name: "Problem Management Agent",
    scope: "problem management: root-cause analysis across recurring events, trends, and preventive recommendations",
  },
};

// Tools a specialist may use (never delegate_task itself, to avoid recursion).
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
];

function specialistPrompt(team) {
  const spec = TEAMS[team];
  return `You are the ${spec.name} on a NOC team. You report to NetJarvis, the SME lead, who delegated this task to you.
Your scope: ${spec.scope}.

You work on the live network your tools expose (currently a Catalyst Center managed network; in the DevNet sandbox that is four Catalyst 9000v access switches, sw1-sw4).

Rules:
- Investigate with your read-only tools. Use several tool calls if needed; do not guess numbers a tool can give you.
- Be honest about scope: if the network contains no devices in your domain (for example, no firewalls or load balancers), state that plainly first, then analyze the nearest relevant evidence you CAN see.
- Only read-only "show" commands are permitted on devices.
- Finish with a crisp NOC report in markdown: "Findings" (bulleted facts with numbers), "Assessment" (what it means), "Recommended actions" (numbered). Keep it under 300 words.`;
}

// ---------------------------------------------------------------------------
// Task store (Kanban board persistence)
// ---------------------------------------------------------------------------

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
    await fs.writeFile(tasksPath, JSON.stringify({ tasks: tasks.slice(-100) }, null, 2));
    return result;
  });
  taskWriteQueue = operation.catch(() => {});
  return operation;
}

async function listTasks() {
  const tasks = await readTasks();
  return tasks.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// ---------------------------------------------------------------------------
// Specialist runner (Chat Completions tool loop)
// ---------------------------------------------------------------------------

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

  async function runSpecialist(taskId, team, taskText) {
    const messages = [
      { role: "system", content: specialistPrompt(team) },
      { role: "user", content: taskText },
    ];

    for (let round = 0; round < 6; round += 1) {
      const message = await chatCompletion(messages, specialistTools);
      messages.push(message);

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (toolCalls.length === 0) {
        return message.content || "The specialist returned no content.";
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
        const result = await executeTool(name, args);
        messages.push({ role: "tool", tool_call_id: call.id, content: compactToolResult(result) });
      }
    }
    return "Reached the tool-call limit before completing the investigation. Partial evidence was collected; re-delegate with a narrower task.";
  }

  // Creates a task on the board, runs the specialist, and returns its report.
  async function delegate(team, taskText) {
    const teamKey = String(team || "").toLowerCase();
    if (!TEAMS[teamKey]) {
      throw new Error(`Unknown team "${team}". Valid teams: ${Object.keys(TEAMS).join(", ")}`);
    }
    const task = {
      id: `TASK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      team: teamKey,
      teamName: TEAMS[teamKey].name,
      title: String(taskText).slice(0, 140),
      request: String(taskText),
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
      result: null,
      error: null,
    };
    await mutateTasks((tasks) => {
      tasks.push(task);
    });
    logger.log("agent.delegate", { taskId: task.id, team: teamKey, task: task.title });

    await setStatus(task.id, "in_progress", { startedAt: new Date().toISOString() });
    await appendStep(task.id, `handed off by NetJarvis to ${TEAMS[teamKey].name}`);

    try {
      const result = await runSpecialist(task.id, teamKey, String(taskText));
      await setStatus(task.id, "done", { finishedAt: new Date().toISOString(), result });
      logger.log("agent.done", { taskId: task.id, team: teamKey });
      return { taskId: task.id, team: teamKey, teamName: TEAMS[teamKey].name, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setStatus(task.id, "failed", { finishedAt: new Date().toISOString(), error: message });
      logger.log("agent.failed", { taskId: task.id, team: teamKey, error: message });
      throw error;
    }
  }

  return { TEAMS, delegate, listTasks };
}

module.exports = { createAgents, TEAMS };
