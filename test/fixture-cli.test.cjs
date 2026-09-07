const test = require("node:test");
const assert = require("node:assert/strict");
const { renderCommand, runFixtureShow, matchFixtureDevices } = require("../electron/sources/fixture-cli.cjs");

const sw1 = { name: "sw1", ip: "10.10.20.175", role: "access", platform: "ios-xe" };

test("fixture CLI is labelled and never claims live", () => {
  const out = renderCommand(sw1, "show version");
  assert.match(out, /FIXTURE/);
  assert.doesNotMatch(out, /Catalyst Center Intent/i);
});

test("unknown show command stays honest", () => {
  const out = renderCommand(sw1, "show bgp summary");
  assert.match(out, /no mock output/i);
});

test("runFixtureShow scopes a named device", () => {
  const result = runFixtureShow([sw1], ["show vlan brief"]);
  assert.equal(result.ok, true);
  assert.equal(result.fixture, true);
  assert.ok(result.outputs.sw1["show vlan brief"]);
});

test("matchFixtureDevices finds hyphenated mock-lab names", () => {
  const vpn = { name: "vpn-asa-1", ip: "10.0.0.11" };
  assert.equal(matchFixtureDevices([vpn], "vpn-asa-1")[0].name, "vpn-asa-1");
});
