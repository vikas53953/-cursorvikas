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
const ATTRIBUTES = [
  {
    key: "version",
    synonyms: ["version", "software", "ios", "code", "running"],
    field: "softwareVersion",
    sentence: (device, value) => {
      const software = device.software ? `${device.software} ` : "";
      return `${device.name} is running ${software}${value}.`;
    },
  },
  {
    key: "ip",
    synonyms: ["management ip", "ip address", "ip", "address"],
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
    synonyms: ["reachability", "reachable", "status"],
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
  const attr = detectAttribute(String(question || ""));
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
