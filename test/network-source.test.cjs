const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

describe("network-source snapshot honesty", { concurrency: false }, () => {
  test("source=live never overlays fixture inventory when CATC is down", async () => {
    process.env.NETJARVIS_SOURCE = "live";
    process.env.NETJARVIS_EVIDENCE_FIXTURE = "1";
    const source = require("../electron/network-source.cjs");
    // Force the CATC health to fail by pointing at an unroutable host. The
    // catalyst-center adapter reads CATC_BASE_URL into its config object once
    // at module load time, so setting the env var here (after the module is
    // already required) would not take effect and would leave the source
    // pointed at the real DevNet sandbox. Mutate the already-loaded config
    // object directly so the failure is deterministic and does not depend on
    // outbound network access in the test environment.
    source.catc.config.baseUrl = "https://127.0.0.1:1"; // nothing listening
    source.resetResolveCache();
    const snap = await source.getSnapshot(true);
    assert.equal(snap.reachable, false);
    assert.equal(snap.mode, "unreachable");
    assert.ok(snap.error);
    assert.ok(!snap.fixture);
    // Must NOT contain fabricated device data.
    assert.ok(!Array.isArray(snap.devices) || snap.devices.length === 0);
  });

  test("auto + fixture overlays labelled mock lab when CATC is down", async () => {
    process.env.NETJARVIS_SOURCE = "auto";
    process.env.NETJARVIS_EVIDENCE_FIXTURE = "1";
    const source = require("../electron/network-source.cjs");
    source.catc.config.baseUrl = "https://127.0.0.1:1";
    source.resetResolveCache();
    const snap = await source.getSnapshot(true);
    assert.equal(snap.mode, "fixture");
    assert.equal(snap.fixture, true);
    assert.ok(snap.source && /FIXTURE/i.test(snap.source));
    assert.ok(Array.isArray(snap.devices) && snap.devices.length > 0);
    assert.ok(snap.devices.every((device) => device.status === "fixture"));
    assert.ok(snap.health.score == null);
    assert.deepEqual(snap.links, []);
  });
});
