// Cross-platform investigation engine (AI-Ready SOC, Part II).
//
// Takes evidence returned by pluggable evidence providers (Splunk lenses for
// VPN / proxy / firewall / endpoint / identity / cloud, Catalyst Center for the
// network itself, ...) and correlates it into ONE timestamped investigation:
// a merged timeline, entity pivots discovered from the evidence, per-platform
// coverage, and deterministic observations. Pure functions - no I/O, no LLM.
//
// Real data only: every timeline row carries the provider and platform it came
// from, and providers that were unconfigured, failed, or returned nothing are
// reported as gaps instead of being papered over.
//
// @typedef {Object} EvidenceEvent
// @property {string} ts         ISO-8601 timestamp (UTC)
// @property {number} epochMs
// @property {string} provider   Provider id that produced it ("splunk", "catalyst-center", ...)
// @property {string} platform   One of PLATFORMS
// @property {string} product    Vendor/product hint ("cisco:asa", "okta", "aws:cloudtrail", "")
// @property {string} kind       Short event class ("vpn.login", "proxy.request", "fw.deny", ...)
// @property {string} severity   "info" | "low" | "medium" | "high" | "critical"
// @property {Object} entities   { user, srcIp, destIp, host, device, app, url, ... } (strings, "" when unknown)
// @property {string} summary    One-line human summary (built from real fields only)
// @property {Object} raw        Original row (trimmed) for the audit artifact
//
// @typedef {Object} ProviderResult
// @property {string} provider
// @property {string} platform
// @property {"ok"|"empty"|"unconfigured"|"failed"} status
// @property {EvidenceEvent[]} events
// @property {string} [error]
// @property {string} [query]    The exact read-only query that ran (audit trail)
// @property {number} [ms]

const PLATFORMS = ["network", "vpn", "proxy", "firewall", "endpoint", "identity", "cloud", "siem"];

const ENTITY_KINDS = ["user", "ip", "host"];

const MAX_LOOKBACK_HOURS = 24 * 30;
const DEFAULT_LOOKBACK_HOURS = 24;
const MAX_TIMELINE_ROWS = 500;

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function isIpv4(value) {
  return IPV4.test(String(value || "").trim());
}

/** Turns a loose {user?, ip?, host?} (or a bare string) into a normalized entity. */
function normalizeEntity(input) {
  if (typeof input === "string") {
    const value = input.trim();
    if (!value) return null;
    if (isIpv4(value)) return { kind: "ip", value };
    if (value.includes("@") || value.includes("\\")) return { kind: "user", value };
    // Bare string heuristic only: hostnames usually carry a dot, a dash or a
    // trailing number ("sw1", "lt-4421", "web01.corp"); plain words are users.
    if (/[.\-]/.test(value) || /\d$/.test(value)) return { kind: "host", value };
    return { kind: "user", value };
  }
  const obj = input || {};
  if (obj.kind && obj.value) return { kind: String(obj.kind).toLowerCase(), value: String(obj.value).trim() };
  if (obj.user) return { kind: "user", value: String(obj.user).trim() };
  if (obj.ip) return { kind: "ip", value: String(obj.ip).trim() };
  if (obj.host) return { kind: "host", value: String(obj.host).trim() };
  return null;
}

/** Resolves {lookbackHours?, from?, to?} into a clamped, absolute window. */
function resolveWindow(input = {}, now = Date.now()) {
  let toMs = input.to ? Date.parse(input.to) : now;
  if (!Number.isFinite(toMs)) toMs = now;
  let fromMs;
  if (input.from) {
    fromMs = Date.parse(input.from);
    if (!Number.isFinite(fromMs)) fromMs = toMs - DEFAULT_LOOKBACK_HOURS * 3600 * 1000;
  } else {
    const hours = Number(input.lookbackHours);
    const clamped = Number.isFinite(hours) && hours > 0 ? Math.min(hours, MAX_LOOKBACK_HOURS) : DEFAULT_LOOKBACK_HOURS;
    fromMs = toMs - clamped * 3600 * 1000;
  }
  if (toMs - fromMs > MAX_LOOKBACK_HOURS * 3600 * 1000) fromMs = toMs - MAX_LOOKBACK_HOURS * 3600 * 1000;
  if (fromMs > toMs) [fromMs, toMs] = [toMs, fromMs];
  return { fromMs, toMs, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), hours: Math.round(((toMs - fromMs) / 3600000) * 10) / 10 };
}

