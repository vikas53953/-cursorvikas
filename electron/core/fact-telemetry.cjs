// Silent, best-effort fact-audit telemetry (Task G6 / O4 phase 1).
//
// Records what ask_network's grounding engine actually produced (device,
// answerKind, the composed fact sentence or a short preview of raw CLI
// output) so a later pass can compare "what the engine grounded" against
// "what the model ultimately said". This is telemetry only for this phase:
// it never corrects, never blocks, never throws. It delegates to the
// existing logger.cjs, which already writes JSONL to data/logs and redacts
// secrets - see electron/logger.cjs.
const logger = require("../logger.cjs");

const PREVIEW_LEN = 300;

function preview(value) {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text) return undefined;
    return text.length > PREVIEW_LEN ? `${text.slice(0, PREVIEW_LEN)}...[${text.length} chars]` : text;
  } catch {
    return undefined;
  }
}

// logFactAudit({ channel, question, grounded }) - fire-and-forget. `grounded`
// is the raw result object returned by grounding.ask() (see
// electron/core/grounding.cjs): { status, device, answerKind, sentence |
// output, phrase, nearest, ... }. Never throws.
function logFactAudit({ channel, question, grounded } = {}) {
  try {
    const g = grounded || {};
    logger.log("fact.audit", {
      channel: channel || "unknown",
      question: question || "",
      status: g.status,
      device: g.device || null,
      answerKind: g.answerKind || null,
      sentence: g.sentence || null,
      outputPreview: g.answerKind === "output" ? preview(g.output) : undefined,
      phrase: g.phrase || undefined,
      nearest: g.nearest || undefined,
    });
  } catch {
    // Telemetry must never affect the answer or crash the caller.
  }
}

module.exports = { logFactAudit };
