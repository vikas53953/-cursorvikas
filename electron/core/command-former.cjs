// Command-former: the STRONG brain that turns an engineer's INTENT into the
// exact read-only Cisco IOS-XE `show` command(s) that answer it.
//
// Voice/chat are just mouths: they never decide the command. This module
// prompts an injected chat-completion function as a Cisco IOS-XE expert,
// parses the model's JSON-array reply, and validates every candidate command
// through several independent, general guards before trusting it — never a
// per-question or per-device special case.
//
// Safety core (every returned command must pass ALL of these):
//   (a) a tight command shape: `^(show|sh)\b[\w .:|/*-]+$`
//   (b) first word is one of the caller's `legitVerbs`
//   (c) `read-only-policy.assertReadOnly(platform, command)` passes
//   (d) no natural-language filler words (me/the/please/what/is/are/on/of)
// A command that merely *starts* with "show" is not enough — natural-language
// echoes of the user's question ("show me the mac address table on sw1")
// pass (a)-(c) but are caught by (d).

const { assertReadOnly } = require("./read-only-policy.cjs");

const DEFAULT_LEGIT_VERBS = ["show", "sh"];
const DEFAULT_MODEL = "gpt-5.5";

// (a) Tight shape: must start with show/sh, then only word chars, spaces,
// and the small set of punctuation real IOS show commands use (pipes,
// filters, slashes for interface names, colons, dashes, dots, wildcards).
const SHAPE_RE = /^(show|sh)\b[\w .:|/*-]+$/i;

// (d) Whole-word filler tokens that never appear in a real IOS show command.
const FILLER_RE = /\b(me|the|please|what|is|are|on|of)\b/i;

function systemPrompt() {
  return [
    "You are a Cisco IOS-XE expert.",
    "Given the engineer's INTENT and the device platform, respond with ONLY the exact read-only `show` command(s) that answer it.",
    "Output a JSON array of strings and nothing else: no prose, no markdown, no code fences, no explanation.",
    "Never echo or paraphrase the user's sentence as a command.",
    "Never output a non-`show` command (no configure, clear, write, reload, debug, or any mutating verb).",
  ].join(" ");
}

function userPrompt(question, device) {
  const platform = (device && device.platform) || "ios-xe";
  return `INTENT: ${String(question || "")}\nDEVICE PLATFORM: ${platform}\nRespond with the JSON array of show command(s) now.`;
}

// Extracts a JSON array of strings from the model's reply. Tolerates a
// markdown code fence around the JSON (models sometimes add one despite
// instructions not to). Returns null (never throws) if the reply isn't a
// parseable JSON array of strings.
function parseCommands(content) {
  if (typeof content !== "string") return null;
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((c) => typeof c === "string" && c.trim());
  } catch {
    return null;
  }
}

function isValidCommand(command, platform, legitVerbs) {
  const cmd = String(command || "").trim();
  if (!cmd) return false;
  if (!SHAPE_RE.test(cmd)) return false;
  const firstWord = cmd.split(/\s+/)[0].toLowerCase();
  if (!legitVerbs.includes(firstWord)) return false;
  if (!assertReadOnly(platform, cmd).ok) return false;
  if (FILLER_RE.test(cmd)) return false;
  return true;
}

/**
 * @param {object} opts
 * @param {(messages:Array<{role:string,content:string}>, opts:object)=>Promise<{content:string}|string>} opts.chat
 *   Injected chat-completion function. Real callers pass the OpenAI
 *   chat-completion fn; tests inject a fake returning a canned reply.
 * @param {string} [opts.model] Defaults to `process.env.NETJARVIS_BRAIN_MODEL || "gpt-5.5"`.
 * @param {string[]} [opts.legitVerbs] Allowed read-only command roots. Defaults to ["show","sh"].
 */
function createCommandFormer({ chat, model, legitVerbs } = {}) {
  const resolvedModel = model || process.env.NETJARVIS_BRAIN_MODEL || DEFAULT_MODEL;
  const verbs =
    Array.isArray(legitVerbs) && legitVerbs.length ? legitVerbs : DEFAULT_LEGIT_VERBS;

  async function formCommand(question, device) {
    if (typeof chat !== "function") {
      return { ok: false, error: "command-former: no chat function was injected." };
    }

    const platform = (device && device.platform) || "ios-xe";
    const messages = [
      { role: "system", content: systemPrompt() },
      { role: "user", content: userPrompt(question, device) },
    ];

    let reply;
    try {
      reply = await chat(messages, { model: resolvedModel });
    } catch (err) {
      return { ok: false, error: `command-former: chat call failed: ${err && err.message ? err.message : err}` };
    }

    const content = reply && typeof reply === "object" ? reply.content : reply;
    const candidates = parseCommands(content);
    if (!candidates) {
      return { ok: false, error: "command-former: brain reply was not a parseable JSON array of commands." };
    }

    const commands = candidates.filter((c) => isValidCommand(c, platform, verbs));
    if (commands.length === 0) {
      return { ok: false, error: "command-former: no valid read-only show command could be formed from the brain's reply." };
    }

    return { ok: true, commands };
  }

  return { formCommand };
}

module.exports = { createCommandFormer };
