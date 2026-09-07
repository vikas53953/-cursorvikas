// Read-only enforcement for Splunk SPL, mirroring read-only-policy.cjs for
// device CLI. NetJarvis is read-only forever: an investigation may search,
// never write to an index, a lookup, a file, mail, or a shell.

const BLOCKED_COMMANDS = [
  "delete", "collect", "mcollect", "meventcollect", "summaryindex", "tscollect",
  "outputlookup", "outputcsv", "outputtext", "sendemail", "sendalert",
  "script", "run", "runshellscript", "rest", "dbxoutput", "dbxquery",
  "savedsearch", "map", "makeresults", "gentimes",
  "inputcsv", "inputintelligence", "sistats", "sichart", "sitimechart", "sitop", "sirare",
];

// Generating commands that may open a pipeline (leading "|").
const ALLOWED_GENERATING = ["search", "tstats", "from", "datamodel", "inputlookup", "metadata", "mstats", "mpreview", "pivot"];

const BLOCKED_PATTERN = new RegExp(`(?:^|\\|)\\s*(?:${BLOCKED_COMMANDS.join("|")})\\b`, "i");

function assertReadOnlySpl(spl) {
  const query = String(spl || "").trim();
  if (!query) return { ok: false, error: "Empty SPL." };
  const blocked = query.match(BLOCKED_PATTERN);
  if (blocked) {
    return { ok: false, error: `Read-only policy: SPL command "${blocked[0].replace(/^[|\s]+/, "")}" is not permitted. Blocked: ${query.slice(0, 120)}` };
  }
  const leading = query.startsWith("|") ? query.slice(1).trim().split(/\s+/)[0].toLowerCase() : "search";
  if (!ALLOWED_GENERATING.includes(leading)) {
    return { ok: false, error: `Read-only policy: SPL must start with one of ${ALLOWED_GENERATING.join(", ")} (got "${leading}").` };
  }
  return { ok: true };
}

/** Quotes a value for use inside an SPL field comparison. */
function splQuote(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

module.exports = { assertReadOnlySpl, splQuote, BLOCKED_COMMANDS, ALLOWED_GENERATING };
