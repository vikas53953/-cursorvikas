// Evidence providers for cross-platform investigations.
//
// @typedef {Object} EvidenceProvider
// @property {string} id
// @property {string} platform        One of investigation.PLATFORMS
// @property {()=>boolean} configured
// @property {(q:{entity:{kind,value}, window:{fromMs,toMs}, limit?:number})=>Promise<ProviderResult>} collect
//
// Two families ship today:
//   - Splunk lenses (VPN, proxy, firewall, endpoint, identity, cloud, SIEM notables)
//     over one real Splunk REST client - most SOCs already land these feeds there.
//   - Catalyst Center network evidence (issues + event series) for the network
//     devices NetJarvis already manages.
// Direct-API providers (Okta, CrowdStrike, CloudTrail, ...) plug in here with
// the same shape when a shop does not route that feed through Splunk. A provider
// that is not configured says so (status "unconfigured") - it never returns
// placeholder data.

const { LENSES, buildSpl, mapRow } = require("./lenses.cjs");
const { isIpv4 } = require("../../core/investigation.cjs");
const { createFixtureEvidenceProviders, fixtureDirFromEnv } = require("./fixture.cjs");

function createSplunkLensProviders({ splunk, env = process.env, lenses = LENSES } = {}) {
  return lenses.map((lens) => ({
    id: `splunk:${lens.id}`,
    platform: lens.platform,
    title: lens.title,
    configured: () => Boolean(splunk && splunk.configured()),
    async collect({ entity, window, limit = 200 }) {
      const base = { provider: "splunk", platform: lens.platform };
      if (!splunk || !splunk.configured()) {
        return { ...base, status: "unconfigured", events: [], error: "Splunk is not configured (SPLUNK_URL + SPLUNK_TOKEN or SPLUNK_USERNAME/SPLUNK_PASSWORD)." };
      }
      const spl = buildSpl(lens, entity, { limit, env });
      const result = await splunk.search(spl, { earliestMs: window.fromMs, latestMs: window.toMs, maxCount: limit });
      if (!result.ok) return { ...base, status: "failed", events: [], error: result.error, query: spl, ms: result.ms };
      const events = result.rows.map((row) => mapRow(lens, row));
      return { ...base, status: events.length ? "ok" : "empty", events, query: spl, ms: result.ms };
    },
  }));
}

function textMentions(text, value) {
  return String(text || "").toLowerCase().includes(String(value).toLowerCase());
}

// Catalyst Center event severity is numeric 1 (critical) .. 5 (informational)
// on the event-series API; audit-log entries (user logins, API calls) are
// informational whatever number they carry. Issues carry P1..P4, which
// normalizeSeverity already reads.
function catalystSeverity(value, type) {
  if (/audit/i.test(String(type || ""))) return "info";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return ["info", "critical", "high", "medium", "low", "info"][Math.max(0, Math.min(5, Math.round(n)))];
}

