// Persist every tool artifact so the user can download or revisit reports later.

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");

const artifactsDir = path.join(process.cwd(), "data", "artifacts");
const indexPath = path.join(artifactsDir, "index.json");
let writeQueue = Promise.resolve();

async function readIndex() {
  try {
    const raw = JSON.parse(await fs.readFile(indexPath, "utf8"));
    return Array.isArray(raw.artifacts) ? raw.artifacts : [];
  } catch {
    return [];
  }
}

async function mutateIndex(mutator) {
  const operation = writeQueue.then(async () => {
    const artifacts = await readIndex();
    const result = await mutator(artifacts);
    await fs.mkdir(artifactsDir, { recursive: true });
    await fs.writeFile(indexPath, JSON.stringify({ artifacts: artifacts.slice(0, 200) }, null, 2));
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

function extensionForKind(kind) {
  if (kind === "table") return "csv";
  if (kind === "code") return "txt";
  if (kind === "mermaid") return "md";
  if (kind === "notes" || kind === "statusBoard" || kind === "taskBoard") return "json";
  return "md";
}

function tableToCsv(content) {
  try {
    const rows = JSON.parse(content);
    const list = Array.isArray(rows) ? rows : [rows];
    if (list.length === 0) return "";
    const keys = Array.from(
      list.reduce((set, row) => {
        Object.keys(row || {}).forEach((key) => set.add(key));
        return set;
      }, new Set()),
    );
    const escape = (value) => {
      const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [keys.map(escape).join(","), ...list.map((row) => keys.map((key) => escape(row[key])).join(","))].join("\r\n");
  } catch {
    return content;
  }
}

function serializeArtifact(artifact) {
  if (!artifact) return { body: "", mime: "text/plain", filename: "artifact.txt" };
  const kind = artifact.kind || "text";
  const slug = String(artifact.title || "artifact")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "artifact";
  const ext = extensionForKind(kind);
  const filename = artifact.downloadName || `${slug}.${ext}`;
  if (kind === "table") {
    return { body: tableToCsv(artifact.content), mime: "text/csv; charset=utf-8", filename };
  }
  if (kind === "notes" || kind === "statusBoard" || kind === "taskBoard") {
    return { body: artifact.content, mime: "application/json; charset=utf-8", filename };
  }
  return { body: artifact.content, mime: "text/plain; charset=utf-8", filename };
}

async function saveArtifact({ tool, team, artifact }) {
  if (!artifact?.title || !artifact?.content) return null;
  const id = `ART-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const entry = {
    id,
    tool: tool || "unknown",
    team: team || "jarvis",
    title: artifact.title,
    kind: artifact.kind || "text",
    createdAt: new Date().toISOString(),
    downloadName: artifact.downloadName || null,
    downloadUrl: artifact.downloadUrl || `/api/artifacts/${id}/download`,
  };
  const filePath = path.join(artifactsDir, `${id}.json`);
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ ...entry, artifact }, null, 2));
  await mutateIndex((artifacts) => {
    artifacts.unshift(entry);
  });
  return entry;
}

async function listArtifacts(limit = 40) {
  const artifacts = await readIndex();
  return artifacts.slice(0, limit);
}

async function getArtifact(id) {
  try {
    return JSON.parse(await fs.readFile(path.join(artifactsDir, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function getDownload(id) {
  const record = await getArtifact(id);
  if (!record?.artifact) return null;
  const serialized = serializeArtifact(record.artifact);
  return { ...serialized, title: record.title, id };
}

module.exports = { saveArtifact, listArtifacts, getArtifact, getDownload, serializeArtifact };
