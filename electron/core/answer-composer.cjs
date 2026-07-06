// Answer composer: the STRONG brain re-words REAL device command output into
// a short spoken/written sentence for the engineer. It never invents a fact -
// it only summarizes what queryLayer already ran and returned. This is a
// second brain call per output question (Task E4): after the command-former
// (E1) forms the command and queryLayer (E3 wiring) runs it, this module asks
// the brain to state ONLY what is in that output.
//
// Latency note (logged deviation, per plan): this adds a 2nd brain round trip
// (~1-2s) on top of the command-former's round trip for every "output"
// question. The plan's two-beat voice hedge and the fact fast-lane (skips
// both brain calls entirely for simple facts) are the mitigations; no further
// optimization was attempted here.

const DEFAULT_MODEL = "gpt-5.4";

function systemPrompt() {
  return [
    "You are a network engineer's assistant summarizing REAL Cisco device command output.",
    "Summarize this real device command output to answer the engineer's question in 1-2 sentences.",
    "State ONLY facts present in the output; invent no number, interface, or status not shown.",
    "If the output doesn't answer it, say so plainly.",
  ].join(" ");
}

function userPrompt(question, device, output) {
  const deviceName = (device && device.name) || String(device || "");
  const outputText = typeof output === "string" ? output : JSON.stringify(output);
  return `QUESTION: ${String(question || "")}\nDEVICE: ${deviceName}\nCOMMAND OUTPUT:\n${outputText}\n\nRespond with the 1-2 sentence answer now.`;
}

/**
 * @param {object} opts
 * @param {(messages:Array<{role:string,content:string}>, opts:object)=>Promise<{content:string}|string>} opts.chat
 *   Injected chat-completion function. Real callers pass electron/agents.cjs
 *   `chatCompletion`; tests inject a fake returning a canned reply.
 * @param {string} [opts.model] Defaults to `process.env.NETJARVIS_BRAIN_MODEL || "gpt-5.5"`.
 */
function createAnswerComposer({ chat, model } = {}) {
  const resolvedModel = model || process.env.NETJARVIS_BRAIN_MODEL || DEFAULT_MODEL;

  async function compose(question, device, output) {
    if (typeof chat !== "function") {
      return { sentence: null, error: "answer-composer: no chat function was injected." };
    }

    const messages = [
      { role: "system", content: systemPrompt() },
      { role: "user", content: userPrompt(question, device, output) },
    ];

    let reply;
    try {
      reply = await chat(messages, { model: resolvedModel });
    } catch (err) {
      return { sentence: null, error: `answer-composer: chat call failed: ${err && err.message ? err.message : err}` };
    }

    const content = reply && typeof reply === "object" ? reply.content : reply;
    const sentence = typeof content === "string" ? content.trim() : null;
    if (!sentence) {
      return { sentence: null, error: "answer-composer: brain returned no content." };
    }

    return { sentence };
  }

  return { compose };
}

module.exports = { createAnswerComposer };
