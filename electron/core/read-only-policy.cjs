// Per-platform read-only enforcement. A command must (a) start with a read-only
// verb allowed on the device's platform and (b) contain no mutating/dangerous token.
const { PLATFORMS } = require("./contracts.cjs");

const BLOCKED_PATTERNS = [
  /(?<![\w-])config(?:ure)?\b/i, /\bconf\s*t\b/i, /\bwrite\b/i, /\berase\b/i, /\bcopy\b/i,
  /\bdelete\b/i, /\bremove\b/i, /\bno\s+\w/i, /\bclear\b/i, /\breload\b/i,
  /\bshutdown\b/i, /\breboot\b/i, /\bdebug\b/i, /\btelnet\b/i, /\bssh\b/i,
  /\bappend\b/i, /\btclsh\b/i, /\bset\b/i, /\bcreate\b/i, /\bmodify\b/i,
  /\btee\b/i, /\bredirect\b/i,
  /[>|]\s*(?:flash|bootflash|disk|tftp|scp|ftp)/i,
  /\b(?:tee|redirect|append)\b[^|]*\b(?:flash|bootflash|disk\d?|nvram|tftp|scp|ftp|https?)\b/i,
];

function assertReadOnly(platform, command) {
  const cmd = String(command || "").trim();
  if (!cmd) return { ok: false, error: "Empty command." };
  const verbs = PLATFORMS[platform]?.readOnlyVerbs || ["show"];
  const firstWord = cmd.split(/\s+/)[0].toLowerCase();
  if (!verbs.includes(firstWord)) {
    return { ok: false, error: `Read-only policy: "${firstWord}" is not permitted on ${platform} (allowed: ${verbs.join(", ")}). Blocked: ${cmd}` };
  }
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) return { ok: false, error: `Read-only policy: command contains a blocked token. Blocked: ${cmd}` };
  }
  return { ok: true };
}

module.exports = { assertReadOnly, BLOCKED_PATTERNS };
