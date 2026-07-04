// Single-fact composer.
//
// Given the user's verbatim question and an already-resolved device record,
// detect which single attribute the question is asking about (via a GENERAL
// attribute-synonym map — not per-device rules), read that field off the
// device, and return a natural, exact sentence.
//
// If no attribute is recognized, OR the matched field is missing/empty on
// the device, return { matched:false } so the caller falls through to the
// CLI path. Never guess.

// Attribute class -> { synonyms (word/phrase, matched with word boundaries),
// device field, sentence builder }.
// NOTE: synonyms here must be unambiguous inventory-attribute heads only.
// Bare words that also name a CLI/table concept (e.g. "address", "status",
// "running", "code") are deliberately excluded — see the CLI/table guard in
// composeFact below, which is the general fix for that ambiguity.
const ATTRIBUTES = [
  {
    key: "version",
    synonyms: ["version", "software", "ios"],
    field: "softwareVersion",
    sentence: (device, value) => {
      const software = device.software ? `${device.software} ` : "";
      return `${device.name} is running ${software}${value}.`;
    },
  },
  {
    key: "ip",
    synonyms: ["management ip", "ip address", "ip"],
    field: "mgmtIp",
    sentence: (device, value) => `${device.name}'s management IP is ${value}.`,
  },
  {
    key: "uptime",
    synonyms: ["uptime", "up time", "how long"],
    field: "uptime",
    sentence: (device, value) => `${device.name}'s uptime is ${value}.`,
  },
  {
    key: "model",
    synonyms: ["model", "platform", "hardware"],
    field: "platform",
    sentence: (device, value) => `${device.name}'s platform is ${value}.`,
  },
  {
    key: "serial",
    synonyms: ["serial number", "serial"],
    field: "serialNumber",
    sentence: (device, value) => `${device.name}'s serial number is ${value}.`,
  },
  {
    key: "role",
    synonyms: ["role"],
    field: "role",
    sentence: (device, value) => `${device.name}'s role is ${value}.`,
  },
  {
    key: "reachability",
    synonyms: ["reachability", "reachable"],
    field: "reachability",
    sentence: (device, value) => `${device.name} is ${value}.`,
  },
  {
    key: "cpu",
    synonyms: ["cpu"],
    field: "cpu",
    sentence: (device, value) => `${device.name}'s CPU utilization is ${value}.`,
  },
  {
    key: "memory",
    synonyms: ["memory", "mem"],
    field: "memory",
    sentence: (device, value) => `${device.name}'s memory utilization is ${value}.`,
  },
];

// CLI/table signal: a "show" verb, or any L2/L3 table noun. Single-fact
// composition only covers inventory attributes (version, IP, uptime, model,
// serial, role, reachability, CPU, memory) — anything that names a CLI
// command or a table-shaped construct belongs on the command/output path,
// never to single-attribute composition. This is a general guard, not a
// per-phrase blocklist: it fires on the class of question, not the wording.
const CLI_TABLE_SIGNALS = [
  "show",
  "vlan",
  "mac",
  "arp",
  "route",
  "routing",
  "interface",
  "spanning",
  "stp",
  "cdp",
  "lldp",
  "bgp",
  "ospf",
  "neighbor",
  "counter",
  "logging",
];

function hasCliTableSignal(question) {
  return CLI_TABLE_SIGNALS.some((word) => synonymRegex(word).test(question));
}

function synonymRegex(phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

// Finds the attribute class whose longest matching synonym is the most
// specific (longest) match in the question. Ties within one attribute don't
// matter since they map to the same field.
function detectAttribute(question) {
  let best = null; // { attr, len }
  for (const attr of ATTRIBUTES) {
    let attrBestLen = 0;
    for (const syn of attr.synonyms) {
      if (synonymRegex(syn).test(question)) {
        attrBestLen = Math.max(attrBestLen, syn.length);
      }
    }
    if (attrBestLen > 0 && (!best || attrBestLen > best.len)) {
      best = { attr, len: attrBestLen };
    }
  }
  return best ? best.attr : null;
}

/**
 * @param {string} question User's verbatim question text.
 * @param {object} device Resolved device record (already matched by the caller).
 * @returns {{matched:true, attribute:string, sentence:string} | {matched:false}}
 */
function composeFact(question, device) {
  if (!device) return { matched: false };
  const text = String(question || "");
  // General guard: CLI/table questions never resolve to a single fact, even
  // if they also contain a word that looks like an attribute synonym (e.g.
  // "show ip route" contains "ip"; "mac address table" contains nothing
  // ambiguous anymore, but "interface status" or "is it running ospf" would
  // without this). These belong to the CLI/output path.
  if (hasCliTableSignal(text)) return { matched: false };
  const attr = detectAttribute(text);
  if (!attr) return { matched: false };

  const value = device[attr.field];
  if (value === undefined || value === null || String(value).trim() === "") {
    return { matched: false };
  }

  return {
    matched: true,
    attribute: attr.key,
    sentence: attr.sentence(device, value),
  };
}

module.exports = { composeFact };
