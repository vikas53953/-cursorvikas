// Parse direct device fact questions (IP, uptime, hostname) for chat fast-path.

const WORD_NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

function extractDevicesFromText(text) {
  const devices = new Set();
  const lower = String(text || "").toLowerCase();

  for (const match of lower.matchAll(/\b(sw[1-9]\w*)\b/g)) {
    devices.add(match[1]);
  }

  for (const match of lower.matchAll(/\bswitch\s+(\d+)\b/g)) {
    devices.add(`sw${match[1]}`);
  }

  for (const match of lower.matchAll(/\bswitch\s+(one|two|three|four|five|six|seven|eight|nine)\b/g)) {
    devices.add(`sw${WORD_NUMBERS[match[1]]}`);
  }

  const pair = lower.match(/\bswitch\s+(\d+)\s+and\s+(\d+)\b/);
  if (pair) {
    devices.add(`sw${pair[1]}`);
    devices.add(`sw${pair[2]}`);
  }

  const swPair = lower.match(/\b(sw[1-9]\w*)\s+and\s+(sw[1-9]\w*)\b/);
  if (swPair) {
    devices.add(swPair[1]);
    devices.add(swPair[2]);
  }

  return [...devices].sort();
}

function parseDeviceFactQuery(message) {
  const lower = String(message || "").toLowerCase();
  if (/\bshow\s+/.test(lower)) return null;
  const devices = extractDevicesFromText(message);
  if (devices.length === 0) return null;

  const wantsNetworkOverview =
    /\b(how is (?:my |the )?network|network doing|give me the rundown|shift start|network overview|overall health|full network)\b/.test(
      lower,
    ) && !/\b(ip|uptime|hostname|address)\b/.test(lower);
  if (wantsNetworkOverview) return null;

  if (/\b(ip(?:\s+address)?|management\s+ip|address\s+of|what.*\bip\b)\b/.test(lower)) {
    return { kind: "ip", devices };
  }
  if (/\b(uptime|up\s*time|how\s+long.*up|running\s+for)\b/.test(lower)) {
    return { kind: "uptime", devices };
  }
  if (/\b(hostname|host\s*name|device\s+name)\b/.test(lower) && !/\b(uptime|ip)\b/.test(lower)) {
    return { kind: "hostname", devices };
  }

  return null;
}

function matchSnapshotDevices(queries, snapshotDevices) {
  const matched = [];
  const missing = [];

  for (const query of queries) {
    const normalized = String(query || "").toLowerCase();
    const row = snapshotDevices.find(
      (device) =>
        String(device.name || "").toLowerCase() === normalized ||
        String(device.name || "").toLowerCase().includes(normalized),
    );
    if (row) matched.push(row);
    else missing.push(query);
  }

  return { matched, missing };
}

function formatDeviceFactReply(kind, matched, missing) {
  const parts = [];

  for (const device of matched) {
    const name = device.name || "device";
    if (kind === "ip") {
      parts.push(`${name}'s management IP is ${device.ip || "not available"}.`);
    } else if (kind === "uptime") {
      parts.push(`${name}'s uptime is ${device.uptime || "not available"}.`);
    } else if (kind === "hostname") {
      parts.push(`${name}'s hostname is ${name}.`);
    }
  }

  if (missing.length > 0) {
    parts.push(`I couldn't find ${missing.join(", ")} in inventory.`);
  }

  return parts.join(" ");
}

module.exports = {
  extractDevicesFromText,
  parseDeviceFactQuery,
  matchSnapshotDevices,
  formatDeviceFactReply,
};
