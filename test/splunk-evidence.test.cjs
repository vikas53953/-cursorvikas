const test = require("node:test");
const assert = require("node:assert/strict");
const { createSplunkClient, parseExportBody, isConfigured, configFromEnv } = require("../electron/sources/evidence/splunk.cjs");
const { LENSES, buildSpl, mapRow, lensById, entityFilter } = require("../electron/sources/evidence/lenses.cjs");
const { createSplunkLensProviders, createCatalystCenterEvidenceProvider, collectEvidence } = require("../electron/sources/evidence/index.cjs");

const tokenConfig = { baseUrl: "https://splunk.example:8089", token: "abc", username: "", password: "", verifyTls: true, timeoutMs: 1000, maxCount: 100 };

test("configFromEnv / isConfigured require a URL plus token or basic credentials", () => {
  assert.equal(isConfigured(configFromEnv({})), false);
  assert.equal(isConfigured(configFromEnv({ SPLUNK_URL: "https://x" })), false);
  assert.equal(isConfigured(configFromEnv({ SPLUNK_URL: "https://x/", SPLUNK_TOKEN: "t" })), true);
  assert.equal(isConfigured(configFromEnv({ SPLUNK_URL: "https://x", SPLUNK_USERNAME: "u", SPLUNK_PASSWORD: "p" })), true);
  assert.equal(configFromEnv({ SPLUNK_URL: "https://x/", SPLUNK_TOKEN: "t" }).baseUrl, "https://x");
  assert.equal(configFromEnv({ SPLUNK_VERIFY_TLS: "false" }).verifyTls, false);
  assert.equal(configFromEnv({}).verifyTls, true, "TLS verification is on by default");
});

test("parseExportBody keeps finalized result rows only", () => {
  const body = [
    JSON.stringify({ preview: true, result: { user: "preview" } }),
    JSON.stringify({ preview: false, offset: 0, result: { user: "jdoe", _time: "2026-08-28T10:00:00.000+00:00" } }),
    "not json",
    JSON.stringify({ preview: false, offset: 1, result: { user: "jdoe2" }, lastrow: true }),
    "",
  ].join("\n");
  const rows = parseExportBody(body);
  assert.deepEqual(rows.map((r) => r.user), ["jdoe", "jdoe2"]);
});

test("search posts to the export endpoint with bearer auth, epoch window and read-only SPL", async () => {
  let captured;
  const transport = async (req) => {
    captured = req;
    return { status: 200, body: JSON.stringify({ preview: false, result: { user: "jdoe", _time: "2026-08-28T10:00:00.000+00:00" } }) };
  };
  const client = createSplunkClient({ config: tokenConfig, transport });
  const r = await client.search('index=auth user="jdoe"', { earliestMs: 1000 * 1700000000, latestMs: 1000 * 1700003600 });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
  assert.equal(captured.url, "https://splunk.example:8089/services/search/jobs/export");
  assert.equal(captured.method, "POST");
  assert.equal(captured.headers.Authorization, "Bearer abc");
  assert.equal(captured.verifyTls, true);
  const params = new URLSearchParams(captured.body);
  assert.equal(params.get("search"), 'search index=auth user="jdoe"');
  assert.equal(params.get("output_mode"), "json");
  assert.equal(params.get("earliest_time"), "1700000000");
  assert.equal(params.get("latest_time"), "1700003600");
  assert.equal(params.get("max_count"), "100");
});

test("search uses basic auth when only username/password are set", async () => {
  let captured;
  const client = createSplunkClient({ config: { ...tokenConfig, token: "", username: "u", password: "p" }, transport: async (req) => { captured = req; return { status: 200, body: "" }; } });
  await client.search("index=x");
  assert.equal(captured.headers.Authorization, `Basic ${Buffer.from("u:p").toString("base64")}`);
});

test("search refuses non-read-only SPL before any request is sent", async () => {
  let called = false;
  const client = createSplunkClient({ config: tokenConfig, transport: async () => { called = true; return { status: 200, body: "" }; } });
  const r = await client.search("index=auth | delete");
  assert.equal(r.ok, false);
  assert.match(r.error, /Read-only policy/);
  assert.equal(called, false);
});

