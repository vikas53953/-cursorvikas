const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeEntity,
  resolveWindow,
  buildInvestigation,
  renderInvestigationMarkdown,
  summarizeInvestigation,
  MAX_LOOKBACK_HOURS,
} = require("../electron/core/investigation.cjs");

const NOW = Date.parse("2026-08-28T12:00:00Z");
const t = (iso) => Date.parse(iso);

function ev(platform, ts, extra = {}) {
  return { ts, platform, provider: "splunk", kind: `${platform}.event`, summary: `${platform} thing`, entities: {}, ...extra };
}

test("normalizeEntity handles structured and bare inputs", () => {
  assert.deepEqual(normalizeEntity({ user: "jdoe" }), { kind: "user", value: "jdoe" });
  assert.deepEqual(normalizeEntity({ ip: "10.1.2.3" }), { kind: "ip", value: "10.1.2.3" });
  assert.deepEqual(normalizeEntity("10.1.2.3"), { kind: "ip", value: "10.1.2.3" });
  assert.deepEqual(normalizeEntity("jdoe@corp.com"), { kind: "user", value: "jdoe@corp.com" });
  assert.deepEqual(normalizeEntity("lt-4421"), { kind: "host", value: "lt-4421" });
  assert.deepEqual(normalizeEntity("sw1"), { kind: "host", value: "sw1" });
  assert.equal(normalizeEntity(""), null);
  assert.equal(normalizeEntity({}), null);
});

test("resolveWindow defaults to 24h and clamps to the maximum lookback", () => {
  const def = resolveWindow({}, NOW);
  assert.equal(def.hours, 24);
  assert.equal(def.toMs, NOW);
  const huge = resolveWindow({ lookbackHours: 99999 }, NOW);
  assert.equal(huge.hours, MAX_LOOKBACK_HOURS);
  const abs = resolveWindow({ from: "2026-08-28T00:00:00Z", to: "2026-08-28T06:00:00Z" }, NOW);
  assert.equal(abs.hours, 6);
});

