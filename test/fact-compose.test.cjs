const test = require("node:test");
const assert = require("node:assert/strict");
const { composeFact } = require("../electron/core/fact-compose.cjs");

test("version question resolves to softwareVersion (+ software) sentence", () => {
  const device = { name: "sw1", software: "IOS-XE", softwareVersion: "17.12.1" };
  const result = composeFact("what version is sw1 running", device);
  assert.equal(result.matched, true);
  assert.equal(result.attribute, "version");
  assert.match(result.sentence, /17\.12\.1/);
});

test("ip question resolves to mgmtIp sentence", () => {
  const device = { name: "sw1", mgmtIp: "10.10.20.175" };
  const result = composeFact("what's the ip of sw1", device);
  assert.equal(result.matched, true);
  assert.equal(result.attribute, "ip");
  assert.match(result.sentence, /10\.10\.20\.175/);
});

test("uptime question resolves to uptime sentence", () => {
  const device = { name: "sw1", uptime: "162 days" };
  const result = composeFact("uptime on sw1", device);
  assert.equal(result.matched, true);
  assert.equal(result.attribute, "uptime");
  assert.match(result.sentence, /162 days/);
});

test("no recognized attribute falls through to matched:false", () => {
  const device = { name: "sw1", softwareVersion: "17.12.1" };
  const result = composeFact("what's on sw1", device);
  assert.deepEqual(result, { matched: false });
});

test("recognized attribute but missing field on device falls through (never guess)", () => {
  const device = { name: "sw1" };
  const result = composeFact("serial of sw1", device);
  assert.deepEqual(result, { matched: false });
});

test("model question resolves to platform sentence", () => {
  const device = { name: "sw1", platform: "C9300" };
  const result = composeFact("what model is sw1", device);
  assert.equal(result.matched, true);
  assert.equal(result.attribute, "model");
  assert.match(result.sentence, /C9300/);
});

test("reachability question resolves to reachability sentence", () => {
  const device = { name: "sw1", reachability: "reachable" };
  const result = composeFact("is sw1 reachable", device);
  assert.equal(result.matched, true);
  assert.equal(result.attribute, "reachability");
  assert.match(result.sentence, /reachable/);
});

test("empty-string field value is treated as missing (never guess)", () => {
  const device = { name: "sw1", serialNumber: "" };
  const result = composeFact("serial number of sw1", device);
  assert.deepEqual(result, { matched: false });
});

// --- SME review regression: CLI/table questions must never be hijacked
// into a single-attribute fact, even though they contain a word that used
// to be an ambiguous synonym (address/status/running/code).

test("mac address table question falls through to CLI path (not IP fact)", () => {
  const device = { name: "sw1", mgmtIp: "10.10.20.175" };
  const result = composeFact("what's the mac address table on sw1", device);
  assert.deepEqual(result, { matched: false });
});

test("show ip route question falls through to CLI path (not IP fact)", () => {
  const device = { name: "sw1", mgmtIp: "10.10.20.175" };
  const result = composeFact("show ip route on sw1", device);
  assert.deepEqual(result, { matched: false });
});

test("interface status question falls through to CLI path (not reachability fact)", () => {
  const device = { name: "sw1", reachability: "reachable" };
  const result = composeFact("interface status on sw1", device);
  assert.deepEqual(result, { matched: false });
});

test("is sw1 running ospf falls through to CLI path (not version fact)", () => {
  const device = { name: "sw1", softwareVersion: "17.12.1" };
  const result = composeFact("is sw1 running ospf", device);
  assert.deepEqual(result, { matched: false });
});

test("what version is sw1 running still resolves to version fact (no CLI/table signal)", () => {
  const device = { name: "sw1", softwareVersion: "17.12.1" };
  const result = composeFact("what version is sw1 running", device);
  assert.equal(result.matched, true);
  assert.equal(result.attribute, "version");
});

test("ip of sw1 still resolves to ip fact (no CLI/table signal)", () => {
  const device = { name: "sw1", mgmtIp: "10.10.20.175" };
  const result = composeFact("ip of sw1", device);
  assert.equal(result.matched, true);
  assert.equal(result.attribute, "ip");
});
