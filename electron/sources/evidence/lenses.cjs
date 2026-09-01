// Splunk evidence lenses: one read-only SPL template per SOC platform.
//
// The lenses lean on Splunk's Common Information Model (CIM) field names
// (user, src, dest, action, app, url, signature, ...) so the same lens works
// across vendors that are CIM-normalized - Cisco ASA/FTD and Palo Alto for VPN
// and firewall, Zscaler/Bluecoat for proxy, CrowdStrike/Defender/Sysmon for
// endpoint, Okta/AD/Entra for identity, CloudTrail/Azure/GCP audit for cloud.
// Each lens's base search is overridable per environment via
// SPLUNK_LENS_<PLATFORM> (e.g. SPLUNK_LENS_VPN="index=netsec sourcetype=cisco:asa")
// because real indexes and sourcetypes differ from shop to shop.

const { splQuote } = require("../../core/spl-policy.cjs");

const CIM_FIELDS = [
  "_time", "host", "index", "source", "sourcetype", "user", "src_user", "user_name", "Account_Name",
  "src", "src_ip", "dest", "dest_ip", "dest_host", "dvc", "assigned_ip", "clientip", "ComputerName", "hostname",
  "action", "app", "url", "uri", "http_method", "status", "signature", "signature_id", "EventCode", "eventName",
  "eventSource", "awsRegion", "errorCode", "reason", "vendor_product", "severity", "category", "bytes_in", "bytes_out",
  "dest_port", "transport", "process", "process_name", "parent_process", "file_name", "file_hash", "sha256",
  "result", "outcome", "displayMessage", "eventType", "rule_name", "search_name", "urgency", "protocol", "duration",
];

const LENSES = [
  {
    id: "vpn",
    platform: "vpn",
    title: "VPN sessions",
    defaultBase: 'index=* (tag=vpn OR sourcetype IN ("cisco:asa","cisco:ftd","pan:globalprotect","zscaler:zpa","fortigate_event")) (vpn OR anyconnect OR globalprotect OR webvpn OR "Session" OR "tunnel")',
  },
  {
    id: "proxy",
    platform: "proxy",
    title: "Web proxy",
    defaultBase: 'index=* (tag=web OR tag=proxy OR sourcetype IN ("zscalernss-web","bluecoat:proxysg:access:syslog","squid:access","pan:threat","mcafee:wg:kv"))',
  },
  {
    id: "firewall",
    platform: "firewall",
    title: "Firewall traffic",
    defaultBase: 'index=* ((tag=network tag=communicate) OR sourcetype IN ("pan:traffic","cisco:asa","cisco:ftd","fortigate_traffic","cp_log","cisco:fwsm"))',
  },
  {
    id: "endpoint",
    platform: "endpoint",
    title: "Endpoint (EDR)",
    defaultBase: 'index=* (tag=endpoint OR tag=malware OR tag=process OR sourcetype IN ("crowdstrike:events:sensor","CrowdStrike:Event:Streams:JSON","XmlWinEventLog:Microsoft-Windows-Sysmon/Operational","ms:defender:atp:alerts","sentinelone:channel:events","carbonblack:events"))',
  },
  {
    id: "identity",
    platform: "identity",
    title: "Identity / authentication",
    defaultBase: 'index=* (tag=authentication OR sourcetype IN ("OktaIM2:log","WinEventLog:Security","XmlWinEventLog:Security","azure:aad:signin","o365:management:activity","duo:authentication","cisco:ise:syslog"))',
  },
  {
    id: "cloud",
    platform: "cloud",
    title: "Cloud control plane",
    defaultBase: 'index=* (tag=cloud OR sourcetype IN ("aws:cloudtrail","azure:monitor:activity","google:gcp:pubsub:audit","o365:management:activity","aws:s3:accesslogs"))',
  },
  {
    id: "siem",
    platform: "siem",
    title: "SIEM notables / alerts",
    defaultBase: "index=notable",
  },
];

function entityFilter(entity) {
  const v = splQuote(entity.value);
  switch (entity.kind) {
    case "user":
      return `(user=${v} OR src_user=${v} OR user_name=${v} OR Account_Name=${v} OR userIdentity.userName=${v} OR actor.alternateId=${v})`;
    case "ip":
      return `(src=${v} OR src_ip=${v} OR dest=${v} OR dest_ip=${v} OR assigned_ip=${v} OR clientip=${v} OR sourceIPAddress=${v} OR client.ipAddress=${v})`;
    case "host":
    default:
      return `(host=${v} OR dest=${v} OR src=${v} OR dest_host=${v} OR dvc=${v} OR ComputerName=${v} OR hostname=${v} OR dest_nt_host=${v})`;
  }
}

function baseFor(lens, env = process.env) {
  const override = String(env[`SPLUNK_LENS_${lens.id.toUpperCase()}`] || "").trim();
  return override || lens.defaultBase;
}

