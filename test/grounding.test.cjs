const test = require("node:test");
const assert = require("node:assert/strict");
const { createGrounding } = require("../electron/core/grounding.cjs");

const FIXTURE = [
  { name: "sw1", mgmtIp: "10.10.20.175", role: "access", executor: "x" },
  { name: "sw2", mgmtIp: "10.10.20.176", role: "access", executor: "x" },
];

function makeRegistry(devices = FIXTURE) {
  return { allDevices: async () => devices };
}

function makeQueryLayer(runImpl) {
  return { run: runImpl || (async () => ({ ok: true, devices: [], results: [] })) };
}

test("fact question answers from getDeviceFacts and sets session.lastDevice", async () => {
  const session = { lastDevice: null };
  const getDeviceFacts = (name) =>
    name === "sw1" ? { name: "sw1", softwareVersion: "17.12.1", software: "IOS-XE" } : null;
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer: makeQueryLayer(),
    getDeviceFacts,
    session,
  });

  const result = await grounding.ask({ targetPhrase: "sw1", question: "version on sw1" });

  assert.equal(result.status, "answered");
  assert.equal(result.answerKind, "fact");
  assert.equal(result.device, "sw1");
  assert.match(result.sentence, /17\.12\.1/);
  assert.equal(session.lastDevice, "sw1");
});

test("nonexistent device returns not_found with nearest real names", async () => {
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer: makeQueryLayer(),
    getDeviceFacts: () => null,
    session: {},
  });

  const result = await grounding.ask({ targetPhrase: "switch 99", question: "what's the ip of switch 99" });

  assert.equal(result.status, "not_found");
  assert.equal(result.phrase, "switch 99");
  assert.ok(Array.isArray(result.nearest));
  assert.ok(result.nearest.length <= 3);
  const names = FIXTURE.map((d) => d.name);
  for (const n of result.nearest) assert.ok(names.includes(n));
});

test("pronoun follow-up uses session.lastDevice", async () => {
  const session = { lastDevice: null };
  const getDeviceFacts = (name) => {
    if (name === "sw1") return { name: "sw1", softwareVersion: "17.12.1", software: "IOS-XE" };
    return null;
  };
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer: makeQueryLayer(),
    getDeviceFacts,
    session,
  });

  // First call resolves and sets lastDevice.
  await grounding.ask({ targetPhrase: "sw1", question: "version on sw1" });
  assert.equal(session.lastDevice, "sw1");

  // Follow-up: getDeviceFacts now also supports uptime lookup for sw1.
  const getDeviceFactsUptime = (name) =>
    name === "sw1" ? { name: "sw1", uptime: "162 days" } : null;
  const grounding2 = createGrounding({
    registry: makeRegistry(),
    queryLayer: makeQueryLayer(),
    getDeviceFacts: getDeviceFactsUptime,
    session,
  });

  const result = await grounding2.ask({ targetPhrase: "its uptime", question: "its uptime" });
  assert.equal(result.status, "answered");
  assert.equal(result.device, "sw1");
  assert.match(result.sentence, /162 days/);
});

test("non-fact question with commands runs queryLayer and returns output", async () => {
  let calledWith = null;
  const queryLayer = makeQueryLayer(async (phrase, commands) => {
    calledWith = { phrase, commands };
    return { ok: true, devices: [{ name: "sw1" }], results: [{ host: "sw1", ok: true, outputs: { "show vlan brief": "VLAN 1 default" } }] };
  });
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer,
    getDeviceFacts: () => null,
    session: {},
  });

  const result = await grounding.ask({
    targetPhrase: "sw1",
    question: "show vlans on sw1",
    commands: ["show vlan brief"],
  });

  assert.equal(result.status, "answered");
  assert.equal(result.answerKind, "output");
  assert.equal(result.device, "sw1");
  assert.ok(result.output);
  assert.ok(calledWith);
  assert.equal(calledWith.phrase, "sw1");
  assert.deepEqual(calledWith.commands, ["show vlan brief"]);
});

