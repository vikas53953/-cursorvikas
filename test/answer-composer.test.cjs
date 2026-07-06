const test = require("node:test");
const assert = require("node:assert/strict");
const { createAnswerComposer } = require("../electron/core/answer-composer.cjs");

const DEVICE = { name: "sw1", platform: "ios-xe" };

test("compose returns the brain's summary sentence built from the real output", async () => {
  let seenMessages = null;
  const chat = async (messages) => {
    seenMessages = messages;
    return { role: "assistant", content: "sw1 has 3 VLANs configured: 1, 10, and 20." };
  };
  const composer = createAnswerComposer({ chat });

  const result = await composer.compose("vlans on sw1", DEVICE, "<vlan output>");

  assert.equal(result.sentence, "sw1 has 3 VLANs configured: 1, 10, and 20.");
  assert.ok(Array.isArray(seenMessages));
});

test("the prompt sent to the brain includes the raw output and the no-invented-facts instruction", async () => {
  let seenMessages = null;
  const chat = async (messages) => {
    seenMessages = messages;
    return { content: "summary" };
  };
  const composer = createAnswerComposer({ chat });

  await composer.compose("vlans on sw1", DEVICE, "<vlan output>");

  const combined = seenMessages.map((m) => m.content).join("\n");
  assert.match(combined, /<vlan output>/);
  assert.match(combined, /invent no number/i);
});

test("passes the injected model to chat, defaulting to the brain model", async () => {
  let seenOpts = null;
  const chat = async (_messages, opts) => {
    seenOpts = opts;
    return { content: "ok" };
  };
  const composer = createAnswerComposer({ chat, model: "gpt-5.4" });

  await composer.compose("q", DEVICE, "output");

  assert.equal(seenOpts.model, "gpt-5.4");
});

test("a string reply (not a {content} object) is accepted as the sentence", async () => {
  const chat = async () => "plain string reply";
  const composer = createAnswerComposer({ chat });

  const result = await composer.compose("q", DEVICE, "output");

  assert.equal(result.sentence, "plain string reply");
});

test("gracefully returns no sentence when no chat function is injected", async () => {
  const composer = createAnswerComposer({});

  const result = await composer.compose("q", DEVICE, "output");

  assert.equal(result.sentence, null);
  assert.ok(result.error);
});

test("gracefully returns no sentence when the chat call throws", async () => {
  const chat = async () => {
    throw new Error("network down");
  };
  const composer = createAnswerComposer({ chat });

  const result = await composer.compose("q", DEVICE, "output");

  assert.equal(result.sentence, null);
  assert.ok(result.error);
});

test("uses NETJARVIS_BRAIN_MODEL env default when no model is passed", async () => {
  const prevModel = process.env.NETJARVIS_BRAIN_MODEL;
  delete process.env.NETJARVIS_BRAIN_MODEL;
  let seenOpts = null;
  const chat = async (_messages, opts) => {
    seenOpts = opts;
    return { content: "ok" };
  };
  const composer = createAnswerComposer({ chat });

  await composer.compose("q", DEVICE, "output");

  assert.equal(seenOpts.model, "gpt-5.5");
  if (prevModel === undefined) delete process.env.NETJARVIS_BRAIN_MODEL;
  else process.env.NETJARVIS_BRAIN_MODEL = prevModel;
});

test("an object output (real queryLayer.run shape) is stringified into the prompt, not [object Object]", async () => {
  let seenMessages = null;
  const chat = async (messages) => {
    seenMessages = messages;
    return { content: "summary" };
  };
  const composer = createAnswerComposer({ chat });
  const rawRunResult = {
    ok: true,
    devices: [{ name: "sw1" }],
    results: [{ host: "sw1", ok: true, outputs: { "show vlan brief": "VLAN0001 default active" } }],
  };

  await composer.compose("vlans on sw1", DEVICE, rawRunResult);

  const combined = seenMessages.map((m) => m.content).join("\n");
  assert.match(combined, /VLAN0001 default active/);
});
