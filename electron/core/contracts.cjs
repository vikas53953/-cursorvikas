// Shared contracts for the two-plane network architecture.
//
// @typedef {Object} Device
// @property {string} id            Stable id (source-native, e.g. CATC uuid)
// @property {string} name          Hostname
// @property {string} mgmtIp        Management IP
// @property {string} domain        One of DOMAINS
// @property {string} platform      Normalized platform key (see PLATFORMS)
// @property {string} role          Lowercased role (access/core/distribution/...)
// @property {string} site          Site/location ("" if unknown)
// @property {string} sourceId      Owning Source id
// @property {string} executor      Executor key ("catalyst-center" | "ssh")
//
// @typedef {Object} InventoryProvider
// @property {(filter?:object)=>Promise<Device[]>} search
// @property {()=>Promise<{ok:boolean,reachable:boolean,error?:string}>} health
//
// @typedef {Object} Executor
// @property {(device:Device, commands:string[])=>Promise<{host:string, outputs:Object, ok:boolean, error?:string}>} runReadOnly
// @property {(device:Device)=>boolean} supports
//
// @typedef {Object} Source
// @property {string} id
// @property {string} domain
// @property {InventoryProvider} inventory
// @property {Executor} executor

const DOMAINS = ["data", "firewall", "proxy", "loadbalancer"];

// Platform key → the command verbs that are read-only on that platform.
const PLATFORMS = {
  "ios-xe": { readOnlyVerbs: ["show"] },
  "nx-os": { readOnlyVerbs: ["show"] },
  "pan-os": { readOnlyVerbs: ["show"] },
  "f5-tmos": { readOnlyVerbs: ["show", "list"] },
};

function normalizePlatform(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("ios") && s.includes("xe")) return "ios-xe";
  if (s.includes("nx")) return "nx-os";
  if (s.includes("pan")) return "pan-os";
  if (s.includes("f5") || s.includes("tmos") || s.includes("big-ip")) return "f5-tmos";
  return "ios-xe"; // sandbox default; real inventory carries an explicit platform
}

/** @returns {Device} */
function normalizeDevice(raw, { sourceId, executor, domain = "data" } = {}) {
  return {
    id: String(raw.id || raw.uuid || raw.hostname || ""),
    name: String(raw.hostname || raw.name || raw.id || ""),
    mgmtIp: String(raw.managementIp || raw.mgmtIp || raw.ipAddress || ""),
    domain,
    platform: normalizePlatform(raw.softwareType || raw.platform || raw.family),
    role: String(raw.role || "").toLowerCase(),
    site: String(raw.site || raw.location || ""),
    sourceId: String(sourceId || ""),
    executor: String(executor || ""),
  };
}

module.exports = { DOMAINS, PLATFORMS, normalizePlatform, normalizeDevice };