// Network-domain evidence from the network NetJarvis already sees. Uses the raw
// Catalyst Center event series (real epoch timestamps) rather than the dashboard
// snapshot, whose event times are pre-formatted hh:mm.
function createCatalystCenterEvidenceProvider({ catc, source }) {
  return {
    id: "catalyst-center",
    platform: "network",
    title: "Catalyst Center issues and events",
    configured: () => Boolean(catc),
    async collect({ entity, window, limit = 200 }) {
      const base = { provider: "catalyst-center", platform: "network" };
      const started = Date.now();
      try {
        const { mode } = await source.getMode();
        if (mode !== "live") return { ...base, status: "failed", events: [], error: "Catalyst Center is unreachable.", ms: Date.now() - started };
        const [inventory, events, issues] = await Promise.all([
          catc.getInventoryCached().catch(() => []),
          catc.getEvents(Math.min(Math.max(limit, 50), 500)).catch(() => []),
          catc.getIssues().catch(() => []),
        ]);
        const byId = new Map(inventory.map((d) => [d.id, d]));
        const byName = new Map(inventory.map((d) => [String(d.hostname || "").toLowerCase(), d]));
        const byIp = new Map(inventory.map((d) => [String(d.managementIp || ""), d]));

        const seedDevice =
          entity.kind === "host" ? byName.get(entity.value.toLowerCase()) : entity.kind === "ip" ? byIp.get(entity.value) : null;

        const out = [];
        for (const event of events) {
          const haystack = `${event.source} ${event.name} ${event.description}`;
          const matches = textMentions(haystack, entity.value) || (seedDevice && (textMentions(haystack, seedDevice.hostname) || textMentions(haystack, seedDevice.managementIp)));
          if (!matches) continue;
          // Audit-log events carry the client IP in `source` and the account in
          // quotes inside the description ("'devnetuser' logged in successfully").
          const sourceIsIp = isIpv4(event.source);
          const quotedUser = String(event.description || "").match(/'([^']{1,80})'/);
          const deviceName = sourceIsIp ? seedDevice?.hostname || "" : event.source || seedDevice?.hostname || "";
          out.push({
            ts: event.timestamp,
            provider: "catalyst-center",
            platform: "network",
            product: "cisco:catalyst-center",
            kind: `net.${String(event.type || "event").toLowerCase()}`,
            severity: catalystSeverity(event.severity, event.type),
            entities: {
              device: deviceName,
              host: deviceName,
              srcIp: sourceIsIp ? event.source : "",
              user: quotedUser ? quotedUser[1] : "",
            },
            summary: (String(event.description || "").startsWith(String(event.name || "")) ? String(event.description) : `${event.name}: ${event.description}`).slice(0, 200),
            raw: event,
          });
        }
        for (const issue of issues) {
          const device = byId.get(issue.deviceId);
          const matches =
            (seedDevice && device && device.id === seedDevice.id) ||
            textMentions(issue.name, entity.value) ||
            (device && textMentions(device.hostname, entity.value));
          if (!matches) continue;
          out.push({
            ts: issue.lastOccurenceTime,
            provider: "catalyst-center",
            platform: "network",
            product: "cisco:catalyst-center",
            kind: "net.issue",
            severity: issue.priority,
            entities: { device: device?.hostname || "", host: device?.hostname || "", destIp: device?.managementIp || "" },
            summary: `Issue ${issue.name || issue.issueId} (${issue.status || "active"}, ${issue.priority || "n/a"}, x${issue.issueOccurenceCount ?? 1})`.slice(0, 200),
            raw: issue,
          });
        }
        return { ...base, status: out.length ? "ok" : "empty", events: out, ms: Date.now() - started, query: `Catalyst Center /event/event-series + /issues filtered by ${entity.kind}=${entity.value}` };
      } catch (error) {
        return { ...base, status: "failed", events: [], error: error instanceof Error ? error.message : String(error), ms: Date.now() - started };
      }
    },
  };
}

/** Runs every selected provider in parallel; a throwing provider becomes a "failed" result. */
async function collectEvidence({ providers, entity, window, platforms, limit = 200 }) {
  const wanted = Array.isArray(platforms) && platforms.length ? new Set(platforms.map((p) => String(p).toLowerCase())) : null;
  const selected = providers.filter((p) => !wanted || wanted.has(p.platform));
  return Promise.all(
    selected.map(async (provider) => {
      const started = Date.now();
      try {
        const result = await provider.collect({ entity, window, limit });
        return { provider: provider.id.split(":")[0], platform: provider.platform, ...result, providerId: provider.id };
      } catch (error) {
        return {
          provider: provider.id.split(":")[0],
          providerId: provider.id,
          platform: provider.platform,
          status: "failed",
          events: [],
          error: error instanceof Error ? error.message : String(error),
          ms: Date.now() - started,
        };
      }
    }),
  );
}

function createEvidenceProviders({ splunk, catc, source, env = process.env } = {}) {
  const providers = [];
  if (catc && source) providers.push(createCatalystCenterEvidenceProvider({ catc, source }));
  providers.push(...createSplunkLensProviders({ splunk, env }));
  // Mock lab (FIXTURE DATA) - only when explicitly enabled; see fixture.cjs.
  const fixtureDir = fixtureDirFromEnv(env);
  if (fixtureDir) {
    const fixtures = createFixtureEvidenceProviders({ dir: fixtureDir });
    providers.push(...fixtures);
    providers.lab = fixtures.lab;
  }
  return providers;
}

module.exports = { createSplunkLensProviders, createCatalystCenterEvidenceProvider, createEvidenceProviders, collectEvidence };
