// Enterprise guardrails — read-only enforcement, blocked operations.

const { assertReadOnly } = require("./core/read-only-policy.cjs");

const BLOCKED_CLI_PATTERNS = [
  /\bconfig(?:ure)?\b/i,
  /\bconf\s*t\b/i,
  /\bwrite\s+(?:mem|memory|erase)\b/i,
  /\bcopy\b/i,
  /\bdelete\b/i,
  /\bno\s+/i,
  /\bclear\b/i,
  /\breload\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bdebug\b/i,
  /\btelnet\b/i,
  /\bssh\b/i,
];

const TOOLS_REQUIRING_CONFIRMATION = new Set(["acknowledge_alert"]);

function validateToolCall(name, args = {}) {
  if (name === "run_show_command") {
    const commands = Array.isArray(args.commands) ? args.commands.map(String) : [];
    for (const command of commands) {
      const verdict = assertReadOnly(args.platform || "ios-xe", command);
      if (!verdict.ok) return verdict;
    }
  }

  if (name === "acknowledge_alert" && args.confirmed !== true) {
    return { ok: false, error: "Confirmation required before acknowledging an alert." };
  }

  return { ok: true };
}

function isConfirmationRequired(name) {
  return TOOLS_REQUIRING_CONFIRMATION.has(name);
}

module.exports = { validateToolCall, isConfirmationRequired, BLOCKED_CLI_PATTERNS };
