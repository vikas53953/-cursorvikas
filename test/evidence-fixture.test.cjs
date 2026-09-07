const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { createFixtureEvidenceProviders, fixtureDirFromEnv, loadLab, DEFAULT_LAB_DIR } = require("../electron/sources/evidence/fixture.cjs");
const { createEvidenceProviders, collectEvidence } = require("../electron/sources/evidence/index.cjs");
const { buildInvestigation, renderInvestigationMarkdown, summarizeInvestigation, PLATFORMS, resolveWindow } = require("../electron/core/investigation.cjs");

const NOW = Date.parse("2026-08-28T12:00:00Z");
const REQUIRED_PLATFORMS = ["vpn", "proxy", "firewall", "endpoint", "identity", "cloud", "siem", "network"];

test("mock lab is OFF unless NETJARVIS_EVIDENCE_FIXTURE is set", () => {
  assert.equal(fixtureDirFromEnv({}), null);
  assert.equal(fixtureDirFromEnv({ NETJARVIS_EVIDENCE_FIXTURE: "0" }), null);
  assert.equal(fixtureDirFromEnv({ NETJARVIS_EVIDENCE_FIXTURE: "false" }), null);
  assert.equal(fixtureDirFromEnv({ NETJARVIS_EVIDENCE_FIXTURE: "1" }), DEFAULT_LAB_DIR);
  assert.equal(fixtureDirFromEnv({ NETJARVIS_EVIDENCE_FIXTURE: "true" }), DEFAULT_LAB_DIR);
  assert.equal(fixtureDirFromEnv({ NETJARVIS_EVIDENCE_FIXTURE: "/tmp/lab" }), path.resolve("/tmp/lab"));
  const providers = createEvidenceProviders({ splunk: { configured: () => false }, env: {} });
  assert.ok(!providers.some((p) => p.id.startsWith("fixture:")));
  assert.equal(providers.lab, undefined);
});

test("bundled mock lab covers every required platform and validates against the contract", () => {
  const lab = loadLab(DEFAULT_LAB_DIR);
  assert.deepEqual(lab.errors, []);
  assert.equal(lab.name, "mock-lab");
  assert.deepEqual(lab.files.map((f) => f.platform).sort(), [...REQUIRED_PLATFORMS].sort());
  assert.ok(lab.devices.length >= 10, "one representative mock device per platform plus endpoints/switches");

  const deviceNames = new Set(lab.devices.map((d) => d.name));
  for (const device of lab.devices) {
    for (const key of ["name", "domain", "platform", "role"]) assert.ok(device[key], `${device.name} missing ${key}`);
    for (const feed of device.feeds) assert.ok(PLATFORMS.includes(feed), `${device.name} feed ${feed}`);
  }
  for (const file of lab.files) {
    for (const d of file.devices) assert.ok(deviceNames.has(d), `${file.file} references unknown device ${d}`);
    for (const event of file.events) {
      assert.equal(typeof event.offsetMinutes, "number", `${file.file}: events use offsetMinutes`);
      assert.ok(event.offsetMinutes <= 0 && event.offsetMinutes > -24 * 60, `${file.file}: offsets stay inside the default 24h window`);
      assert.ok(event.kind && event.summary && event.entities, `${file.file}: kind/summary/entities`);
      if (event.entities.device) assert.ok(deviceNames.has(event.entities.device), `${file.file}: entities.device ${event.entities.device} not in devices.json`);
    }
  }
  // Every platform feed is attributed to at least one mock device.
  for (const platform of REQUIRED_PLATFORMS) {
    assert.ok(lab.devices.some((d) => d.feeds.includes(platform)), `no mock device feeds ${platform}`);
  }
});

