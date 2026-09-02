// Unified intent classification for all NetJarvis message channels.

const { parseDeviceFactQuery, extractDevicesFromText } = require("./device-facts.cjs");

const INTENTS = {
  DEVICE_FACT: "device_fact",
  NETWORK_OVERVIEW: "network_overview",
  DEVICE_PRECHECK: "device_precheck",
  INTERFACE_STATUS: "interface_status",
  CLI_SHOW: "cli_show",
  INVESTIGATE: "investigate",
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

function extractDeviceFromText(text, devices) {
  const names = extractDevicesFromText(text, devices);
  return names[0] || null;
}

function parsePrecheckRoute(message, agentsApi, devices) {
  const lower = String(message || "").toLowerCase();
  const device = extractDeviceFromText(message, devices);
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

function parseInterfaceStatusRoute(message, devices) {
  const lower = String(message || "").toLowerCase();
  if (/\bshow\s+/.test(lower)) return null;

  const device = extractDeviceFromText(message, devices);
  if (!device) return null;

  // Spanning-tree questions are not interface/link status.
  if (/\b(spanning[- ]?tree|stp|rstp|pvst|root bridge)\b/.test(lower) && !/\b(ethernet|interface|port|link)s?\b/.test(lower)) {
    return null;
  }

  const asksInterfaces =
    (/\b(ethernet|interface|port|link)s?\b/.test(lower) && /\b(status|state|up|down|connected)\b/.test(lower)) ||
    /\bwhat\b.*\b(ethernet|interface|port|link)s?\b/.test(lower) ||
    /\b(ethernet|interface|port|link)s?\b.*\bon\b/.test(lower);

  if (!asksInterfaces) return null;

  return {
    device,
    problemsOnly: /\b(problem|error|issue|flap|down only|only down)\b/.test(lower),
  };
}

function parseCliShowRoute(message, devices) {
  const lower = String(message || "").toLowerCase();
  const device = extractDeviceFromText(message, devices);
  if (!device) return null;

  const showMatch = lower.match(/\bshow\s+[\w\s-|]+/);
  if (!showMatch) return null;

  const command = showMatch[0].trim();
  if (/precheck|pre-check|pre post/.test(lower)) return null;

  return { device, commands: [command] };
}

// Cross-platform investigation: "investigate user jdoe", "what did 10.20.0.7 do
// in the last 6 hours", "timeline for host LT-4421", "correlate ... for jdoe@corp".
// Needs both an investigation verb and a seed entity; otherwise falls through.
const INVESTIGATE_VERB = /\b(investigat\w*|correlate|timeline|trace|what (?:did|has) .{1,60}\b(?:do|done|access|touch)|activity (?:for|of|from)|evidence (?:for|on|about))\b/i;
const IPV4_TOKEN = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/;

function parseLookbackHours(lower) {
  const m = lower.match(/\b(?:last|past|previous)\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|h|days?|d|weeks?|w)\b/);
  if (!m) {
    if (/\b(?:last|past)\s+(?:hour|hr)\b/.test(lower)) return 1;
    if (/\b(?:last|past)\s+day\b|\byesterday\b|\bovernight\b/.test(lower)) return 24;
    if (/\b(?:last|past)\s+week\b/.test(lower)) return 24 * 7;
    return null;
  }
  const n = Number(m[1]);
  const unit = m[2];
  if (/^m/.test(unit)) return Math.max(1, Math.ceil(n / 60));
  if (/^h/.test(unit)) return n;
  if (/^d/.test(unit)) return n * 24;
  if (/^w/.test(unit)) return n * 24 * 7;
  return null;
}

function parseInvestigateRoute(message, devices) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  if (!INVESTIGATE_VERB.test(lower)) return null;

  const explicitUser = text.match(/\b(?:user|account|username|upn|employee)\s+[:=]?\s*([A-Za-z0-9][A-Za-z0-9._\\@-]{1,80})/i);
  const explicitHost = text.match(/\b(?:host|hostname|endpoint|laptop|workstation|server|device|machine)\s+[:=]?\s*([A-Za-z0-9][A-Za-z0-9._-]{1,80})/i);
  const ip = text.match(IPV4_TOKEN);
  const email = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);

  let entity = null;
  if (explicitUser) entity = { kind: "user", value: explicitUser[1] };
  else if (ip) entity = { kind: "ip", value: ip[0] };
  else if (explicitHost) entity = { kind: "host", value: explicitHost[1] };
  else if (email) entity = { kind: "user", value: email[0] };
  else {
    const device = extractDeviceFromText(text, devices);
    if (device) entity = { kind: "host", value: device };
  }
  if (!entity) return null;

  const platforms = [];
  for (const [platform, pattern] of Object.entries({
    network: /\b(network|switch|catalyst)\b/,
    vpn: /\bvpn\b|anyconnect|globalprotect/,
    proxy: /\bprox(?:y|ies)\b|zscaler|bluecoat/,
    firewall: /\bfirewalls?\b|\bfw\b|palo alto|\basa\b/,
    endpoint: /\bendpoints?\b|\bedr\b|crowdstrike|defender|sysmon/,
    identity: /\bidentity\b|\bokta\b|\bauth(?:entication)?\b|\bactive directory\b|\bad\b|\bentra\b|\blogins?\b|\bsign-?ins?\b/,
    cloud: /\bcloud\b|\baws\b|cloudtrail|\bazure\b|\bgcp\b/,
    siem: /\bsplunk\b|\bsiem\b|\bnotables?\b/,
  })) {
    if (pattern.test(lower)) platforms.push(platform);
  }

  const lookbackHours = parseLookbackHours(lower);
  return { entity, lookbackHours, platforms: platforms.length ? platforms : undefined };
}

