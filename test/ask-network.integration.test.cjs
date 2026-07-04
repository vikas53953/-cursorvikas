// Integration test for Task G3: ask_network wired as a tool in createTools.
//
// catc is a module-level singleton required by both electron/tools.cjs and
// this test (same require cache/path), so we monkeypatch its exported
// functions directly -- the same pattern used by test/network-source.test.cjs
// -- instead of injecting a fake object (createTools has no seam for that).
const test = require("node:test");
const assert = require("node:assert/strict");

const catc = require("../electron/sources/catalyst-center.cjs");
const db = require("../electron/db.cjs");
const { createTools } = require("../electron/tools.cjs");

const INVENTORY = [
  {
    id: "u1",
    hostname: "sw1",
    managementIp: "10.10.20.51",
    role: "ACCESS",
    family: "Switches and Hubs",
    platform: "C9300-24T",
    series: "Cisco Catalyst 9300 Switch",
    softwareType: "IOS-XE",
    softwareVersion: "17.12.1",
    serialNumber: "FCW1234A0BC",
    reachability: "Reachable",
    uptime: "10 days, 2:15:00",
  },
];

const HEALTH = [
  { name: "sw1", ipAddress: "10.10.20.51", overallHealth: 10, cpuUtilization: 12, memoryUtilization: 40, reachabilityHealth: "REACHABLE" },
];

function stubCatc() {
  catc.getInventory = async () => INVENTORY;
  catc.getInventoryCached = async () => INVENTORY;
  catc.getDeviceHealth = async () => HEALTH;
  catc.checkReachable = async () => true;
  catc.runCommands = async () => ({});
}

test("ask_network: fact question ('version on sw1') answers from live inventory + health", async () => {
  stubCatc();
  const tools = createTools({ readDb: db.readDb, updateDb: db.updateDb });

  const result = await tools.execute("ask_network", {
    target_phrase: "sw1",
    question: "what version is sw1 running",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "answered");
  assert.equal(result.answerKind, "fact");
  assert.equal(result.device, "sw1");
  assert.match(result.sentence, /17\.12\.1/);
  assert.ok(result.artifact);
  assert.equal(result.artifact.kind, "markdown");
  assert.match(result.artifact.content, /17\.12\.1/);
});

test("ask_network: unknown device ('switch 99') returns not_found with nearest real names", async () => {
  stubCatc();
  const tools = createTools({ readDb: db.readDb, updateDb: db.updateDb });

  const result = await tools.execute("ask_network", {
    target_phrase: "switch 99",
    question: "what is the ip of switch 99",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "not_found");
  assert.equal(result.phrase, "switch 99");
  assert.ok(Array.isArray(result.nearest));
  assert.ok(result.nearest.includes("sw1"));
  // Must never fabricate/run anything on a device that does not exist.
  assert.equal(result.answerKind, undefined);
});

test("ask_network is present in the tool spec list", async () => {
  stubCatc();
  const tools = createTools({ readDb: db.readDb, updateDb: db.updateDb });
  const spec = tools.toolSpecs.find((s) => s.name === "ask_network");
  assert.ok(spec, "ask_network tool spec should be registered");
  assert.ok(spec.parameters.properties.target_phrase);
  assert.ok(spec.parameters.properties.question);
  assert.ok(spec.parameters.properties.commands);
});

test("ask_network: non-fact question with a supplied read-only command runs and returns output", async () => {
  stubCatc();
  catc.runCommands = async (uuids, commands) => ({ sw1: { [commands[0]]: "VLAN0001 default active" } });
  const tools = createTools({ readDb: db.readDb, updateDb: db.updateDb });

  const result = await tools.execute("ask_network", {
    target_phrase: "sw1",
    question: "show me the vlans on sw1",
    commands: ["show vlan brief"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "answered");
  assert.equal(result.answerKind, "output");
  assert.equal(result.device, "sw1");
  assert.ok(result.artifact);
});