test("search reports HTTP and transport failures without throwing", async () => {
  const unauthorized = createSplunkClient({ config: tokenConfig, transport: async () => ({ status: 401, body: "Unauthorized" }) });
  const r1 = await unauthorized.search("index=auth");
  assert.equal(r1.ok, false);
  assert.match(r1.error, /HTTP 401/);
  const down = createSplunkClient({ config: tokenConfig, transport: async () => { throw new Error("ECONNREFUSED"); } });
  const r2 = await down.search("index=auth");
  assert.equal(r2.ok, false);
  assert.match(r2.error, /ECONNREFUSED/);
});

test("search is honest when Splunk is not configured", async () => {
  const client = createSplunkClient({ config: { ...tokenConfig, baseUrl: "", token: "" }, transport: async () => { throw new Error("must not be called"); } });
  const r = await client.search("index=auth");
  assert.equal(r.ok, false);
  assert.equal(r.configured, false);
  assert.match(r.error, /not configured/);
});

test("lenses cover every SOC platform and build entity-scoped read-only SPL", () => {
  assert.deepEqual(LENSES.map((l) => l.platform), ["vpn", "proxy", "firewall", "endpoint", "identity", "cloud", "siem"]);
  const spl = buildSpl(lensById("vpn"), { kind: "user", value: "jdoe" }, { limit: 50, env: {} });
  assert.match(spl, /^search index=\* \(tag=vpn/);
  assert.match(spl, /user="jdoe"/);
  assert.match(spl, /\| fields _time host/);
  assert.match(spl, /\| head 50$/);
  const ipFilter = entityFilter({ kind: "ip", value: "10.0.0.1" });
  assert.match(ipFilter, /src_ip="10\.0\.0\.1"/);
  assert.match(ipFilter, /assigned_ip="10\.0\.0\.1"/);
});

test("lens base search is overridable per environment", () => {
  const spl = buildSpl(lensById("firewall"), { kind: "host", value: "sw1" }, { env: { SPLUNK_LENS_FIREWALL: "index=netsec sourcetype=pan:traffic" } });
  assert.match(spl, /^search index=netsec sourcetype=pan:traffic \(host="sw1"/);
});

test("mapRow builds contract events from CIM fields only", () => {
  const vpn = mapRow(lensById("vpn"), { _time: "2026-08-28T09:00:00.000+00:00", user: "jdoe", src: "203.0.113.9", assigned_ip: "10.20.0.7", sourcetype: "cisco:asa", signature: "ASA-6-722022", action: "success" });
  assert.equal(vpn.platform, "vpn");
  assert.equal(vpn.kind, "vpn.session");
  assert.equal(vpn.product, "cisco:asa");
  assert.equal(vpn.entities.assignedIp, "10.20.0.7");
  assert.equal(vpn.entities.srcIp, "203.0.113.9");
  assert.match(vpn.summary, /ASA-6-722022 action=success assigned 10\.20\.0\.7/);

  const auth = mapRow(lensById("identity"), { _time: "2026-08-28T08:00:00.000+00:00", user: "jdoe", action: "failure", app: "okta", reason: "INVALID_CREDENTIALS", sourcetype: "OktaIM2:log" });
  assert.equal(auth.kind, "auth.failure");
  assert.match(auth.summary, /reason=INVALID_CREDENTIALS/);

  const fw = mapRow(lensById("firewall"), { _time: "1756370000", src_ip: "10.20.0.7", dest_ip: "198.51.100.4", dest_port: "445", action: "blocked", transport: "tcp", sourcetype: "pan:traffic" });
  assert.equal(fw.kind, "fw.deny");
  assert.match(fw.summary, /blocked to 198\.51\.100\.4:445 tcp/);

  const proxy = mapRow(lensById("proxy"), { _time: "2026-08-28T08:00:00.000+00:00", url: "http://evil.example/x", action: "blocked", http_method: "GET" });
  assert.equal(proxy.kind, "proxy.blocked");

  const cloud = mapRow(lensById("cloud"), { _time: "2026-08-28T08:00:00.000+00:00", eventName: "AttachUserPolicy", eventSource: "iam.amazonaws.com", awsRegion: "us-east-1", sourceIPAddress: "203.0.113.9", "userIdentity.userName": "jdoe" });
  assert.equal(cloud.kind, "cloud.api");
  assert.equal(cloud.entities.user, "jdoe");
  assert.equal(cloud.entities.srcIp, "203.0.113.9");
  assert.match(cloud.summary, /AttachUserPolicy \(iam\.amazonaws\.com\) region=us-east-1/);
});

test("splunk lens providers report unconfigured without calling Splunk, and map rows when configured", async () => {
  const off = createSplunkLensProviders({ splunk: { configured: () => false, search: async () => { throw new Error("no"); } }, env: {} });
  const r = await off[0].collect({ entity: { kind: "user", value: "jdoe" }, window: { fromMs: 0, toMs: 1 } });
  assert.equal(r.status, "unconfigured");

  let seenSpl;
  const on = createSplunkLensProviders({
    splunk: { configured: () => true, search: async (spl) => { seenSpl = spl; return { ok: true, rows: [{ _time: "2026-08-28T09:00:00.000+00:00", user: "jdoe" }], ms: 5 }; } },
    env: {},
  });
  const identity = on.find((p) => p.platform === "identity");
  const res = await identity.collect({ entity: { kind: "user", value: "jdoe" }, window: { fromMs: 0, toMs: 1 } });
  assert.equal(res.status, "ok");
  assert.equal(res.events.length, 1);
  assert.equal(res.query, seenSpl);
  assert.equal(res.ms, 5);

  const failing = createSplunkLensProviders({ splunk: { configured: () => true, search: async () => ({ ok: false, error: "HTTP 503", ms: 2 }) }, env: {} });
  const fail = await failing[0].collect({ entity: { kind: "user", value: "jdoe" }, window: { fromMs: 0, toMs: 1 } });
  assert.equal(fail.status, "failed");
  assert.equal(fail.error, "HTTP 503");
});

test("catalyst center evidence matches events and issues to the seed device", async () => {
  const catc = {
    getInventoryCached: async () => [{ id: "u1", hostname: "sw1", managementIp: "10.10.20.175" }],
    getEvents: async () => [
      { timestamp: 1756370000000, name: "Link down", description: "GigabitEthernet1/0/3 on sw1", source: "sw1", severity: 2, type: "NETWORK" },
      { timestamp: 1756370100000, name: "Sync", description: "sw4 synced", source: "sw4", severity: 4, type: "NETWORK" },
    ],
    getIssues: async () => [{ issueId: "i1", name: "High CPU", deviceId: "u1", status: "active", priority: "P2", issueOccurenceCount: 3, lastOccurenceTime: 1756370200000 }],
  };
  const provider = createCatalystCenterEvidenceProvider({ catc, source: { getMode: async () => ({ mode: "live" }) } });
  const r = await provider.collect({ entity: { kind: "host", value: "sw1" }, window: { fromMs: 0, toMs: Date.now() } });
  assert.equal(r.status, "ok");
  assert.deepEqual(r.events.map((e) => e.kind), ["net.network", "net.issue"]);
  assert.equal(r.events[1].entities.host, "sw1");

  const unreachable = createCatalystCenterEvidenceProvider({ catc, source: { getMode: async () => ({ mode: "unreachable" }) } });
  const u = await unreachable.collect({ entity: { kind: "host", value: "sw1" }, window: { fromMs: 0, toMs: 1 } });
  assert.equal(u.status, "failed");
  assert.match(u.error, /unreachable/);
});

test("collectEvidence runs providers in parallel, filters by platform and contains throws", async () => {
  const providers = [
    { id: "splunk:vpn", platform: "vpn", configured: () => true, collect: async () => ({ status: "ok", events: [] }) },
    { id: "splunk:proxy", platform: "proxy", configured: () => true, collect: async () => { throw new Error("boom"); } },
    { id: "catalyst-center", platform: "network", configured: () => true, collect: async () => ({ status: "empty", events: [] }) },
  ];
  const all = await collectEvidence({ providers, entity: { kind: "user", value: "x" }, window: { fromMs: 0, toMs: 1 } });
  assert.deepEqual(all.map((r) => [r.provider, r.platform, r.status]), [["splunk", "vpn", "ok"], ["splunk", "proxy", "failed"], ["catalyst-center", "network", "empty"]]);
  assert.equal(all[1].error, "boom");
  const some = await collectEvidence({ providers, entity: { kind: "user", value: "x" }, window: { fromMs: 0, toMs: 1 }, platforms: ["network"] });
  assert.deepEqual(some.map((r) => r.platform), ["network"]);
});
