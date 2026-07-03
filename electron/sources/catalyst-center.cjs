// Cisco Catalyst Center (DNA Center) adapter.
//
// Talks to a Catalyst Center instance over its Intent API. Defaults to the
// Cisco DevNet Always-On sandbox (https://sandboxdnac.cisco.com), which is a
// real, public, four-switch Catalyst 9000v network. Works with any Catalyst
// Center: override CATC_BASE_URL / CATC_USERNAME / CATC_PASSWORD in .env.local.
//
// The sandbox uses a self-signed certificate, so requests are made with TLS
// verification disabled for this host only (never send real credentials to a
// host you do not trust).

const https = require("node:https");
const { URL } = require("node:url");

const config = {
  baseUrl: process.env.CATC_BASE_URL || "https://sandboxdnac.cisco.com",
  username: process.env.CATC_USERNAME || "devnetuser",
  password: process.env.CATC_PASSWORD || "Cisco123!",
};

let cachedToken = null; // { value, mintedAt }

function httpRequest(method, path, { headers = {}, body = null, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, config.baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const request = https.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        rejectUnauthorized: false,
        headers: {
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (response) => {
        let raw = "";
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolve({ status: response.statusCode || 0, json, raw });
        });
      },
    );
    request.on("timeout", () => {
      request.destroy(new Error(`Catalyst Center request timed out after ${timeoutMs}ms: ${method} ${path}`));
    });
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function getToken(force = false) {
  const maxAgeMs = 50 * 60 * 1000;
  if (!force && cachedToken && Date.now() - cachedToken.mintedAt < maxAgeMs) {
    return cachedToken.value;
  }
  const basic = Buffer.from(`${config.username}:${config.password}`).toString("base64");
  const response = await httpRequest("POST", "/dna/system/api/v1/auth/token", {
    headers: { Authorization: `Basic ${basic}` },
    timeoutMs: 10000,
  });
  const token = response.json?.Token;
  if (response.status !== 200 || !token) {
    throw new Error(`Catalyst Center auth failed (${response.status}): ${response.raw.slice(0, 200)}`);
  }
  cachedToken = { value: token, mintedAt: Date.now() };
  return token;
}