test("buildInvestigation refuses to run without a seed entity", () => {
  const r = buildInvestigation({ entity: null, results: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /seed entity/);
});

test("merges provider results into one time-ordered timeline, dropping out-of-window rows and duplicates", () => {
  const results = [
    { provider: "splunk", platform: "identity", status: "ok", events: [ev("identity", "2026-08-28T10:05:00Z"), ev("identity", "2026-08-28T10:05:00Z")] },
    { provider: "splunk", platform: "vpn", status: "ok", events: [ev("vpn", "2026-08-28T10:00:00Z"), ev("vpn", "2026-08-01T10:00:00Z")] },
    { provider: "catalyst-center", platform: "network", status: "ok", events: [ev("network", "2026-08-28T11:00:00Z", { provider: "catalyst-center" })] },
  ];
  const inv = buildInvestigation({ entity: { user: "jdoe" }, window: { lookbackHours: 24 }, results, now: NOW });
  assert.equal(inv.ok, true);
  assert.deepEqual(inv.timeline.map((e) => e.platform), ["vpn", "identity", "network"]);
  assert.equal(inv.counts.droppedOutOfWindow, 1);
  assert.equal(inv.counts.droppedDuplicates, 1);
  assert.deepEqual(inv.counts.byPlatform, { vpn: 1, identity: 1, network: 1 });
  assert.equal(inv.timeline[0].epochMs, t("2026-08-28T10:00:00Z"));
});

test("coverage and gaps report unconfigured, failed and empty providers honestly", () => {
  const results = [
    { provider: "splunk", platform: "vpn", status: "unconfigured", events: [] },
    { provider: "splunk", platform: "proxy", status: "failed", events: [], error: "HTTP 401" },
    { provider: "splunk", platform: "cloud", status: "empty", events: [] },
    { provider: "splunk", platform: "identity", status: "ok", events: [ev("identity", "2026-08-28T10:00:00Z")] },
  ];
  const inv = buildInvestigation({ entity: { ip: "10.0.0.5" }, results, now: NOW });
  assert.equal(inv.coverage.length, 4);
  assert.equal(inv.gaps.length, 3);
  assert.match(inv.gaps[0], /not configured/);
  assert.match(inv.gaps[1], /HTTP 401/);
  assert.match(inv.gaps[2], /no events matched/);
});

test("discovers pivots from entities that co-occur with the seed", () => {
  const results = [
    {
      provider: "splunk",
      platform: "vpn",
      status: "ok",
      events: [
        ev("vpn", "2026-08-28T09:00:00Z", { entities: { user: "jdoe", srcIp: "203.0.113.9", assignedIp: "10.20.0.7" } }),
        ev("vpn", "2026-08-28T09:30:00Z", { entities: { user: "jdoe", srcIp: "203.0.113.9" } }),
      ],
    },
    { provider: "splunk", platform: "endpoint", status: "ok", events: [ev("endpoint", "2026-08-28T09:40:00Z", { entities: { user: "jdoe", host: "LT-4421" } })] },
  ];
  const inv = buildInvestigation({ entity: { user: "jdoe" }, results, now: NOW });
  const ipPivot = inv.pivots.find((p) => p.value === "203.0.113.9");
  assert.equal(ipPivot.kind, "ip");
  assert.equal(ipPivot.count, 2);
  assert.deepEqual(ipPivot.platforms, ["vpn"]);
  assert.ok(inv.pivots.find((p) => p.value === "LT-4421" && p.kind === "host"));
  assert.ok(!inv.pivots.find((p) => p.value === "jdoe"), "the seed is not its own pivot");
});

test("observations are factual: failed-then-success auth, vpn address reuse, firewall denies", () => {
  const fails = [1, 2, 3].map((i) => ev("identity", `2026-08-28T08:0${i}:00Z`, { kind: "auth.failure", summary: "authentication [failure]" }));
  const success = ev("identity", "2026-08-28T08:05:00Z", { kind: "auth.success", summary: "authentication [success]" });
  const vpn = ev("vpn", "2026-08-28T08:06:00Z", { kind: "vpn.session", summary: "AnyConnect session assigned 10.20.0.7", entities: { assignedIp: "10.20.0.7" } });
  const fw = [
    ev("firewall", "2026-08-28T08:10:00Z", { kind: "fw.deny", summary: "deny to 198.51.100.4:445", entities: { srcIp: "10.20.0.7", destIp: "198.51.100.4", action: "deny" } }),
    ev("firewall", "2026-08-28T08:11:00Z", { kind: "fw.allow", summary: "allow to 198.51.100.8:443", entities: { srcIp: "10.20.0.7", destIp: "198.51.100.8", action: "allow" } }),
  ];
  const inv = buildInvestigation({
    entity: { user: "jdoe" },
    results: [
      { provider: "splunk", platform: "identity", status: "ok", events: [...fails, success] },
      { provider: "splunk", platform: "vpn", status: "ok", events: [vpn] },
      { provider: "splunk", platform: "firewall", status: "ok", events: fw },
    ],
    now: NOW,
  });
  const texts = inv.observations.map((o) => o.text).join("\n");
  assert.match(texts, /3 failed authentication events, then a successful one at 2026-08-28T08:05:00.000Z/);
  assert.match(texts, /assigned address 10\.20\.0\.7 appears as source on 2 later events \(firewall\)/);
  assert.match(texts, /firewall: 1 of 2 events are deny\/drop \(top destinations: 198\.51\.100\.4 \(1\)\)/);
  assert.match(texts, /^7 correlated events for user jdoe across 3 platforms; highest severity info\./m);
});

test("markdown render includes coverage, timeline, pivots, gaps and the audit queries", () => {
  const inv = buildInvestigation({
    entity: { user: "jdoe" },
    results: [
      { provider: "splunk", platform: "identity", status: "ok", query: "search index=auth user=\"jdoe\"", events: [ev("identity", "2026-08-28T10:00:00Z", { entities: { user: "jdoe", srcIp: "1.2.3.4" }, summary: "Okta login | ok" })] },
      { provider: "splunk", platform: "vpn", status: "unconfigured", events: [] },
    ],
    now: NOW,
  });
  const md = renderInvestigationMarkdown(inv);
  assert.match(md, /^# Investigation INV-\d{14} - user `jdoe`/);
  assert.match(md, /## Coverage/);
  assert.match(md, /\| identity \| splunk \| ok \| 1 \|/);
  assert.match(md, /## Timeline \(1 events, UTC\)/);
  assert.match(md, /Okta login \\\| ok/, "pipes in summaries are escaped for the table");
  assert.match(md, /## Related entities/);
  assert.match(md, /\| ip \| 1\.2\.3\.4 \| 1 \| identity \|/);
  assert.match(md, /## Gaps\n- vpn \(splunk\): not configured/);
  assert.match(md, /## Queries run \(audit\)[\s\S]*search index=auth user="jdoe"/);
});

test("summary says plainly when nothing is configured", () => {
  const inv = buildInvestigation({ entity: { user: "jdoe" }, results: [{ provider: "splunk", platform: "vpn", status: "unconfigured", events: [] }], now: NOW });
  assert.match(summarizeInvestigation(inv), /No evidence sources are configured/);
});
