const test = require("node:test");
const assert = require("node:assert/strict");
const { createRegistry } = require("../electron/core/source-registry.cjs");
const { createQueryLayer } = require("../electron/core/query-layer.cjs");
const { createCatalystCenterInventory } = require("../electron/sources/providers/catalyst-center-inventory.cjs");
const { createCatalystCenterExecutor } = require("../electron/sources/executors/catalyst-center-executor.cjs");

test("end-to-end: resolve a name and run a show command via the CATC source", async () => {
  const catc = {
    getInventory: async () => [{ id: "u1", hostname: "sw1", managementIp: "10.10.20.51", role: "ACCESS", softwareType: "IOS-XE" }],
    checkReachable: async () => true,
    runCommands: async (uuids, commands) => ({ sw1: { [commands[0]]: "VLAN0001 default active" } }),
  };
  const registry = createRegistry();
  registry.register({ id: "catc-sandbox", domain: "data", inventory: createCatalystCenterInventory({ catc, sourceId: "catc-sandbox" }), executor: createCatalystCenterExecutor({ catc }) });
  const ql = createQueryLayer({ registry });
  const r = await ql.run("show vlan brief on sw1", ["show vlan brief"]);
  assert.equal(r.ok, true);
  assert.match(r.results[0].outputs["show vlan brief"], /VLAN0001/);
});