async function api(method, path, options = {}) {
  const token = await getToken();
  let response = await httpRequest(method, path, { ...options, headers: { "X-Auth-Token": token, ...(options.headers || {}) } });
  if (response.status === 401) {
    const fresh = await getToken(true);
    response = await httpRequest(method, path, { ...options, headers: { "X-Auth-Token": fresh, ...(options.headers || {}) } });
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Catalyst Center API ${method} ${path} failed (${response.status}): ${response.raw.slice(0, 200)}`);
  }
  return response.json;
}

async function checkReachable() {
  await getToken();
  return true;
}

async function getInventory() {
  const data = await api("GET", "/dna/intent/api/v1/network-device");
  return (data?.response || []).map((device) => ({
    id: device.id,
    hostname: device.hostname,
    managementIp: device.managementIpAddress,
    role: device.role,
    family: device.family,
    platform: device.platformId,
    series: device.series,
    softwareType: device.softwareType,
    softwareVersion: device.softwareVersion,
    serialNumber: device.serialNumber,
    reachability: device.reachabilityStatus,
    uptime: device.upTime,
    lastUpdated: device.lastUpdated,
    description: device.description,
  }));
}

async function getDeviceHealth() {
  const data = await api("GET", "/dna/intent/api/v1/device-health");
  return (data?.response || []).map((device) => ({
    name: device.name,
    ipAddress: device.ipAddress,
    overallHealth: device.overallHealth,
    issueCount: device.issueCount,
    cpuUtilization: device.cpuUtilization,
    memoryUtilization: device.memoryUtilization,
    reachabilityHealth: device.reachabilityHealth,
    deviceFamily: device.deviceFamily,
    deviceType: device.deviceType,
    location: device.location,
    uuid: device.uuid,
  }));
}

async function getNetworkHealth() {
  const data = await api("GET", "/dna/intent/api/v1/network-health");
  const latest = data?.response?.[0] || {};
  return {
    healthScore: data?.latestHealthScore ?? latest.healthScore ?? null,
    totalDevices: data?.totalDevices ?? latest.totalCount ?? 0,
    healthyDevices: data?.monitoredHealthyDevices ?? latest.goodCount ?? 0,
    unhealthyDevices: data?.monitoredUnHealthyDevices ?? latest.badCount ?? 0,
    fairDevices: latest.fairCount ?? 0,
    distribution: data?.healthDistirubution || [],
  };
}

async function getTopology() {
  const data = await api("GET", "/dna/intent/api/v1/topology/physical-topology");
  const nodes = (data?.response?.nodes || []).map((node) => ({
    id: node.id,
    label: node.label,
    role: node.role,
    family: node.family,
    ip: node.ip,
    deviceType: node.deviceType,
    platformId: node.platformId,
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set();
  const links = [];
  for (const link of data?.response?.links || []) {
    const source = nodeById.get(link.source)?.label || link.source;
    const target = nodeById.get(link.target)?.label || link.target;
    const key = [source, link.startPortName, target, link.endPortName].join("|");
    const reverseKey = [target, link.endPortName, source, link.startPortName].join("|");
    if (seen.has(key) || seen.has(reverseKey)) continue;
    seen.add(key);
    links.push({
      source,
      sourcePort: link.startPortName || "",
      target,
      targetPort: link.endPortName || "",
      status: link.linkStatus || "unknown",
    });
  }
  return { nodes, links };
}

async function getInterfaces(deviceId) {
  const data = await api("GET", `/dna/intent/api/v1/interface/network-device/${deviceId}`);
  return (data?.response || []).map((iface) => ({
    portName: iface.portName,
    status: iface.status,
    adminStatus: iface.adminStatus,
    speed: iface.speed,
    duplex: iface.duplex,
    portMode: iface.portMode,
    interfaceType: iface.interfaceType,
    vlanId: iface.vlanId,
    ipv4Address: iface.ipv4Address,
    ipv4Mask: iface.ipv4Mask,
    macAddress: iface.macAddress,
    description: iface.description,
    lastUpdated: iface.lastUpdated,
  }));
}

async function getIssues() {
  const data = await api("GET", "/dna/intent/api/v1/issues");
  return (data?.response || []).map((issue) => ({
    issueId: issue.issueId,
    name: issue.name,
    deviceId: issue.deviceId,
    deviceRole: issue.deviceRole,
    clientMac: issue.clientMac,
    issueOccurenceCount: issue.issueOccurenceCount,
    status: issue.status,
    priority: issue.priority,
    category: issue.category,
    lastOccurenceTime: issue.last_occurence_time || issue.lastOccurenceTime,
  }));
}

async function getEvents(limit = 12) {
  try {
    const data = await api("GET", `/dna/intent/api/v1/event/event-series?limit=${limit}&sortBy=timestamp&order=DESC`);
    const rows = Array.isArray(data) ? data : data?.response || [];
    return rows.map((event) => ({
      timestamp: event.timestamp || null,
      name: event.name || event.eventId || "event",
      severity: event.severity ?? "",
      type: event.type || "",
      description: event.description || "",
      source: event.source || "",
    }));
  } catch {
    return [];
  }
}

async function getClientHealth() {
  try {
    const data = await api("GET", "/dna/intent/api/v1/client-health");
    const detail = data?.response?.[0]?.scoreDetail || [];
    const all = detail.find((entry) => entry.scoreCategory?.value === "ALL");
    return {
      clientCount: all?.clientCount ?? 0,
      scoreValue: all?.scoreValue ?? -1,
    };
  } catch {
    return { clientCount: 0, scoreValue: -1 };
  }
}

// Runs read-only CLI commands on devices through Command Runner and returns
// { [hostname]: { [command]: output } }.
async function runCommands(deviceUuids, commands, { pollTimeoutMs = 40000 } = {}) {
  const started = await api("POST", "/dna/intent/api/v1/network-device-poller/cli/read-request", {
    body: { commands, deviceUuids },
    timeoutMs: 20000,
  });
  const taskId = started?.response?.taskId;
  if (!taskId) throw new Error("Command Runner did not return a task id.");

  const deadline = Date.now() + pollTimeoutMs;
  let fileId = null;
  while (Date.now() < deadline) {
    await sleep(2000);
    const task = await api("GET", `/dna/intent/api/v1/task/${taskId}`);
    const progress = task?.response?.progress || "";
    if (task?.response?.isError) {
      throw new Error(`Command Runner task failed: ${progress || task?.response?.failureReason || "unknown"}`);
    }
    if (progress.includes("fileId")) {
      try {
        fileId = JSON.parse(progress).fileId;
      } catch {
        fileId = null;
      }
      if (fileId) break;
    }
  }
  if (!fileId) throw new Error("Command Runner timed out waiting for results.");

  const file = await api("GET", `/dna/intent/api/v1/file/${fileId}`, { timeoutMs: 20000 });
  const results = {};
  const inventory = await getInventoryCached();
  const hostByUuid = new Map(inventory.map((device) => [device.id, device.hostname]));
  for (const entry of Array.isArray(file) ? file : []) {
    const host = hostByUuid.get(entry.deviceUuid) || entry.deviceUuid;
    const success = entry.commandResponses?.SUCCESS || {};
    const failure = entry.commandResponses?.FAILURE || {};
    const blocked = entry.commandResponses?.BLOCKLISTED || {};
    results[host] = { ...success };
    for (const [command, output] of Object.entries(failure)) {
      results[host][command] = `FAILED: ${output}`;
    }
    for (const command of Object.keys(blocked)) {
      results[host][command] = "BLOCKED: this command is not allowed by the Command Runner policy.";
    }
  }
  return results;
}

let inventoryCache = null; // { at, rows }
async function getInventoryCached() {
  if (inventoryCache && Date.now() - inventoryCache.at < 60000) return inventoryCache.rows;
  const rows = await getInventory();
  inventoryCache = { at: Date.now(), rows };
  return rows;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  config,
  checkReachable,
  getInventory,
  getInventoryCached,
  getDeviceHealth,
  getNetworkHealth,
  getTopology,
  getInterfaces,
  getIssues,
  getEvents,
  getClientHealth,
  runCommands,
};
