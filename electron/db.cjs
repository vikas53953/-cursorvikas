// Local persistence for shift notes and acknowledged simulator alerts.

const path = require("node:path");
const fs = require("node:fs/promises");

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "netjarvis-db.json");
let dbWriteQueue = Promise.resolve();

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

module.exports = { readDb, updateDb, ensureData, dataDir };
