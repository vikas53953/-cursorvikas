const test = require("node:test");
const assert = require("node:assert/strict");
const { createQueryLayer } = require("../electron/core/query-layer.cjs");

function fixtureRegistry(devices) {
  const executor = { supports: () => true, runReadOnly: async (d, cmds) => ({ host: d.name, ok: true, outputs: { [cmds[0]]: `${d.name}:${cmds[0]}` } }) };
  return { allDevices: async () => devices, executorFor: () => executor };
}
const DEV = [
  { id: "1", name: "sw1", mgmtIp: "10.0.0.1", role: "access", site: "dc3", executor: "x" },
  { id: "2", name: "sw2", mgmtIp: "10.0.0.2", role: "access", site: "dc3", executor: "x" },
];

test("runs a read-only command against the resolved scope", async () => {
  const ql = createQueryLayer({ registry: fixtureRegistry(DEV) });
  const r = await ql.run("show version on sw1", ["show version"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.results.map((x) => x.host), ["sw1"]);
});

test("refuses when nothing resolves", async () => {
  const ql = createQueryLayer({ registry: fixtureRegistry(DEV) });
  const r = await ql.run("show version on nonexistent-device", ["show version"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /narrow|no devices|scope/i);
});

test("refuses above the hard cap", async () => {
  const many = Array.from({ length: 600 }, (_, i) => ({ id: String(i), name: `sw${i}`, role: "access", site: "dc3", executor: "x" }));
  const ql = createQueryLayer({ registry: fixtureRegistry(many), config: { hardCap: 500 } });
  const r = await ql.run("show version on the access switches in dc3", ["show version"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /500|too many|narrow/i);
});
