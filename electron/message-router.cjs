// Unified intent classification for all NetJarvis message channels.

const { parseDeviceFactQuery, extractDevicesFromText } = require("./device-facts.cjs");

const INTENTS = {
  DEVICE_FACT: "device_fact",
  NETWORK_OVERVIEW: "network_overview",
  DEVICE_PRECHECK: "device_precheck",
  CLI_SHOW: "cli_show",
  DELEGATE: "delegate",
  GENERAL: "general",
};

const PRECHECK_COMMANDS = [
  "show version",
  "show interfaces status",
  "show interfaces counters errors",
  "show ip interface brief",
  "show vlan brief",
  "show spanning-tree summary",
  "show mac address-table",
  "show cdp neighbors detail",
  "show lldp neighbors detail",
  "show ip arp",
  "show ip route",
];

function extractMentionHandles(message) {
  const handles = [];
  for (const match of String(message || "").matchAll(/@([a-z][a-z0-9_-]*)/gi)) {
    handles.push(match[1].toLowerCase());
  }
  return [...new Set(handles)];
}

function extractDeviceFromText(text) {
  const devices = extractDevicesFromText(text);
  return devices[0] || null;
}

function parsePrecheckRoute(message, agentsApi) {
  const lower = String(message || "").toLowerCase();
  const device = extractDeviceFromText(message);
  if (!device) return null;

  const isPrecheck = /pre[-\s]?post|pre[-\s]?check|precheck|\brun\s+(?:a\s+)?precheck\b|\brun\s+on\b/.test(lower);
  if (!isPrecheck) return null;

  const handles = extractMentionHandles(message).filter((h) => h !== "jarvis");
  if (handles.length === 0) {
    return { team: "jarvis", device, commands: PRECHECK_COMMANDS };
  }
  if (handles.length !== 1) return null;

  const team = handles[0];
  const spec = agentsApi.resolveTeam(team);
  if (!spec) return null;

  const scope = String(spec.scope || "").toLowerCase();
  const isPrecheckAgent =
    spec.custom || team === "change" || /pre|post|check/.test(team) || /pre|post|check/.test(scope);
  if (!isPrecheckAgent) return null;

  return { team, device, commands: PRECHECK_COMMANDS };
}

function parseCliShowRoute(message) {
  const lower = String(message || "").toLowerCase();
  const device = extractDeviceFromText(message);
  if (!device) return null;

  const showMatch = lower.match(/\bshow\s+[\w\s-|]+/);
  if (!showMatch) return null;

  const command = showMatch[0].trim();
  if (/precheck|pre-check|pre post/.test(lower)) return null;

  return { device, commands: [command] };
}

function parseDelegateRoute(message, agentsApi) {
  const handles = extractMentionHandles(message).filter((h) => h !== "jarvis");
  if (handles.length === 0) return null;

  const lower = String(message || "").toLowerCase();
  const device = extractDeviceFromText(message);
  const isPrecheck = /pre[-\s]?post|pre[-\s]?check|precheck/.test(lower);

  if (isPrecheck && device) return null;

  const teams = handles
    .map((handle) => ({ handle, spec: agentsApi.resolveTeam(handle) }))
    .filter((entry) => entry.spec);

  if (teams.length === 0) return null;

  return { teams: teams.map((t) => t.handle), primary: teams[0].handle };
}

function classifyIntent(message, { agentsApi, target = "jarvis" } = {}) {
  const trimmed = String(message || "").trim();
  const lower = trimmed.toLowerCase();

  const precheck = parsePrecheckRoute(trimmed, agentsApi);
  if (precheck) {
    return {
      intent: INTENTS.DEVICE_PRECHECK,
      confidence: "high",
      meta: precheck,
    };
  }

  const cliShow = parseCliShowRoute(trimmed);
  if (cliShow) {
    return { intent: INTENTS.CLI_SHOW, confidence: "high", meta: cliShow };
  }

  const factQuery = parseDeviceFactQuery(trimmed);
  if (factQuery) {
    return {
      intent: INTENTS.DEVICE_FACT,
      confidence: "high",
      meta: { factKind: factQuery.kind, devices: factQuery.devices },
    };
  }

  if (
    /\b(how is (?:my |the )?network|network doing|give me the rundown|shift start|network overview|overall health|start of shift)\b/.test(
      lower,
    )
  ) {
    return { intent: INTENTS.NETWORK_OVERVIEW, confidence: "high", meta: {} };
  }

  const delegate = parseDelegateRoute(trimmed, agentsApi);
  if (delegate) {
    return { intent: INTENTS.DELEGATE, confidence: "high", meta: delegate };
  }

  const teamKey = String(target || "jarvis").toLowerCase();
  if (teamKey !== "jarvis") {
    return {
      intent: INTENTS.DELEGATE,
      confidence: "medium",
      meta: { teams: [teamKey], primary: teamKey, dmTarget: true },
    };
  }

  return { intent: INTENTS.GENERAL, confidence: "low", meta: {} };
}

function routerInstructionsAppendix() {
  return `
# Intent routing (enforced by NetJarvis core)
- device_fact (IP, uptime, hostname on a named switch): answer that fact only — never network_overview.
- network_overview: only when the engineer asks how the network is doing or wants a shift rundown.
- device_precheck: batch all standard show commands in one run_show_command on the named device.
- cli_show: run the requested show command on the named device.
- delegate: hand off to the @mentioned specialist via delegate_task.
`;
}

module.exports = {
  INTENTS,
  PRECHECK_COMMANDS,
  classifyIntent,
  routerInstructionsAppendix,
  extractMentionHandles,
  extractDeviceFromText,
};