test("fixture providers are labelled 'fixture', filter by entity and window, and honour offsets from now", async () => {
  const providers = createFixtureEvidenceProviders({ dir: DEFAULT_LAB_DIR, now: () => NOW });
  assert.equal(providers.length, REQUIRED_PLATFORMS.length);
  assert.ok(providers.every((p) => p.id.startsWith("fixture:") && p.fixture === true));

  const window = resolveWindow({ lookbackHours: 24 }, NOW);
  const identity = providers.find((p) => p.platform === "identity");
  const r = await identity.collect({ entity: { kind: "user", value: "jdoe" }, window });
  assert.equal(r.provider, "fixture");
  assert.equal(r.status, "ok");
  assert.equal(r.events.length, 5);
  assert.ok(r.events.every((e) => e.provider === "fixture" && e.entities.user === "jdoe"));
  assert.equal(r.events[0].epochMs, NOW - 185 * 60000);
  assert.match(r.query, /fixture mock-lab\/identity\.json/);

  const nobody = await identity.collect({ entity: { kind: "user", value: "nobody" }, window });
  assert.equal(nobody.status, "empty");

  const tiny = await identity.collect({ entity: { kind: "user", value: "jdoe" }, window: resolveWindow({ lookbackHours: 1 }, NOW) });
  assert.equal(tiny.events.length, 1, "only the AD logon 60 minutes ago is inside a 1h window");
});

test("mock-lab scenario correlates across all platforms and is banner-labelled FIXTURE", async () => {
  const providers = createFixtureEvidenceProviders({ dir: DEFAULT_LAB_DIR, now: () => NOW });
  const window = resolveWindow({ lookbackHours: 24 }, NOW);
  const results = await collectEvidence({ providers, entity: { kind: "user", value: "jdoe" }, window });
  const inv = buildInvestigation({ entity: { user: "jdoe" }, window: { from: window.from, to: window.to }, results, now: NOW });

  assert.equal(inv.fixture, true);
  assert.equal(Object.keys(inv.counts.byPlatform).length, 8);
  assert.equal(inv.counts.total, 29);
  const texts = inv.observations.map((o) => o.text).join("\n");
  assert.match(texts, /identity: 3 failed authentication events, then a successful one/);
  assert.match(texts, /vpn: assigned address 10\.20\.0\.7 appears as source on \d+ later events \(firewall, identity, network, proxy\)/);
  assert.match(texts, /firewall: 3 of 4 events are deny\/drop \(top destinations: 198\.51\.100\.4 \(3\)\)/);
  assert.match(texts, /proxy: 2 of 4 requests were blocked \(top: pastebin\.com \(2\)\)/);
  assert.match(texts, /endpoint: 1 high\/critical detection/);
  assert.match(texts, /cloud: 2 identity\/permission-related control-plane events/);
  assert.match(texts, /highest severity critical/);

  const pivots = Object.fromEntries(inv.pivots.map((p) => [p.value, p]));
  assert.equal(pivots["203.0.113.9"].kind, "ip");
  assert.equal(pivots["10.20.0.7"].kind, "ip");
  assert.equal(pivots["LT-4421"].kind, "host");
  assert.equal(pivots["198.51.100.4"].kind, "ip");
  assert.ok(!pivots.asmith, "the benign user never co-occurs with jdoe");

  const md = renderInvestigationMarkdown(inv);
  assert.match(md, /> \*\*FIXTURE DATA\.\*\*/);
  assert.match(md, /\| identity \| fixture \| ok \| 5 \|/);
  assert.match(summarizeInvestigation(inv), /^\[FIXTURE DATA - mock lab, not a real network\]/);
});

test("investigating the VPN-assigned IP pivots back to the user and the laptop", async () => {
  const providers = createFixtureEvidenceProviders({ dir: DEFAULT_LAB_DIR, now: () => NOW });
  const window = resolveWindow({ lookbackHours: 24 }, NOW);
  const results = await collectEvidence({ providers, entity: { kind: "ip", value: "10.20.0.7" }, window });
  const inv = buildInvestigation({ entity: { ip: "10.20.0.7" }, window: { from: window.from, to: window.to }, results, now: NOW });
  assert.ok(inv.counts.total >= 12);
  assert.ok(inv.pivots.find((p) => p.kind === "user" && p.value === "jdoe"));
  assert.ok(inv.pivots.find((p) => p.kind === "host" && p.value === "LT-4421"));
});

test("a broken fixture directory is reported, not swallowed", () => {
  const lab = loadLab("/nonexistent/lab");
  assert.equal(lab.files.length, 0);
  assert.match(lab.errors[0], /cannot read fixture dir/);

  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "nj-lab-"));
  fs.writeFileSync(path.join(dir, "bad.json"), JSON.stringify({ platform: "not-a-platform", events: [] }));
  fs.writeFileSync(path.join(dir, "worse.json"), "{ nope");
  const broken = loadLab(dir);
  assert.equal(broken.files.length, 0);
  assert.equal(broken.errors.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