function toEpochMs(value) {
  if (value == null || value === "") return NaN;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n < 1e12 ? n * 1000 : n;
  }
  return Date.parse(s);
}

/** Fills defaults so every event has the full contract; drops events with no usable time. */
function normalizeEvent(raw, defaults = {}) {
  const epochMs = toEpochMs(raw.epochMs ?? raw.ts ?? raw._time ?? raw.time ?? raw.timestamp);
  if (!Number.isFinite(epochMs)) return null;
  const entities = {};
  for (const [key, value] of Object.entries(raw.entities || {})) {
    if (value == null || value === "") continue;
    entities[key] = String(value).trim();
  }
  return {
    ts: new Date(epochMs).toISOString(),
    epochMs,
    provider: String(raw.provider || defaults.provider || "unknown"),
    platform: String(raw.platform || defaults.platform || "siem"),
    product: String(raw.product || defaults.product || ""),
    kind: String(raw.kind || defaults.kind || "event"),
    severity: normalizeSeverity(raw.severity),
    entities,
    summary: String(raw.summary || "").slice(0, 240),
    raw: raw.raw && typeof raw.raw === "object" ? raw.raw : {},
  };
}

function normalizeSeverity(value) {
  const s = String(value ?? "info").toLowerCase();
  if (/crit|p1|fatal|emerg/.test(s)) return "critical";
  if (/high|error|p2|major/.test(s)) return "high";
  if (/med|warn|p3/.test(s)) return "medium";
  if (/low|p4|minor|notice/.test(s)) return "low";
  return "info";
}

const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function dedupeKey(event) {
  const who = Object.keys(event.entities)
    .sort()
    .map((k) => `${k}=${event.entities[k]}`)
    .join(",");
  return `${event.provider}|${event.platform}|${event.epochMs}|${event.kind}|${event.summary}|${who}`;
}

function eventMentions(event, entity) {
  const needle = entity.value.toLowerCase();
  return Object.values(event.entities).some((value) => String(value).toLowerCase() === needle);
}

