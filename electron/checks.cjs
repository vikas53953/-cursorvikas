// Pre-check / post-check snapshots and comparison.
//
// precheck_capture records a labeled snapshot of network state (device
// health, every interface, and interface error counters). precheck_compare
// diffs two snapshots and reports exactly what changed - the classic
// before/after maintenance workflow.

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const source = require("./network-source.cjs");
const logger = require("./logger.cjs");

const checksDir = path.join(process.cwd(), "data", "checks");

async function listSnapshots() {
  try {
    const files = await fs.readdir(checksDir);
    const snapshots = [];
    for (const file of files.filter((name) => name.endsWith(".json"))) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(checksDir, file), "utf8"));
        snapshots.push({ id: data.id, label: data.label, at: data.at, mode: data.mode, devices: data.devices.length, interfaces: data.interfaces.length });
      } catch {
        // Skip unreadable snapshot files.
      }
    }
    return snapshots.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  } catch {
    return [];
  }
}

async function loadSnapshot(idOrLabel) {
  const meta = await listSnapshots();
  const match =
    meta.find((snap) => snap.id === idOrLabel) ||
    [...meta].reverse().find((snap) => snap.label.toLowerCase() === String(idOrLabel).toLowerCase());
  if (!match) return null;
  return JSON.parse(await fs.readFile(path.join(checksDir, `${match.id}.json`), "utf8"));
}

// Parses "show interfaces counters errors" style tables into
// { port: { column: number } } per host.
function parseErrorCounters(outputs) {
  const parsed = {};
  for (const [host, commands] of Object.entries(outputs || {})) {
    const text = Object.values(commands)[0] || "";
    const counters = {};
    let columns = [];
    for (const line of String(text).split("\n")) {
      const tokens = line.trim().split(/\s+/);
      if (tokens[0] === "Port") {
        columns = tokens.slice(1);
        continue;
      }
      if (/^[A-Z][a-zA-Z]+[\d/.]+$/.test(tokens[0] || "") && tokens.length > 1 && tokens.slice(1).every((t) => /^\d+$/.test(t))) {
        counters[tokens[0]] = {};
        tokens.slice(1).forEach((value, index) => {
          counters[tokens[0]][columns[index] || `col${index}`] = Number(value);
        });
      }
    }
    parsed[host] = counters;
  }
  return parsed;
}

