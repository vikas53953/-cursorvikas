// NetJarvis debug logger.
//
// Writes structured JSONL entries to data/logs/netjarvis-YYYY-MM-DD.jsonl and
// keeps an in-memory ring buffer for quick inspection (/api/logs/recent in web
// mode). Everything of interest flows through here: tool calls, Catalyst
// Center API traffic, realtime session events forwarded from the renderer,
// token mints, and errors. This is the evidence trail for debugging test runs.

const fs = require("node:fs");
const path = require("node:path");

const logDir = path.join(process.cwd(), "data", "logs");
const ring = [];
const RING_MAX = 1000;
let stream = null;
let currentDay = "";

function ensureStream() {
  const day = new Date().toISOString().slice(0, 10);
  if (stream && day === currentDay) return stream;
  fs.mkdirSync(logDir, { recursive: true });
  if (stream) stream.end();
  currentDay = day;
  stream = fs.createWriteStream(path.join(logDir, `netjarvis-${day}.jsonl`), { flags: "a" });
  return stream;
}

function truncate(value, depth = 0) {
  if (typeof value === "string") {
    return value.length > 2000 ? `${value.slice(0, 2000)}...[${value.length} chars]` : value;
  }
  if (Array.isArray(value)) {
    const capped = value.slice(0, 50).map((item) => truncate(item, depth + 1));
    if (value.length > 50) capped.push(`...[${value.length} items]`);
    return capped;
  }
  if (value && typeof value === "object" && depth < 6) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      // Never write secrets into the log file.
      if (/token|password|secret|api[_-]?key|authorization/i.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = truncate(entry, depth + 1);
      }
    }
    return out;
  }
  return value;
}

function log(type, data = {}) {
  const entry = { ts: new Date().toISOString(), type, ...truncate(data) };
  try {
    ensureStream().write(`${JSON.stringify(entry)}\n`);
  } catch {
    // Logging must never break the app.
  }
  ring.push(entry);
  if (ring.length > RING_MAX) ring.shift();
  if (process.env.NETJARVIS_LOG_STDOUT === "1") {
    const preview = JSON.stringify(entry);
    console.log(preview.length > 400 ? `${preview.slice(0, 400)}...` : preview);
  }
}

function recent(limit = 200) {
  return ring.slice(-Math.max(1, Math.min(RING_MAX, limit)));
}

module.exports = { log, recent, logDir };