// Entity pivots: other users / IPs / hosts that appear on the same evidence
// rows as the seed. These are candidates for the next hop of the investigation;
// they are reported with the row count that supports them, never asserted as
// "the attacker" or similar.
function discoverPivots(events, seed) {
  const counts = new Map();
  const seedValue = seed.value.toLowerCase();
  for (const event of events) {
    for (const [field, value] of Object.entries(event.entities)) {
      const kind = fieldKind(field);
      if (!kind) continue;
      const v = String(value);
      if (v.toLowerCase() === seedValue) continue;
      const key = `${kind}|${v}`;
      const entry = counts.get(key) || { kind, value: v, count: 0, platforms: new Set(), firstSeen: event.ts, lastSeen: event.ts };
      entry.count += 1;
      entry.platforms.add(event.platform);
      if (event.epochMs < Date.parse(entry.firstSeen)) entry.firstSeen = event.ts;
      if (event.epochMs > Date.parse(entry.lastSeen)) entry.lastSeen = event.ts;
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .map((p) => ({ ...p, platforms: [...p.platforms].sort() }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, 25);
}

function fieldKind(field) {
  const f = String(field).toLowerCase();
  if (f === "user" || f === "srcuser" || f === "destuser" || f === "account") return "user";
  if (f.endsWith("ip") || f === "src" || f === "dest") return "ip";
  if (f === "host" || f === "device" || f === "hostname" || f === "desthost" || f === "srchost") return "host";
  return null;
}

function coverageFor(results) {
  return results.map((r) => ({
    provider: r.provider,
    platform: r.platform,
    status: r.status,
    count: Array.isArray(r.events) ? r.events.length : 0,
    error: r.error || "",
    query: r.query || "",
    ms: r.ms ?? null,
  }));
}

// Deterministic observations. Each one is a factual statement about counts or
// ordering in the evidence, with the rows that support it. No inference beyond
// what the timeline literally shows.
function observe(timeline, seed) {
  const notes = [];
  const byPlatform = groupBy(timeline, (e) => e.platform);

  for (const [platform, events] of Object.entries(byPlatform)) {
    const first = events[0];
    const last = events[events.length - 1];
    notes.push({
      kind: "coverage",
      platform,
      text: `${platform}: ${events.length} event${events.length === 1 ? "" : "s"} between ${first.ts} and ${last.ts}.`,
    });
  }

  const identity = byPlatform.identity || [];
  const failures = identity.filter((e) => /fail|denied|invalid|lockout|locked/i.test(`${e.kind} ${e.summary}`));
  const successes = identity.filter((e) => /success|allowed|granted|login\b|logon/i.test(`${e.kind} ${e.summary}`) && !/fail|denied|invalid/i.test(`${e.kind} ${e.summary}`));
  if (failures.length >= 3 && successes.length > 0) {
    const lastFailure = failures[failures.length - 1];
    const firstSuccessAfter = successes.find((s) => s.epochMs >= lastFailure.epochMs);
    if (firstSuccessAfter) {
      notes.push({
        kind: "sequence",
        platform: "identity",
        text: `identity: ${failures.length} failed authentication events, then a successful one at ${firstSuccessAfter.ts}.`,
      });
    }
  }

  const vpn = byPlatform.vpn || [];
  const vpnAssigned = vpn.map((e) => e.entities.assignedIp || "").filter(Boolean);
  if (vpnAssigned.length > 0) {
    const followOn = timeline.filter((e) => e.platform !== "vpn" && vpnAssigned.includes(e.entities.srcIp || ""));
    if (followOn.length > 0) {
      const platforms = [...new Set(followOn.map((e) => e.platform))].sort().join(", ");
      notes.push({
        kind: "pivot",
        platform: "vpn",
        text: `vpn: assigned address ${[...new Set(vpnAssigned)].join(", ")} appears as source on ${followOn.length} later event${followOn.length === 1 ? "" : "s"} (${platforms}).`,
      });
    }
  }

  const fw = byPlatform.firewall || [];
  const denies = fw.filter((e) => /deny|drop|block|reset/i.test(`${e.kind} ${e.summary} ${e.entities.action || ""}`));
  if (denies.length > 0) {
    const dests = topValues(denies.map((e) => e.entities.destIp || e.entities.dest || "").filter(Boolean), 3);
    notes.push({
      kind: "count",
      platform: "firewall",
      text: `firewall: ${denies.length} of ${fw.length} events are deny/drop${dests.length ? ` (top destinations: ${dests.join(", ")})` : ""}.`,
    });
  }

  const proxy = byPlatform.proxy || [];
  const blocked = proxy.filter((e) => /block|denied|deny/i.test(`${e.kind} ${e.summary} ${e.entities.action || ""}`));
  if (blocked.length > 0) {
    const domains = topValues(blocked.map((e) => hostOf(e.entities.url) || e.entities.destHost || "").filter(Boolean), 3);
    notes.push({
      kind: "count",
      platform: "proxy",
      text: `proxy: ${blocked.length} of ${proxy.length} requests were blocked${domains.length ? ` (top: ${domains.join(", ")})` : ""}.`,
    });
  }

  const endpoint = byPlatform.endpoint || [];
  const detections = endpoint.filter((e) => e.severity === "high" || e.severity === "critical");
  if (detections.length > 0) {
    notes.push({
      kind: "count",
      platform: "endpoint",
      text: `endpoint: ${detections.length} high/critical detection${detections.length === 1 ? "" : "s"}; first at ${detections[0].ts}.`,
    });
  }

  const cloud = byPlatform.cloud || [];
  const cloudSensitive = cloud.filter((e) => /iam|policy|key|secret|assume|createuser|attach|putbucket|delete|role/i.test(`${e.kind} ${e.summary}`));
  if (cloudSensitive.length > 0) {
    notes.push({
      kind: "count",
      platform: "cloud",
      text: `cloud: ${cloudSensitive.length} identity/permission-related control-plane event${cloudSensitive.length === 1 ? "" : "s"}.`,
    });
  }

  const worst = timeline.reduce((acc, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[acc] ? e.severity : acc), "info");
  if (timeline.length > 0) {
    notes.unshift({
      kind: "summary",
      platform: "all",
      text: `${timeline.length} correlated event${timeline.length === 1 ? "" : "s"} for ${seed.kind} ${seed.value} across ${Object.keys(byPlatform).length} platform${Object.keys(byPlatform).length === 1 ? "" : "s"}; highest severity ${worst}.`,
    });
  }
  return notes;
}

function hostOf(url) {
  const s = String(url || "");
  if (!s) return "";
  try {
    return new URL(s.includes("://") ? s : `http://${s}`).hostname;
  } catch {
    return s.split("/")[0];
  }
}

function topValues(values, n) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([v, c]) => `${v} (${c})`);
}

function groupBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    (out[key] ||= []).push(item);
  }
  return out;
}