async function captureSnapshot(label) {
  const { mode } = await source.getMode();
  const snapshot = {
    id: `CHK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    label: String(label || `precheck-${new Date().toISOString().slice(11, 16).replace(":", "")}`),
    at: new Date().toISOString(),
    mode,
    devices: [],
    interfaces: [],
    errorCounters: {},
  };

  const board = await source.getSnapshot(true);
  snapshot.devices = board.devices.map((device) => ({
    name: device.name,
    status: device.status,
    reachability: device.reachability,
    healthScore: device.healthScore,
    cpu: device.cpu,
    memory: device.memory,
    uptime: device.uptime,
    software: device.software,
  }));

  if (mode === "live") {
    snapshot.interfaces = await source.getLiveInterfaces("all");
    try {
      const cli = await source.runLiveShowCommands("all", ["show interfaces counters errors"]);
      snapshot.errorCounters = parseErrorCounters(cli.outputs);
    } catch (error) {
      snapshot.errorCountersError = String(error && error.message);
    }
  } else {
    snapshot.interfaces = source.sim.getInterfaceReport(undefined, false).interfaces.map((row) => ({
      device: row.device,
      interface: row.interface,
      status: row.status,
      adminStatus: "UP",
      vlan: "",
      ipv4: "",
    }));
  }

  await fs.mkdir(checksDir, { recursive: true });
  await fs.writeFile(path.join(checksDir, `${snapshot.id}.json`), JSON.stringify(snapshot, null, 2));
  logger.log("precheck.capture", { id: snapshot.id, label: snapshot.label, devices: snapshot.devices.length, interfaces: snapshot.interfaces.length });
  return snapshot;
}

function indexBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows || []) map.set(keyFn(row), row);
  return map;
}

async function compareSnapshots(beforeRef, afterRef) {
  const all = await listSnapshots();
  if (all.length < 2 && !(beforeRef && afterRef)) {
    if (all.length === 0) throw new Error("No snapshots exist yet. Run precheck_capture first.");
    if (all.length === 1) throw new Error(`Only one snapshot exists (${all[0].label}). Capture a second one, then compare.`);
  }

  const before = beforeRef ? await loadSnapshot(beforeRef) : await loadSnapshot(all[all.length - 2].id);
  const after = afterRef ? await loadSnapshot(afterRef) : await loadSnapshot(all[all.length - 1].id);
  if (!before || !after) throw new Error("Could not load the requested snapshots. Use precheck_capture output ids/labels.");

  const changes = { devices: [], interfaces: [], errorCounters: [] };

  const beforeDevices = indexBy(before.devices, (d) => d.name);
  for (const device of after.devices) {
    const prev = beforeDevices.get(device.name);
    if (!prev) {
      changes.devices.push(`${device.name}: NEW device (not present in "${before.label}")`);
      continue;
    }
    if (prev.reachability !== device.reachability) changes.devices.push(`${device.name}: reachability ${prev.reachability} -> ${device.reachability}`);
    if (prev.status !== device.status) changes.devices.push(`${device.name}: status ${prev.status} -> ${device.status}`);
    if (prev.healthScore !== device.healthScore) changes.devices.push(`${device.name}: health ${prev.healthScore} -> ${device.healthScore}`);
  }
  for (const device of before.devices) {
    if (!indexBy(after.devices, (d) => d.name).has(device.name)) changes.devices.push(`${device.name}: MISSING in "${after.label}"`);
  }

  const beforeIfaces = indexBy(before.interfaces, (i) => `${i.device}|${i.interface}`);
  const afterIfaces = indexBy(after.interfaces, (i) => `${i.device}|${i.interface}`);
  for (const [key, iface] of afterIfaces) {
    const prev = beforeIfaces.get(key);
    if (!prev) {
      changes.interfaces.push(`${iface.device} ${iface.interface}: NEW interface`);
      continue;
    }
    if (prev.status !== iface.status) changes.interfaces.push(`${iface.device} ${iface.interface}: status ${prev.status} -> ${iface.status}`);
    if (String(prev.adminStatus) !== String(iface.adminStatus)) changes.interfaces.push(`${iface.device} ${iface.interface}: admin ${prev.adminStatus} -> ${iface.adminStatus}`);
    if (String(prev.vlan || "") !== String(iface.vlan || "")) changes.interfaces.push(`${iface.device} ${iface.interface}: vlan ${prev.vlan} -> ${iface.vlan}`);
    if (String(prev.ipv4 || "") !== String(iface.ipv4 || "")) changes.interfaces.push(`${iface.device} ${iface.interface}: ip ${prev.ipv4 || "none"} -> ${iface.ipv4 || "none"}`);
  }
  for (const [key, iface] of beforeIfaces) {
    if (!afterIfaces.has(key)) changes.interfaces.push(`${iface.device} ${iface.interface}: MISSING after`);
  }

  for (const [host, ports] of Object.entries(after.errorCounters || {})) {
    const prevPorts = (before.errorCounters || {})[host] || {};
    for (const [port, counters] of Object.entries(ports)) {
      for (const [column, value] of Object.entries(counters)) {
        const prev = prevPorts[port]?.[column] ?? 0;
        if (value > prev) changes.errorCounters.push(`${host} ${port}: ${column} +${value - prev} (now ${value})`);
      }
    }
  }

  const total = changes.devices.length + changes.interfaces.length + changes.errorCounters.length;
  logger.log("precheck.compare", { before: before.label, after: after.label, changes: total });
  return { before: { id: before.id, label: before.label, at: before.at }, after: { id: after.id, label: after.label, at: after.at }, totalChanges: total, changes };
}

module.exports = { captureSnapshot, compareSnapshots, listSnapshots, loadSnapshot };