function parseDelegateRoute(message, agentsApi, devices) {
  const handles = extractMentionHandles(message).filter((h) => h !== "jarvis");
  if (handles.length === 0) return null;

  const lower = String(message || "").toLowerCase();
  const device = extractDeviceFromText(message, devices);
  const isPrecheck = /pre[-\s]?post|pre[-\s]?check|precheck/.test(lower);

  if (isPrecheck && device) return null;

  const teams = handles
    .map((handle) => ({ handle, spec: agentsApi.resolveTeam(handle) }))
    .filter((entry) => entry.spec);

  if (teams.length === 0) return null;

  return { teams: teams.map((t) => t.handle), primary: teams[0].handle };
}

function classifyIntent(message, { agentsApi, target = "jarvis", devices } = {}) {
  const trimmed = String(message || "").trim();
  const lower = trimmed.toLowerCase();

  const precheck = parsePrecheckRoute(trimmed, agentsApi, devices);
  if (precheck) {
    return {
      intent: INTENTS.DEVICE_PRECHECK,
      confidence: "high",
      meta: precheck,
    };
  }

  const cliShow = parseCliShowRoute(trimmed, devices);
  if (cliShow) {
    return { intent: INTENTS.CLI_SHOW, confidence: "high", meta: cliShow };
  }

  const investigate = parseInvestigateRoute(trimmed, devices);
  if (investigate) {
    return { intent: INTENTS.INVESTIGATE, confidence: "high", meta: investigate };
  }

  const interfaceStatus = parseInterfaceStatusRoute(trimmed, devices);
  if (interfaceStatus) {
    return { intent: INTENTS.INTERFACE_STATUS, confidence: "high", meta: interfaceStatus };
  }

  const factQuery = parseDeviceFactQuery(trimmed, devices);
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

  const delegate = parseDelegateRoute(trimmed, agentsApi, devices);
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
- interface_status (Ethernet/interface/port/link status on a named device): use interface_report — not spanning-tree unless they asked for STP.
- network_overview: only when the engineer asks how the network is doing or wants a shift rundown.
- device_precheck: batch all standard show commands in one run_show_command on the named device.
- cli_show: run the requested show command on the named device.
- investigate: cross-platform SOC investigation of a user / IP / host - call investigate with the seed entity and window; report the timeline, coverage and gaps only.
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
  parseInvestigateRoute,
  parseLookbackHours,
};
