const test = require("node:test");
const assert = require("node:assert/strict");
const { createRegistry } = require("../electron/core/source-registry.cjs");

const src = {
  id: "catc-sandbox", domain: "data",
  inventory: { search: async () => [{ id: "1", name: "sw1", executor: "catalyst-center" }], health: async () => ({ ok: true, reachable: true }) },
  executor: { supports: (d) => d.executor === "catalyst-center", runReadOnly: async () => ({ ok: true, host: "sw1", outputs: {} }) },
};

test("aggregates devices across sources", async () => {
  const reg = createRegistry();
  reg.register(src);
  const devices = await reg.allDevices();
  assert.deepEqual(devices.map((d) => d.name), ["sw1"]);
});

test("finds the executor that supports a device", () => {
  const reg = createRegistry();
  reg.register(src);
  const exec = reg.executorFor({ executor: "catalyst-center" });
  assert.equal(typeof exec.runReadOnly, "function");
});