/**
 * Correlates provider results into one investigation.
 * @param {{ entity: any, window?: any, results: ProviderResult[], now?: number, id?: string }} input
 */
function buildInvestigation({ entity, window, results, now = Date.now(), id } = {}) {
  const seed = normalizeEntity(entity);
  if (!seed || !seed.value) {
    return { ok: false, error: "An investigation needs a seed entity: a user, an IP address, or a host." };
  }
  if (!ENTITY_KINDS.includes(seed.kind)) {
    return { ok: false, error: `Unknown entity kind "${seed.kind}". Use one of: ${ENTITY_KINDS.join(", ")}.` };
  }
  const win = resolveWindow(window || {}, now);
  const providerResults = Array.isArray(results) ? results : [];

  const seen = new Set();
  const timeline = [];
  let droppedOutOfWindow = 0;
  let droppedDuplicates = 0;
  for (const result of providerResults) {
    for (const raw of result.events || []) {
      const event = normalizeEvent(raw, { provider: result.provider, platform: result.platform });
      if (!event) continue;
      if (event.epochMs < win.fromMs || event.epochMs > win.toMs) {
        droppedOutOfWindow += 1;
        continue;
      }
      const key = dedupeKey(event);
      if (seen.has(key)) {
        droppedDuplicates += 1;
        continue;
      }
      seen.add(key);
      timeline.push(event);
    }
  }
  timeline.sort((a, b) => a.epochMs - b.epochMs || a.platform.localeCompare(b.platform));
  const truncated = timeline.length > MAX_TIMELINE_ROWS;
  const rows = truncated ? timeline.slice(0, MAX_TIMELINE_ROWS) : timeline;

  const coverage = coverageFor(providerResults);
  const gaps = coverage
    .filter((c) => c.status !== "ok")
    .map((c) => {
      if (c.status === "unconfigured") return `${c.platform} (${c.provider}): not configured - no evidence was collected.`;
      if (c.status === "failed") return `${c.platform} (${c.provider}): query failed - ${c.error || "unknown error"}.`;
      return `${c.platform} (${c.provider}): no events matched ${seed.kind} ${seed.value} in the window.`;
    });

  const directHits = rows.filter((e) => eventMentions(e, seed)).length;
  const fixture = providerResults.some((r) => r.provider === "fixture");

  return {
    ok: true,
    fixture,
    id: id || `INV-${new Date(now).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`,
    generatedAt: new Date(now).toISOString(),
    entity: seed,
    window: win,
    timeline: rows,
    counts: {
      total: timeline.length,
      shown: rows.length,
      directHits,
      byPlatform: Object.fromEntries(Object.entries(groupBy(timeline, (e) => e.platform)).map(([k, v]) => [k, v.length])),
      bySeverity: Object.fromEntries(Object.entries(groupBy(timeline, (e) => e.severity)).map(([k, v]) => [k, v.length])),
      droppedOutOfWindow,
      droppedDuplicates,
      truncated,
    },
    coverage,
    gaps,
    pivots: discoverPivots(rows, seed),
    observations: observe(rows, seed),
  };
}

