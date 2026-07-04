const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeDevice, DOMAINS } = require("../electron/core/contracts.cjs");

test("normalizeDevice maps a Catalyst Center inventory row", () => {
  const d = normalizeDevice(
    { id: "uuid-1", hostname: "sw1", managementIp: "10.10.20.51", role: "ACCESS", platform: "C9KV", softwareType: "IOS-XE" },
    { sourceId: "catc-sandbox", executor: "catalyst-center" },
  );
  assert.equal(d.id, "uuid-1");
  assert.equal(d.name, "sw1");
  assert.equal(d.mgmtIp, "10.10.20.51");
  assert.equal(d.platform, "ios-xe");
  assert.equal(d.role, "access");
  assert.equal(d.sourceId, "catc-sandbox");
  assert.equal(d.executor, "catalyst-center");
  assert.equal(d.domain, "data");
});

test("DOMAINS includes the four enterprise domains", () => {
  assert.deepEqual(DOMAINS, ["data", "firewall", "proxy", "loadbalancer"]);
});
