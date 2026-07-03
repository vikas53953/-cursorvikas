// Network source facade.
//
// Decides where NetJarvis's network state comes from and normalizes it for
// the tools and the operations dashboard:
//
//   - "live": the Cisco Catalyst Center Intent API (defaults to the DevNet
//     Always-On sandbox, a real four-switch Catalyst 9000v network).
//   - "sim":  the built-in deterministic simulator (electron/network-data.cjs).
//
// NETJARVIS_SOURCE in .env.local controls the mode: "live", "sim", or "auto"
// (default). Auto probes Catalyst Center once and falls back to the simulator
// if it is unreachable.

const catc = require("./sources/catalyst-center.cjs");
const sim = require("./network-data.cjs");

const configuredMode = (process.env.NETJARVIS_SOURCE || "auto").toLowerCase();

let resolvedMode = null; // "live" | "sim"
let lastProbeAt = 0;

async function resolveMode() {
  if (configuredMode === "sim") return "sim";
  if (configuredMode === "live") return "live";
  const probeTtl = 5 * 60 * 1000;
  if (resolvedMode && Date.now() - lastProbeAt < probeTtl) return resolvedMode;
  try {
    await catc.checkReachable();
    resolvedMode = "live";
  } catch {
    resolvedMode = "sim";
  }
  lastProbeAt = Date.now();
  return resolvedMode;
}

function sourceLabel(mode) {
  return mode === "live" ? `Cisco Catalyst Center (${catc.config.baseUrl.replace(/^https?:\/\//, "")})` : "Built-in simulator";
}

