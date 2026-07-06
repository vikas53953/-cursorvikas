const test = require("node:test");
const assert = require("node:assert/strict");
const { createCommandFormer } = require("../electron/core/command-former.cjs");

const DEVICE = { name: "sw1", platform: "ios-xe" };

function fakeChat(content) {
  return async () => ({ role: "assistant", content });
}

test("clean JSON show command from the brain is accepted", async () => {
  const former = createCommandFormer({ chat: fakeChat('["show mac address-table"]') });
  const result = await former.formCommand("what's the mac address table", DEVICE);

  assert.equal(result.ok, true);
  assert.deepEqual(result.commands, ["show mac address-table"]);
});

test("natural-language 'command' with filler words is rejected", async () => {
  const former = createCommandFormer({
    chat: fakeChat('["show me the mac address table on sw1"]'),
  });
  const result = await former.formCommand("what's the mac address table", DEVICE);

  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test("a non-show (mutating) command is rejected", async () => {
  const former = createCommandFormer({ chat: fakeChat('["configure terminal"]') });
  const result = await former.formCommand("turn off the interface", DEVICE);

  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test("keeps only the valid show command when the brain mixes in a mutating one", async () => {
  const former = createCommandFormer({
    chat: fakeChat('["show vlan brief","clear counters"]'),
  });
  const result = await former.formCommand("vlans on sw1", DEVICE);

  assert.equal(result.ok, true);
  assert.deepEqual(result.commands, ["show vlan brief"]);
});

test("malformed non-JSON reply does not throw and yields ok:false", async () => {
  const former = createCommandFormer({
    chat: fakeChat("Sure, you should run: show vlan brief"),
  });
  const result = await former.formCommand("vlans on sw1", DEVICE);

  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test("reply wrapped in a markdown code fence still parses", async () => {
  const former = createCommandFormer({
    chat: fakeChat('```json\n["show ip route"]\n```'),
  });
  const result = await former.formCommand("ip route on sw1", DEVICE);

  assert.equal(result.ok, true);
  assert.deepEqual(result.commands, ["show ip route"]);
});

test("uses NETJARVIS_BRAIN_MODEL env default and passes model + platform to chat", async () => {
  const prevModel = process.env.NETJARVIS_BRAIN_MODEL;
  delete process.env.NETJARVIS_BRAIN_MODEL;
  let capturedMessages;
  let capturedOpts;
  const former = createCommandFormer({
    chat: async (messages, opts) => {
      capturedMessages = messages;
      capturedOpts = opts;
      return { role: "assistant", content: '["show version"]' };
    },
  });

  const result = await former.formCommand("version on sw1", DEVICE);

  assert.equal(result.ok, true);
  assert.equal(capturedOpts.model, "gpt-5.5");
  const joined = capturedMessages.map((m) => m.content).join(" ");
  assert.match(joined, /ios-xe/);
  if (prevModel === undefined) delete process.env.NETJARVIS_BRAIN_MODEL;
  else process.env.NETJARVIS_BRAIN_MODEL = prevModel;
});

test("respects an explicit model override", async () => {
  let capturedOpts;
  const former = createCommandFormer({
    model: "gpt-5.4",
    chat: async (messages, opts) => {
      capturedOpts = opts;
      return { role: "assistant", content: '["show version"]' };
    },
  });
  await former.formCommand("version on sw1", DEVICE);
  assert.equal(capturedOpts.model, "gpt-5.4");
});

test("no chat fn injected yields ok:false without throwing", async () => {
  const former = createCommandFormer({});
  const result = await former.formCommand("version on sw1", DEVICE);
  assert.equal(result.ok, false);
});

test("blocks a syntactically show-shaped but read-only-policy-blocked command", async () => {
  const former = createCommandFormer({
    chat: fakeChat('["show run | tee flash:x"]'),
  });
  const result = await former.formCommand("dump running config to flash", DEVICE);
  assert.equal(result.ok, false);
});