test("non-fact question with no commands returns need_command", async () => {
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer: makeQueryLayer(),
    getDeviceFacts: () => null,
    session: {},
  });

  const result = await grounding.ask({ targetPhrase: "sw1", question: "show vlans on sw1" });

  assert.equal(result.status, "need_command");
  assert.equal(result.device, "sw1");
});

test("empty target with no lastDevice returns need_target", async () => {
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer: makeQueryLayer(),
    getDeviceFacts: () => null,
    session: {},
  });

  const result = await grounding.ask({ targetPhrase: "", question: "what version is it running" });

  assert.equal(result.status, "need_target");
});

test("bare pronoun target with no lastDevice returns need_target", async () => {
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer: makeQueryLayer(),
    getDeviceFacts: () => null,
    session: {},
  });

  const result = await grounding.ask({ targetPhrase: "it", question: "what version is it running" });

  assert.equal(result.status, "need_target");
});

test("defaults session to {} when not passed", async () => {
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer: makeQueryLayer(),
    getDeviceFacts: () => null,
  });

  const result = await grounding.ask({ targetPhrase: "", question: "version" });
  assert.equal(result.status, "need_target");
});

// --- SME review regression: commands must win over single-fact composition,
// and the CLI/output path must run against the resolved device, not a raw
// (possibly pronoun) targetPhrase.

test("commands are not dropped for a question that also looks like a fact (CLI path wins)", async () => {
  let calledWith = null;
  const queryLayer = makeQueryLayer(async (phrase, commands) => {
    calledWith = { phrase, commands };
    return { ok: true, devices: [{ name: "sw1" }], results: [{ host: "sw1", ok: true, outputs: { "show ip route": "0.0.0.0/0 via 10.10.20.1" } }] };
  });
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer,
    getDeviceFacts: (name) => (name === "sw1" ? { name: "sw1", mgmtIp: "10.10.20.175" } : null),
    session: {},
  });

  const result = await grounding.ask({
    targetPhrase: "sw1",
    question: "show ip route on sw1",
    commands: ["show ip route"],
  });

  assert.equal(result.status, "answered");
  assert.equal(result.answerKind, "output");
  assert.ok(calledWith);
  assert.deepEqual(calledWith.commands, ["show ip route"]);
});

test("pronoun follow-up on the command path runs queryLayer against the resolved device, not the pronoun", async () => {
  const session = { lastDevice: null };
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer: makeQueryLayer(),
    getDeviceFacts: () => null,
    session,
  });

  // First call resolves sw1 and sets lastDevice.
  await grounding.ask({ targetPhrase: "sw1", question: "show vlans on sw1", commands: ["show vlan brief"] });
  assert.equal(session.lastDevice, "sw1");

  let calledWith = null;
  const queryLayer2 = makeQueryLayer(async (phrase, commands) => {
    calledWith = { phrase, commands };
    return { ok: true, devices: [{ name: "sw1" }], results: [] };
  });
  const grounding2 = createGrounding({
    registry: makeRegistry(),
    queryLayer: queryLayer2,
    getDeviceFacts: () => null,
    session,
  });

  const result = await grounding2.ask({ targetPhrase: "its", question: "its vlans", commands: ["show vlan brief"] });

  assert.equal(result.status, "answered");
  assert.equal(result.device, "sw1");
  assert.ok(calledWith);
  assert.equal(calledWith.phrase, "sw1");
  assert.notEqual(calledWith.phrase, "its");
});

test("ambiguous resolution reports others alongside the top device", async () => {
  const session = {};
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer: makeQueryLayer(),
    getDeviceFacts: (name) => (name === "sw1" ? { name: "sw1", softwareVersion: "1.0" } : null),
    session,
  });

  const result = await grounding.ask({ targetPhrase: "access switches", question: "version" });
  assert.equal(result.status, "answered");
  assert.equal(result.device, "sw1");
  assert.deepEqual(result.others, ["sw2"]);
});
