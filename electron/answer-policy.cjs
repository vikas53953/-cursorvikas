// Answer shape rules per intent — structure enforced in code, data from live tools.

const { sanitizeSquadChatReply } = require("./chat-reply.cjs");
const { formatDeviceFactReply } = require("./device-facts.cjs");
const { INTENTS } = require("./message-router.cjs");

const PREAMBLE_PATTERN =
  /^(?:let me|i(?:'ll| will)|give me a (?:second|moment)|hang on|one sec|checking|pulling up)[^.!?]*[.!?]\s*/i;

function stripPreamble(text) {
  let result = String(text || "").trim();
  for (let i = 0; i < 3 && PREAMBLE_PATTERN.test(result); i += 1) {
    result = result.replace(PREAMBLE_PATTERN, "").trim();
  }
  return result;
}

function applyPolicy(intent, text, { factKind } = {}) {
  let cleaned = sanitizeSquadChatReply(stripPreamble(text));

  if (intent === INTENTS.DEVICE_FACT) {
    const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
    cleaned = sentences.slice(0, 2).join(" ");
  }

  if (intent === INTENTS.NETWORK_OVERVIEW) {
    const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
    cleaned = sentences.slice(0, 4).join(" ");
  }

  if (intent === INTENTS.INTERFACE_STATUS) {
    const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
    cleaned = sentences.slice(0, 5).join(" ");
  }

  return cleaned.trim() || text;
}

function formatOverviewReply(snapshot) {
  const score = snapshot.health?.score != null ? ` Health score is ${snapshot.health.score} out of 100.` : "";
  const overall = snapshot.overall || "unknown";
  const healthy = snapshot.health?.healthyDevices ?? snapshot.devices?.filter((d) => d.status === "ok").length ?? 0;
  const total = snapshot.health?.totalDevices ?? snapshot.devices?.length ?? 0;
  const issues = snapshot.issues?.active ?? 0;
  const issueLine =
    issues === 0
      ? "There are no active issues."
      : `There ${issues === 1 ? "is" : "are"} ${issues} active issue${issues === 1 ? "" : "s"}.`;
  return `The network is ${overall}.${score} ${healthy} of ${total} devices are reachable, and ${issueLine} See the dashboard for the live picture.`;
}

function formatDeviceFactFromSnapshot(factKind, matched, missing) {
  return applyPolicy(INTENTS.DEVICE_FACT, formatDeviceFactReply(factKind, matched, missing), { factKind });
}

function precheckFallbackSummary(device) {
  return applyPolicy(
    INTENTS.DEVICE_PRECHECK,
    `**Summary** — CLI pre-check on ${device} completed. Expand the technical output below for raw command results.`,
  );
}

function squadChatSystemAppendix({ customRosterNote = "" } = {}) {
  return `
# Squad text chat mode
The engineer is using the Agent Squad #network-ops channel. @mentions route to specialists via delegate_task.${customRosterNote}

# Direct answers (CRITICAL)
- device_fact: one or two sentences with only the requested fact.
- network_overview: short health summary only when they asked for it.
- Do NOT narrate before answering. No unsolicited dumps.

# Reply format (chatops) — STRICT
- Structure: one-line **Summary** first, then **Details** when needed.
- Raw CLI output is shown separately — do not paste dumps in the reply.
- FORBIDDEN: "Next steps", "Recommended actions", or follow-up suggestions unless explicitly asked.
`;
}

function generalChatSystemAppendix({ customRosterNote = "" } = {}) {
  return squadChatSystemAppendix({ customRosterNote });
}

module.exports = {
  applyPolicy,
  stripPreamble,
  formatOverviewReply,
  formatDeviceFactFromSnapshot,
  precheckFallbackSummary,
  squadChatSystemAppendix,
  generalChatSystemAppendix,
};
