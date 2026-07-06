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

test("non-fact question with no commands and NO commandFormer wired falls back to need_command", async () => {
  // Back-compat / misconfiguration guard only: real callers (electron/tools.cjs)
  // always wire a commandFormer now (Task E3). This covers a caller that omits
  // it entirely, so the engine still fails honestly instead of doing nothing.
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

// --- Task E3: the engine forms the command itself via an injected
// commandFormer instead of asking the caller (voice/chat model) to supply
// one. "mac address table on sw1" does not match composeFact (no single
// inventory attribute), so it must now flow through commandFormer.formCommand
// -> queryLayer.run, landing on answerKind:'output' -- NOT need_command --
// with the caller having passed no commands of its own.

function makeCommandFormer(result) {
  return { formCommand: async () => result };
}

test("non-fact question with a commandFormer wired: engine forms the command and runs it (not need_command)", async () => {
  let calledWith = null;
  const queryLayer = makeQueryLayer(async (phrase, commands) => {
    calledWith = { phrase, commands };
    return { ok: true, devices: [{ name: "sw1" }], results: [{ host: "sw1", ok: true, outputs: { "show mac address-table": "Vlan 1  aabb.ccdd.eeff  DYNAMIC  Gi1/0/1" } }] };
  });
  const commandFormer = makeCommandFormer({ ok: true, commands: ["show mac address-table"] });
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer,
    getDeviceFacts: () => null,
    session: {},
    commandFormer,
  });

  const result = await grounding.ask({ targetPhrase: "sw1", question: "mac address table on sw1" });

  assert.notEqual(result.status, "need_command");
  assert.equal(result.status, "answered");
  assert.equal(result.answerKind, "output");
  assert.equal(result.device, "sw1");
  assert.deepEqual(result.commands, ["show mac address-table"]);
  assert.ok(result.output);
  assert.ok(calledWith);
  assert.equal(calledWith.phrase, "sw1");
  assert.deepEqual(calledWith.commands, ["show mac address-table"]);
});

// --- Task E4: the engine calls the injected answerComposer to re-word the
// REAL output the engine-formed command produced into a short sentence. The
// composer is optional (like commandFormer above) so callers/tests that omit
// it keep getting the old shape (no `sentence`) -- the test above,
// "non-fact question with a commandFormer wired...", proves that back-compat
// path still passes with no answerComposer wired at all.

function makeAnswerComposer(result) {
  return { compose: async () => result };
}

test("engine-formed output path: answerComposer's sentence is attached and rawOutput is retained", async () => {
  const queryLayer = makeQueryLayer(async () => ({
    ok: true,
    devices: [{ name: "sw1" }],
    results: [{ host: "sw1", ok: true, outputs: { "show mac address-table": "Vlan 1  aabb.ccdd.eeff  DYNAMIC  Gi1/0/1" } }],
  }));
  const commandFormer = makeCommandFormer({ ok: true, commands: ["show mac address-table"] });
  let composeCalledWith = null;
  const answerComposer = {
    compose: async (question, device, output) => {
      composeCalledWith = { question, device, output };
      return { sentence: "sw1's MAC address table shows one dynamic entry on Gi1/0/1." };
    },
  };
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer,
    getDeviceFacts: () => null,
    session: {},
    commandFormer,
    answerComposer,
  });

  const result = await grounding.ask({ targetPhrase: "sw1", question: "mac address table on sw1" });

  assert.equal(result.status, "answered");
  assert.equal(result.answerKind, "output");
  assert.equal(result.sentence, "sw1's MAC address table shows one dynamic entry on Gi1/0/1.");
  assert.ok(result.rawOutput);
  assert.deepEqual(result.rawOutput, result.output);
  assert.ok(composeCalledWith);
  assert.equal(composeCalledWith.question, "mac address table on sw1");
  assert.equal(composeCalledWith.device.name, "sw1");
});

test("engine-formed output path: a failing answerComposer degrades gracefully (no sentence, no crash)", async () => {
  const queryLayer = makeQueryLayer(async () => ({
    ok: true,
    devices: [{ name: "sw1" }],
    results: [{ host: "sw1", ok: true, outputs: { "show mac address-table": "Vlan 1  aabb.ccdd.eeff  DYNAMIC  Gi1/0/1" } }],
  }));
  const commandFormer = makeCommandFormer({ ok: true, commands: ["show mac address-table"] });
  const answerComposer = {
    compose: async () => {
      throw new Error("brain call failed");
    },
  };
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer,
    getDeviceFacts: () => null,
    session: {},
    commandFormer,
    answerComposer,
  });

  const result = await grounding.ask({ targetPhrase: "sw1", question: "mac address table on sw1" });

  assert.equal(result.status, "answered");
  assert.equal(result.answerKind, "output");
  assert.equal(result.sentence, undefined);
  assert.ok(result.rawOutput);
});

test("commandFormer unable to form a safe command returns status cannot_form", async () => {
  const commandFormer = makeCommandFormer({ ok: false, error: "no valid read-only show command" });
  const grounding = createGrounding({
    registry: makeRegistry(),
    queryLayer: makeQueryLayer(),
    getDeviceFacts: () => null,
    session: {},
    commandFormer,
  });

  const result = await grounding.ask({ targetPhrase: "sw1", question: "reboot sw1" });

  assert.equal(result.status, "cannot_form");
  assert.equal(result.device, "sw1");
  assert.ok(result.message);
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
