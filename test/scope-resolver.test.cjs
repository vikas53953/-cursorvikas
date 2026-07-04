const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveScope } = require("../electron/core/scope-resolver.cjs");

const FIXTURE = [
  { id: "1", name: "sw1", mgmtIp: "10.10.20.51", role: "access", site: "dc3" },
  { id: "2", name: "sw2", mgmtIp: "10.10.20.52", role: "access", site: "dc3" },
  { id: "3", name: "CORE-R1", mgmtIp: "10.10.20.1", role: "core", site: "dc1" },
  { id: "4", name: "DIST-SW1", mgmtIp: "10.10.20.10", role: "distribution", site: "dc1" },
];

test("resolves an exact device name", () => {
  const r = resolveScope("uptime on sw1", FIXTURE);
  assert.deepEqual(r.devices.map((d) => d.name), ["sw1"]);
});

test("resolves a real non-swN name", () => {
  const r = resolveScope("how is CORE-R1 doing", FIXTURE);
  assert.deepEqual(r.devices.map((d) => d.name), ["CORE-R1"]);
});

test("resolves by role + site", () => {
  const r = resolveScope("show version on the access switches in dc3", FIXTURE);
  assert.deepEqual(r.devices.map((d) => d.name).sort(), ["sw1", "sw2"]);
});

test("resolves by management IP", () => {
  const r = resolveScope("interfaces on 10.10.20.1", FIXTURE);
  assert.deepEqual(r.devices.map((d) => d.name), ["CORE-R1"]);
});

test("applies the cap and reports total", () => {
  const r = resolveScope("show version on the access switches in dc3", FIXTURE, { cap: 1 });
  assert.equal(r.total, 2);
  assert.equal(r.capped, true);
  assert.equal(r.devices.length, 1);
});

test("role+site query does not throw on a device with missing site", () => {
  const fixture = [
    ...FIXTURE,
    { id: "5", name: "sw3", mgmtIp: "10.10.20.53", role: "access", site: undefined },
  ];
  let r;
  assert.doesNotThrow(() => {
    r = resolveScope("show version on the access switches in dc3", fixture);
  });
  assert.deepEqual(r.devices.map((d) => d.name).sort(), ["sw1", "sw2"]);
});

test("does not false-match English words in the substring fallback", () => {
  const r = resolveScope("what is the network health", FIXTURE);
  assert.deepEqual(r.devices, []);
  assert.equal(r.total, 0);
});
