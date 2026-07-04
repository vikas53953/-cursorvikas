const test = require("node:test");
const assert = require("node:assert/strict");
const { createCatalystCenterInventory } = require("../electron/sources/providers/catalyst-center-inventory.cjs");

const fakeCatc = {
  getInventory: async () => [
    { id: "u1", hostname: "sw1", managementIp: "10.10.20.51", role: "ACCESS", softwareType: "IOS-XE" },
  ],
  checkReachable: async () => true,
};

test("search returns normalized devices tagged with the source + executor", async () => {
  const inv = createCatalystCenterInventory({ catc: fakeCatc, sourceId: "catc-sandbox" });
  const devices = await inv.search();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].name, "sw1");
  assert.equal(devices[0].executor, "catalyst-center");
  assert.equal(devices[0].sourceId, "catc-sandbox");
});

test("health reflects reachability failure honestly", async () => {
  const inv = createCatalystCenterInventory({ catc: { checkReachable: async () => { throw new Error("timeout"); } }, sourceId: "x" });
  const h = await inv.health();
  assert.equal(h.reachable, false);
  assert.match(h.error, /timeout/);
});
