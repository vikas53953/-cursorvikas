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

test("never exceeds the configured concurrency cap", async () => {
  let active = 0;
  let maxActive = 0;
  const executor = {
    supports: () => true,
    runReadOnly: async (d) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { host: d.name, ok: true, outputs: {} };
    },
  };
  const registry = {
    allDevices: async () => Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `sw${i}`, role: "access", site: "dc3", executor: "x" })),
    executorFor: () => executor,
  };
  const ql = createQueryLayer({ registry, config: { concurrency: 3, interactiveCap: 100 } });
  const r = await ql.run("show version on the access switches in dc3", ["show version"]);
  assert.equal(r.ok, true);
  assert.equal(r.results.length, 30);
  assert.ok(maxActive <= 3, `maxActive was ${maxActive}, expected <= 3`);
});

test("preserves result order when the first-dispatched finishes last", async () => {
  const executor = {
    supports: () => true,
    runReadOnly: async (d) => {
      const delay = d.name === "sw1" ? 20 : 1; // first device finishes slower
      await new Promise((r) => setTimeout(r, delay));
      return { host: d.name, ok: true, outputs: {} };
    },
  };
  const registry = {
    allDevices: async () => DEV,
    executorFor: () => executor,
  };
  const ql = createQueryLayer({ registry, config: { concurrency: 10 } });
  const r = await ql.run("show version on the access switches in dc3", ["show version"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.results.map((x) => x.host), ["sw1", "sw2"]);
});

test("isolates a per-device executor failure without failing the whole run", async () => {
  const executor = {
    supports: () => true,
    runReadOnly: async (d) => {
      if (d.name === "sw1") throw new Error("boom on sw1");
      return { host: d.name, ok: true, outputs: {} };
    },
  };
  const registry = {
    allDevices: async () => DEV,
    executorFor: () => executor,
  };
  const ql = createQueryLayer({ registry, config: { concurrency: 10 } });
  const r = await ql.run("show version on the access switches in dc3", ["show version"]);
  assert.equal(r.ok, true);
  const bySw1 = r.results.find((x) => x.host === "sw1");
  const bySw2 = r.results.find((x) => x.host === "sw2");
  assert.equal(bySw1.ok, false);
  assert.match(bySw1.error, /boom on sw1/);
  assert.equal(bySw2.ok, true);
});
