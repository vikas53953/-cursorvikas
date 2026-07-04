const test = require("node:test");
const assert = require("node:assert/strict");

test("getSnapshot reports unreachable honestly when the source is down", async () => {
  process.env.NETJARVIS_SOURCE = "live";
  const source = require("../electron/network-source.cjs");
  // Force the CATC health to fail by pointing at an unroutable host. The
  // catalyst-center adapter reads CATC_BASE_URL into its config object once
  // at module load time, so setting the env var here (after the module is
  // already required) would not take effect and would leave the source
  // pointed at the real DevNet sandbox. Mutate the already-loaded config
  // object directly so the failure is deterministic and does not depend on
  // outbound network access in the test environment.
  source.catc.config.baseUrl = "https://127.0.0.1:1"; // nothing listening
  const snap = await source.getSnapshot(true);
  assert.equal(snap.reachable, false);
  assert.equal(snap.mode, "unreachable");
  assert.ok(snap.error);
  // Must NOT contain fabricated device data.
  assert.ok(!Array.isArray(snap.devices) || snap.devices.length === 0);
});