function shortTs(ts) {
  return String(ts).replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

function mdCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Renders the investigation as the markdown artifact shown in the Observability tab. */
function renderInvestigationMarkdown(inv) {
  if (!inv || inv.ok === false) return `# Investigation\n\n${inv?.error || "No investigation."}`;
  const lines = [];
  lines.push(`# Investigation ${inv.id} - ${inv.entity.kind} \`${inv.entity.value}\``);
  lines.push("");
  lines.push(`Window: ${shortTs(inv.window.from)} to ${shortTs(inv.window.to)} (${inv.window.hours}h). Generated ${shortTs(inv.generatedAt)}.`);
  if (inv.fixture) {
    lines.push("");
    lines.push("> **FIXTURE DATA.** Rows marked provider `fixture` come from the NetJarvis mock lab (NETJARVIS_EVIDENCE_FIXTURE), not from a real system. Use for development and demos only.");
  } else {
    lines.push("Read-only evidence collection. Every row names the provider and platform it came from; nothing here is simulated.");
  }
  lines.push("");

  lines.push("## Summary");
  if (inv.observations.length === 0) {
    lines.push(`No events matched ${inv.entity.kind} ${inv.entity.value} in the window on any configured platform.`);
  } else {
    for (const note of inv.observations) lines.push(`- ${note.text}`);
  }
  lines.push("");

  lines.push("## Coverage");
  lines.push("| Platform | Provider | Status | Events | Time |");
  lines.push("|---|---|---|---|---|");
  for (const c of inv.coverage) {
    const detail = c.status === "failed" && c.error ? ` - ${mdCell(c.error).slice(0, 80)}` : "";
    lines.push(`| ${c.platform} | ${c.provider} | ${c.status}${detail} | ${c.count} | ${c.ms != null ? `${c.ms} ms` : ""} |`);
  }
  lines.push("");

  lines.push(`## Timeline (${inv.counts.shown}${inv.counts.truncated ? ` of ${inv.counts.total}` : ""} events, UTC)`);
  if (inv.counts.droppedDuplicates || inv.counts.droppedOutOfWindow) {
    lines.push(`Dropped before correlation: ${inv.counts.droppedDuplicates} exact duplicate${inv.counts.droppedDuplicates === 1 ? "" : "s"}, ${inv.counts.droppedOutOfWindow} outside the window.`);
  }
  if (inv.timeline.length === 0) {
    lines.push("(no events)");
  } else {
    lines.push("| Time | Platform | Sev | Event | Who / where | Provider |");
    lines.push("|---|---|---|---|---|---|");
    for (const e of inv.timeline) {
      const who = [e.entities.user, e.entities.srcIp, e.entities.destIp && `-> ${e.entities.destIp}`, e.entities.host]
        .filter(Boolean)
        .join(" ");
      lines.push(`| ${shortTs(e.ts)} | ${e.platform} | ${e.severity} | ${mdCell(e.summary || e.kind)} | ${mdCell(who)} | ${e.provider}${e.product ? ` (${e.product})` : ""} |`);
    }
  }
  lines.push("");

  if (inv.pivots.length > 0) {
    lines.push("## Related entities (pivot candidates)");
    lines.push("| Kind | Value | Rows | Platforms | First seen | Last seen |");
    lines.push("|---|---|---|---|---|---|");
    for (const p of inv.pivots.slice(0, 15)) {
      lines.push(`| ${p.kind} | ${mdCell(p.value)} | ${p.count} | ${p.platforms.join(", ")} | ${shortTs(p.firstSeen)} | ${shortTs(p.lastSeen)} |`);
    }
    lines.push("");
  }

  if (inv.gaps.length > 0) {
    lines.push("## Gaps");
    for (const gap of inv.gaps) lines.push(`- ${gap}`);
    lines.push("");
  }

  const queries = inv.coverage.filter((c) => c.query);
  if (queries.length > 0) {
    lines.push("## Queries run (audit)");
    for (const c of queries) {
      lines.push(`- **${c.platform}** via ${c.provider}:`);
      lines.push("");
      lines.push("```");
      lines.push(c.query);
      lines.push("```");
    }
  }
  return lines.join("\n");
}

/** Short spoken/typed summary for voice and chat - facts only. */
function summarizeInvestigation(inv) {
  if (!inv || inv.ok === false) return inv?.error || "The investigation could not be built.";
  const configured = inv.coverage.filter((c) => c.status !== "unconfigured");
  if (configured.length === 0) {
    return `No evidence sources are configured for an investigation into ${inv.entity.kind} ${inv.entity.value}. Set SPLUNK_URL and a token in .env.local to enable the Splunk lenses.`;
  }
  const head = inv.observations.find((n) => n.kind === "summary");
  const parts = [];
  parts.push(head ? head.text : `No events matched ${inv.entity.kind} ${inv.entity.value} in the last ${inv.window.hours}h.`);
  const others = inv.observations.filter((n) => n.kind !== "summary" && n.kind !== "coverage").slice(0, 3);
  for (const n of others) parts.push(n.text);
  if (inv.gaps.length > 0) parts.push(`Gaps: ${inv.gaps.length} platform${inv.gaps.length === 1 ? "" : "s"} returned nothing or are not configured.`);
  if (inv.fixture) parts.unshift("[FIXTURE DATA - mock lab, not a real network]");
  return parts.join(" ");
}

module.exports = {
  PLATFORMS,
  ENTITY_KINDS,
  MAX_LOOKBACK_HOURS,
  DEFAULT_LOOKBACK_HOURS,
  MAX_TIMELINE_ROWS,
  isIpv4,
  normalizeEntity,
  resolveWindow,
  normalizeEvent,
  normalizeSeverity,
  buildInvestigation,
  renderInvestigationMarkdown,
  summarizeInvestigation,
};