function buildSpl(lens, entity, { limit = 200, env = process.env } = {}) {
  const base = baseFor(lens, env);
  const cap = Math.max(1, Math.min(Number(limit) || 200, 1000));
  return `search ${base} ${entityFilter(entity)} | fields ${CIM_FIELDS.join(" ")} | head ${cap}`;
}

function pick(row, ...keys) {
  for (const key of keys) {
    const value = row[key];
    if (value == null || value === "") continue;
    return Array.isArray(value) ? String(value[0]) : String(value);
  }
  return "";
}

function productOf(row) {
  const vendor = pick(row, "vendor_product");
  if (vendor) return vendor.toLowerCase();
  const st = pick(row, "sourcetype").toLowerCase();
  if (!st) return "";
  return st.split(":").slice(0, 2).join(":");
}

// Maps a Splunk row into the EvidenceEvent contract; summary is built strictly
// from fields present on the row.
function mapRow(lens, row) {
  const user = pick(row, "user", "src_user", "user_name", "Account_Name", "userIdentity.userName", "actor.alternateId");
  const srcIp = pick(row, "src_ip", "src", "clientip", "sourceIPAddress", "client.ipAddress");
  const destIp = pick(row, "dest_ip", "dest");
  const host = pick(row, "dest_host", "ComputerName", "hostname", "dvc", "host");
  const action = pick(row, "action", "result", "outcome", "status");
  const app = pick(row, "app", "eventSource");
  const url = pick(row, "url", "uri");
  const signature = pick(row, "signature", "rule_name", "search_name", "eventName", "displayMessage", "eventType", "EventCode", "signature_id");
  const severity = pick(row, "severity", "urgency");
  const process = pick(row, "process_name", "process");
  const assignedIp = pick(row, "assigned_ip");

  let kind = `${lens.platform}.event`;
  let summary = "";
  switch (lens.platform) {
    case "vpn":
      kind = /disconnect|teardown|logout|terminat/i.test(`${signature} ${action}`) ? "vpn.disconnect" : "vpn.session";
      summary = [signature || "VPN session", action && `action=${action}`, assignedIp && `assigned ${assignedIp}`, app && `via ${app}`].filter(Boolean).join(" ");
      break;
    case "proxy":
      kind = /block|den/i.test(action) ? "proxy.blocked" : "proxy.request";
      summary = [pick(row, "http_method"), url, action && `[${action}]`, pick(row, "category") && `cat=${pick(row, "category")}`].filter(Boolean).join(" ");
      break;
    case "firewall":
      kind = /deny|drop|block|reset/i.test(action) ? "fw.deny" : "fw.allow";
      summary = [action || "traffic", destIp && `to ${destIp}${pick(row, "dest_port") ? `:${pick(row, "dest_port")}` : ""}`, pick(row, "transport", "protocol"), app && `app=${app}`, pick(row, "rule_name") && `rule=${pick(row, "rule_name")}`].filter(Boolean).join(" ");
      break;
    case "endpoint":
      kind = /detect|alert|malware|quarant/i.test(`${signature} ${pick(row, "category")}`) ? "edr.detection" : "edr.event";
      summary = [signature || "endpoint event", process && `process=${process}`, pick(row, "file_name") && `file=${pick(row, "file_name")}`, action && `[${action}]`].filter(Boolean).join(" ");
      break;
    case "identity": {
      const failed = /fail|denied|invalid|lock/i.test(`${action} ${signature} ${pick(row, "reason")}`);
      kind = failed ? "auth.failure" : "auth.success";
      summary = [signature || "authentication", action && `[${action}]`, app && `app=${app}`, pick(row, "reason") && `reason=${pick(row, "reason")}`].filter(Boolean).join(" ");
      break;
    }
    case "cloud":
      kind = "cloud.api";
      summary = [signature || "cloud api call", app && `(${app})`, pick(row, "awsRegion") && `region=${pick(row, "awsRegion")}`, pick(row, "errorCode") && `error=${pick(row, "errorCode")}`].filter(Boolean).join(" ");
      break;
    case "siem":
      kind = "siem.notable";
      summary = [signature || "notable event", severity && `urgency=${severity}`].filter(Boolean).join(" ");
      break;
    default:
      summary = signature || action || lens.title;
  }

  return {
    ts: pick(row, "_time"),
    provider: "splunk",
    platform: lens.platform,
    product: productOf(row),
    kind,
    severity,
    entities: { user, srcIp, destIp, host, app, url, action, assignedIp, process, index: pick(row, "index"), sourcetype: pick(row, "sourcetype") },
    summary,
    raw: trimRow(row),
  };
}

function trimRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (key.startsWith("_") && key !== "_time") continue;
    out[key] = typeof value === "string" ? value.slice(0, 300) : value;
  }
  return out;
}

function lensById(id) {
  return LENSES.find((l) => l.id === String(id || "").toLowerCase()) || null;
}

module.exports = { LENSES, CIM_FIELDS, entityFilter, baseFor, buildSpl, mapRow, lensById, productOf };
