// Grounding capability: resolves the user's verbatim target phrase against
// the live inventory, then answers either with a single composed fact or by
// running a read-only command through the query layer. Never states a fact
// the engine did not produce (R1/R2). Honest "not found" (R3). Read-back best
// guess on ambiguity (R4). Deterministic anaphora via session.lastDevice (R5).
const { resolveScope } = require("./scope-resolver.cjs");
const { composeFact } = require("./fact-compose.cjs");

const PRONOUNS = new Set(["it", "its", "that", "this"]);

// A phrase counts as pronoun-led when its leading word is a bare pronoun
// ("it", "its", "that", "this") — covers both an exact pronoun ("it") and a
// pronoun-led follow-up ("its uptime").
function isBarePronoun(phrase) {
  const trimmed = String(phrase || "").trim().toLowerCase();
  const first = trimmed.split(/\s+/)[0];
  return PRONOUNS.has(first);
}

function createGrounding({ registry, queryLayer, getDeviceFacts, session }) {
  const state = session || {};

  async function ask({ targetPhrase, question, commands } = {}) {
    let phrase = targetPhrase;
    if (!String(phrase || "").trim() || isBarePronoun(phrase)) {
      if (!state.lastDevice) {
        return { status: "need_target", message: "Which device?" };
      }
      phrase = state.lastDevice;
    }

    const devices = await registry.allDevices();
    const resolved = resolveScope(phrase, devices, { cap: 5 });

    if (resolved.total === 0) {
      const nearest = devices.slice(0, 3).map((d) => d.name);
      return { status: "not_found", phrase: targetPhrase, nearest };
    }

    const device = resolved.devices[0];
    const others = resolved.devices.slice(1).map((d) => d.name);
    state.lastDevice = device.name;

    // CLI/output path runs first: when the caller has already supplied
    // read-only show commands, that is an explicit signal this is a
    // command-shaped question, and it must never be silently dropped in
    // favor of a single-fact guess. Single-fact composition is only
    // attempted when NO commands were supplied.
    if (Array.isArray(commands) && commands.length > 0) {
      // Anaphora fix: run against the resolved device (device.name), not the
      // original targetPhrase — targetPhrase may be a pronoun ("its") that
      // resolves to nothing on its own; the engine already grounded it to
      // `device` above.
      const runResult = await queryLayer.run(device.name, commands);
      return {
        status: "answered",
        device: device.name,
        answerKind: "output",
        output: runResult,
        others,
        note: "Summarize only what is in output; state no number not present here.",
      };
    }

    // getDeviceFacts is expected to hit the real inventory/health APIs (G3),
    // so it is normally async; `await` on a plain object (as used by G2's
    // synchronous test doubles) is a no-op and resolves to the same value.
    const enriched = (getDeviceFacts && (await getDeviceFacts(device.name))) || device;
    const fact = composeFact(question, enriched);
    if (fact.matched) {
      return {
        status: "answered",
        device: device.name,
        answerKind: "fact",
        attribute: fact.attribute,
        sentence: fact.sentence,
        others,
      };
    }

    return {
      status: "need_command",
      device: device.name,
      message: "Provide a read-only show command for this question.",
    };
  }

  return { ask };
}

module.exports = { createGrounding };
