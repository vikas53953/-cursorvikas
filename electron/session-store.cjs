// Durable per-conversation audit store for enterprise traceability.

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const sessionsDir = path.join(process.cwd(), "data", "sessions");
const indexPath = path.join(sessionsDir, "index.json");

let writeQueue = Promise.resolve();
let indexCache = null;

async function ensureDir() {
  await fs.mkdir(sessionsDir, { recursive: true });
}

async function readIndex() {
  if (indexCache) return indexCache;
  await ensureDir();
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    indexCache = JSON.parse(raw);
  } catch {
    indexCache = { sessions: [] };
  }
  return indexCache;
}

async function writeIndex(index) {
  indexCache = index;
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
}

function enqueue(task) {
  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}

function getOrCreateSession(channel = "chat") {
  const id = `sess-${channel}-${new Date().toISOString().slice(0, 10)}`;
  return id;
}

async function beginTurn({ sessionId, channel, userMessage, route, plan }) {
  const auditId = crypto.randomUUID();
  const entry = {
    id: auditId,
    sessionId,
    channel,
    phase: "started",
    at: new Date().toISOString(),
    userMessage,
    intent: route?.intent || null,
    confidence: route?.confidence || null,
    skill: plan?.skill || null,
    mode: plan?.mode || null,
    tools: [],
    reply: null,
    ms: null,
    ok: null,
  };

  await enqueue(async () => {
    await ensureDir();
    await fs.appendFile(path.join(sessionsDir, `${sessionId}.jsonl`), `${JSON.stringify(entry)}\n`);
    const index = await readIndex();
    let session = index.sessions.find((s) => s.id === sessionId);
    if (!session) {
      session = { id: sessionId, channel, createdAt: entry.at, turnCount: 0 };
      index.sessions.unshift(session);
    }
    session.lastAt = entry.at;
    session.turnCount += 1;
    index.sessions = index.sessions.slice(0, 200);
    await writeIndex(index);
  });

  return auditId;
}

async function completeTurn(auditId, sessionId, result, startedAt) {
  const entry = {
    id: auditId,
    sessionId,
    phase: "completed",
    at: new Date().toISOString(),
    intent: result.intent || null,
    skill: result.skill || null,
    tools: (result.activity || []).map((step) => ({
      tool: step.tool,
      narrative: step.narrative,
      status: step.status || "done",
    })),
    reply: result.text || result.error || null,
    ms: Date.now() - startedAt,
    ok: result.ok !== false,
    artifactCount: (result.artifacts || []).length,
  };

  await enqueue(async () => {
    await ensureDir();
    await fs.appendFile(path.join(sessionsDir, `${sessionId}.jsonl`), `${JSON.stringify(entry)}\n`);
  });

  return entry;
}

async function listSessions(limit = 30) {
  const index = await readIndex();
  return index.sessions.slice(0, limit);
}

async function listTurns(sessionId, limit = 100) {
  await ensureDir();
  const file = path.join(sessionsDir, `${sessionId}.jsonl`);
  try {
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.phase === "completed");
  } catch {
    return [];
  }
}

module.exports = {
  getOrCreateSession,
  beginTurn,
  completeTurn,
  listSessions,
  listTurns,
};
