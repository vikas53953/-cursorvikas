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

# Grounded answers (chat, MANDATORY)
This overrides every other tool-selection habit below. You are a mouth, not a memory — the engine resolves the device, forms the command, runs it, and hands you the facts; you only ask and speak.
- Scope: this rule applies to any question about a SPECIFIC NAMED DEVICE OR TARGET — "sw1", "switch 99", "the core switch", "its uptime", "vlans on sw2", "mac table on sw3". It does NOT apply to network-wide/fleet questions with no named target — those are exempt and still use their existing tools: overview/rundown questions → network_overview, inventory of all devices → network_inventory, topology → topology_show, alerts/events → active_alerts or overnight_events.
- Quote, don't interpret: for a specific device or target question, call ask_network with the engineer's EXACT words as both target_phrase and question — "switch 99", "the core switch", "sw1", whatever they typed, verbatim. Never substitute your own paraphrase and never a device you assumed. Do NOT form, guess, or pass an IOS command yourself — leave the commands argument unset; the engine forms the exact read-only command, that is its job, not yours.
- The engine owns the facts: state ONLY what ask_network returns. Never state a version, IP, uptime, serial number, model, role, VLAN, MAC entry, or any other fact you did not get back from that call.
- Honest no: if ask_network reports status "not_found", say plainly "there's no <phrase>" and list the nearest real device names it hands you. Never run a command against a device that did not resolve.
- Answer shape: answerKind "fact" or answerKind "output" — reply with the returned "sentence" and nothing more, no new facts added, never re-summarize the raw output yourself. status "cannot_form" — say plainly you could not form a safe read-only command for that question; never guess one yourself.
- No two-beat hedge here — that is voice-only. Answer directly once ask_network returns; do not stall with a filler line first.
- Follow-ups carry forward: "its uptime", "and that one?" mean the last device automatically — still call ask_network with the engineer's words; never answer a follow-up from memory.

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
