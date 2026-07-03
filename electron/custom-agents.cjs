// User-defined custom agents. Persisted to data/custom-agents.json so engineers
// can spin up their own specialist agents (name, description, capabilities) from
// the chat workspace. NetJarvis delegates to them with the full read-only tool
// set, scoped by the description/capabilities the engineer provided.

const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const logger = require("./logger.cjs");

const storePath = path.join(process.cwd(), "data", "custom-agents.json");

const RESERVED = new Set([
  "jarvis",
  "data",
  "firewall",
  "proxy",
  "loadbalancer",
  "change",
  "incident",
  "problem",
  "security",
  "fw",
  "lb",
  "all",
  "none",
]);

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
    cache = Array.isArray(raw.agents) ? raw.agents : [];
  } catch {
    cache = [];
  }
  return cache;
}

function list() {
  return load().map((agent) => ({ ...agent }));
}

function get(id) {
  return load().find((agent) => agent.id === String(id || "").toLowerCase()) || null;
}

function slugify(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24) || `agent${Date.now().toString(36)}`
  );
}

async function persist() {
  await fsp.mkdir(path.dirname(storePath), { recursive: true });
  await fsp.writeFile(storePath, JSON.stringify({ agents: cache }, null, 2));
}

async function create({ name, description, capabilities } = {}) {
  const agents = load();
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Agent name is required");

  const base = slugify(cleanName);
  let handle = base;
  let counter = 1;
  while (RESERVED.has(handle) || agents.some((agent) => agent.id === handle)) {
    handle = `${base}${counter}`;
    counter += 1;
  }

  const cleanDescription = String(description || "").trim();
  const cleanCapabilities = String(capabilities || "").trim();
  const scopeParts = [];
  if (cleanDescription) scopeParts.push(cleanDescription);
  if (cleanCapabilities) scopeParts.push(`Capabilities: ${cleanCapabilities}`);

  const agent = {
    id: handle,
    name: cleanName,
    handle,
    description: cleanDescription,
    capabilities: cleanCapabilities,
    scope: scopeParts.join(". ") || cleanName,
    custom: true,
    createdAt: new Date().toISOString(),
  };

  agents.push(agent);
  await persist();
  logger.log("custom-agent.create", { id: agent.id, name: agent.name });
  return agent;
}

async function remove(id) {
  const agents = load();
  const key = String(id || "").toLowerCase();
  const index = agents.findIndex((agent) => agent.id === key);
  if (index === -1) return { ok: false, error: `No such custom agent: ${id}` };
  const [removed] = agents.splice(index, 1);
  await persist();
  logger.log("custom-agent.remove", { id: removed.id });
  return { ok: true, id: removed.id };
}

module.exports = { list, get, create, remove };
