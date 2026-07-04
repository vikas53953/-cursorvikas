const test = require("node:test");
const assert = require("node:assert/strict");
const { extractDevicesFromText } = require("../electron/device-facts.cjs");

const INVENTORY = [
  { id: "1", name: "sw1", mgmtIp: "10.10.20.51", role: "access", site: "dc3" },
  { id: "2", name: "CORE-R1", mgmtIp: "10.10.20.1", role: "core", site: "dc1" },
];

test("resolves a real device name via the inventory (scope resolver)", () => {
  const names = extractDevicesFromText("how is CORE-R1 doing", INVENTORY);
  assert.deepEqual(names, ["CORE-R1"]);
});

test("resolves a role + site phrase against the inventory", () => {
  const names = extractDevicesFromText("show version on the access switch in dc3", INVENTORY);
  assert.deepEqual(names, ["sw1"]);
});

test("falls back to the regex when no inventory is supplied", () => {
  assert.deepEqual(extractDevicesFromText("what is the ip of sw3"), ["sw3"]);
  assert.deepEqual(extractDevicesFromText("uptime on switch 2"), ["sw2"]);
});

test("falls back to the regex when the inventory is empty", () => {
  assert.deepEqual(extractDevicesFromText("what is the ip of sw3", []), ["sw3"]);
});