function hhmm(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Live helpers
// ---------------------------------------------------------------------------

function liveDeviceStatus(health) {
  if (health.reachabilityHealth && health.reachabilityHealth !== "REACHABLE") return "critical";
  const score = Number(health.overallHealth);
  if (!Number.isFinite(score)) return "ok";
  if (score <= 3) return "critical";
  if (score <= 7) return "warning";
  return "ok";
}

async function liveSnapshot() {
  const [inventory, health, networkHealth, topology, issues, events] = await Promise.all([
    catc.getInventoryCached(),
    catc.getDeviceHealth().catch(() => []),
    catc.getNetworkHealth().catch(() => ({})),
    catc.getTopology().catch(() => ({ nodes: [], links: [] })),
    catc.getIssues().catch(() => []),
    catc.getEvents(10).catch(() => []),
  ]);

  const healthByName = new Map(health.map((entry) => [entry.name, entry]));
  const devices = inventory.map((device) => {
    const deviceHealth = healthByName.get(device.hostname) || {};
    return {
      id: device.id,
      name: device.hostname,
      role: device.role || "",
      platform: device.platform || device.series || "",
      ip: device.managementIp || "",
      site: deviceHealth.location || "",
      reachability: device.reachability || "",
      status: healthByName.has(device.hostname) ? liveDeviceStatus(deviceHealth) : device.reachability === "Reachable" ? "ok" : "critical",
      healthScore: deviceHealth.overallHealth ?? null,
      cpu: deviceHealth.cpuUtilization != null ? `${Math.round(deviceHealth.cpuUtilization)}%` : "",
      memory: deviceHealth.memoryUtilization != null ? `${Math.round(deviceHealth.memoryUtilization)}%` : "",
      uptime: device.uptime || "",
      software: `${device.softwareType || ""} ${device.softwareVersion || ""}`.trim(),
      note: "",
    };
  });

  const activeIssues = issues.filter((issue) => String(issue.status || "").toLowerCase() !== "resolved");
  const overall =
    devices.some((device) => device.status === "critical") || activeIssues.some((issue) => String(issue.priority) === "P1")
      ? "degraded"
      : devices.some((device) => device.status === "warning") || activeIssues.length > 0
        ? "watch"
        : "healthy";

  return {
    mode: "live",
    source: sourceLabel("live"),
    updatedAt: hhmm(),
    overall,
    health: {
      score: networkHealth.healthScore ?? null,
      totalDevices: networkHealth.totalDevices ?? devices.length,
      healthyDevices: networkHealth.healthyDevices ?? devices.filter((device) => device.status === "ok").length,
      unhealthyDevices: networkHealth.unhealthyDevices ?? devices.filter((device) => device.status !== "ok").length,
    },
    issues: {
      active: activeIssues.length,
      items: activeIssues.slice(0, 10),
    },
    devices,
    links: topology.links,
    events: events.map((event) => ({
      time: event.timestamp ? hhmm(new Date(Number(event.timestamp))) : "",
      severity: String(event.severity || "info").toLowerCase(),
      device: event.source || "",
      text: `${event.name}: ${event.description}`.slice(0, 200),
    })),
  };
}

function simSnapshot() {
  const board = sim.getStatusBoard([]);
  const events = sim.getEvents(12);
  const overallByBoard = { healthy: "healthy", watch: "watch", degraded: "degraded" };
  return {
    mode: "sim",
    source: sourceLabel("sim"),
    updatedAt: hhmm(),
    overall: overallByBoard[board.overall] || "healthy",
    health: {
      score: board.overall === "healthy" ? 100 : board.overall === "watch" ? 86 : 55,
      totalDevices: board.summary.devices,
      healthyDevices: board.tiles.filter((tile) => tile.status === "ok").length,
      unhealthyDevices: board.tiles.filter((tile) => tile.status !== "ok").length,
    },
    issues: {
      active: board.summary.activeAlerts,
      items: sim.getAlerts(false, []).map((alert) => ({
        issueId: alert.id,
        name: alert.title,
        priority: alert.severity,
        status: alert.state,
      })),
    },
    devices: board.tiles.map((tile) => ({
      id: tile.id,
      name: tile.name,
      role: tile.role,
      platform: "",
      ip: "",
      site: tile.site,
      reachability: "Reachable",
      status: tile.status === "watch" ? "warning" : tile.status,
      healthScore: null,
      cpu: tile.cpu,
      memory: "",
      uptime: tile.uptime,
      software: "",
      note: tile.note,
    })),
    links: [],
    events,
  };
}

let snapshotCache = null; // { at, data }

async function getSnapshot(force = false) {
  if (!force && snapshotCache && Date.now() - snapshotCache.at < 20000) return snapshotCache.data;
  const mode = await resolveMode();
  let data;
  if (mode === "live") {
    try {
      data = await liveSnapshot();
    } catch (error) {
      if (snapshotCache) return { ...snapshotCache.data, staleError: String(error && error.message) };
      data = { ...simSnapshot(), liveError: String(error && error.message) };
    }
  } else {
    data = simSnapshot();
  }
  snapshotCache = { at: Date.now(), data };
  return data;
}

// ---------------------------------------------------------------------------
// Normalized operations used by tools
// ---------------------------------------------------------------------------

async function getMode() {
  const mode = await resolveMode();
  return { mode, source: sourceLabel(mode) };
}

async function getInventoryRows() {
  const mode = await resolveMode();
  if (mode === "live") {
    const rows = await catc.getInventoryCached();
    return rows.map((device) => ({
      hostname: device.hostname,
      managementIp: device.managementIp,
      role: device.role,
      family: device.family,
      platform: device.platform,
      software: `${device.softwareType || ""} ${device.softwareVersion || ""}`.trim(),
      serial: device.serialNumber,
      reachability: device.reachability,
      uptime: device.uptime,
    }));
  }
  return sim.DEVICES.map((device) => ({
    hostname: device.name,
    managementIp: device.loopback,
    role: device.role,
    family: device.role === "firewall" ? "Firewalls" : "Routers and Switches",
    platform: device.platform,
    software: device.os,
    serial: "",
    reachability: "Reachable",
    uptime: `${device.uptimeDays} days`,
  }));
}

async function findLiveDevices(deviceQuery) {
  const inventory = await catc.getInventoryCached();
  const query = String(deviceQuery || "").trim().toLowerCase();
  if (!query || query === "all" || query === "all devices") return inventory;
  const matches = inventory.filter(
    (device) => device.hostname.toLowerCase() === query || device.hostname.toLowerCase().includes(query) || device.managementIp === query,
  );
  return matches.length > 0 ? matches : inventory;
}

async function getLiveInterfaces(deviceQuery) {
  const devices = await findLiveDevices(deviceQuery);
  const results = [];
  for (const device of devices) {
    const interfaces = await catc.getInterfaces(device.id);
    for (const iface of interfaces) {
      results.push({
        device: device.hostname,
        interface: iface.portName,
        status: iface.status,
        adminStatus: iface.adminStatus,
        speed: formatSpeed(iface.speed),
        mode: iface.portMode,
        vlan: iface.vlanId,
        ipv4: iface.ipv4Address || "",
        type: iface.interfaceType,
        description: iface.description || "",
      });
    }
  }
  return results;
}

function formatSpeed(speed) {
  const kbps = Number(speed);
  if (!Number.isFinite(kbps) || kbps <= 0) return String(speed || "");
  if (kbps >= 1000000) return `${kbps / 1000000}G`;
  if (kbps >= 1000) return `${kbps / 1000}M`;
  return `${kbps}K`;
}

// Runs read-only show commands on live devices. deviceQuery may be a hostname
// or "all". Returns { scope, outputs: { host: { command: output } } }.
async function runLiveShowCommands(deviceQuery, commands) {
  for (const command of commands) {
    if (!/^show\s/i.test(command.trim())) {
      throw new Error(`Only read-only "show" commands are allowed. Rejected: ${command}`);
    }
  }
  const devices = await findLiveDevices(deviceQuery);
  const uuids = devices.map((device) => device.id).slice(0, 4);
  const outputs = await catc.runCommands(uuids, commands.slice(0, 5));
  return {
    scope: devices.map((device) => device.hostname).join(", "),
    outputs,
  };
}

async function getLiveTopologyMermaid() {
  const topology = await catc.getTopology();
  const lines = ["flowchart TD"];
  const idFor = new Map();
  topology.nodes.forEach((node, index) => {
    const shortId = `N${index}`;
    idFor.set(node.label, shortId);
    lines.push(`  ${shortId}["${node.label} (${node.role || node.family || "device"})"]`);
  });
  for (const link of topology.links) {
    const a = idFor.get(link.source);
    const b = idFor.get(link.target);
    if (!a || !b) continue;
    const label = link.sourcePort && link.targetPort ? `|"${shortPort(link.sourcePort)} - ${shortPort(link.targetPort)}"|` : "";
    lines.push(`  ${a} ---${label} ${b}`);
  }
  return { mermaid: lines.join("\n"), topology };
}

function shortPort(port) {
  return String(port).replace("GigabitEthernet", "Gi").replace("TenGigabitEthernet", "Te").replace("FortyGigabitEthernet", "Fo");
}

module.exports = {
  resolveMode,
  getMode,
  getSnapshot,
  getInventoryRows,
  getLiveInterfaces,
  runLiveShowCommands,
  getLiveTopologyMermaid,
  findLiveDevices,
  catc,
  sim,
};
