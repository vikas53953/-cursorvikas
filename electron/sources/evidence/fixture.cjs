// Mock-lab evidence providers (FIXTURE DATA, opt-in only).
//
// NetJarvis never fabricates data in front of an engineer. The mock lab exists
// so the investigation agent can be developed, demoed and regression-tested
// without a Splunk tenant. It is therefore:
//   - OFF unless NETJARVIS_EVIDENCE_FIXTURE is set ("1"/"true" -> bundled
//     fixtures/mock-lab, or an absolute/relative directory path);
//   - reported under provider id "fixture" in every coverage row, and the
//     investigation artifact carries a FIXTURE banner whenever any row came
//     from it (see core/investigation.cjs renderInvestigationMarkdown).
//
// Fixture file shape (one per platform, fixtures/<lab>/<platform>.json):
//   { platform, devices?: string[], events: [{ offsetMinutes | ts, kind, severity,
//     product?, entities: {...}, summary, raw? }] }
// `offsetMinutes` is relative to "now" so a default 24h window always finds the
// scenario; `ts` is an absolute ISO/epoch timestamp for pinned scenarios.

const fs = require("node:fs");
const path = require("node:path");
const { PLATFORMS } = require("../../core/investigation.cjs");

const DEFAULT_LAB_DIR = path.join(__dirname, "..", "..", "..", "fixtures", "mock-lab");

function fixtureDirFromEnv(env = process.env) {
  const raw = String(env.NETJARVIS_EVIDENCE_FIXTURE || "").trim();
  if (!raw || /^(0|false|off|no)$/i.test(raw)) return null;
  if (/^(1|true|on|yes|mock-lab)$/i.test(raw)) return DEFAULT_LAB_DIR;
  return path.resolve(process.cwd(), raw);
}

function loadLab(dir) {
  const lab = { dir, devices: [], files: [], errors: [] };
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch (error) {
    lab.errors.push(`cannot read fixture dir ${dir}: ${error.message}`);
    return lab;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (error) {
      lab.errors.push(`${name}: ${error.message}`);
      continue;
    }
    if (name === "devices.json") {
      lab.devices = Array.isArray(doc.devices) ? doc.devices : [];
      lab.entities = doc.entities || {};
      lab.name = doc.lab || path.basename(dir);
      continue;
    }
    if (!doc || !PLATFORMS.includes(doc.platform) || !Array.isArray(doc.events)) {
      lab.errors.push(`${name}: expected { platform in ${PLATFORMS.join("|")}, events[] }`);
      continue;
    }
    lab.files.push({ file: name, platform: doc.platform, devices: doc.devices || [], events: doc.events });
  }
  return lab;
}

function eventEpoch(event, now) {
  if (event.offsetMinutes != null && Number.isFinite(Number(event.offsetMinutes))) {
    return now + Number(event.offsetMinutes) * 60000;
  }
  const ts = event.ts ?? event.epochMs;
  if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts;
  return Date.parse(String(ts || ""));
}

function mentions(event, entity) {
  const needle = String(entity.value).toLowerCase();
  return Object.values(event.entities || {}).some((v) => String(v).toLowerCase() === needle);
}

function createFixtureEvidenceProviders({ dir, now = () => Date.now() } = {}) {
  if (!dir) return [];
  const lab = loadLab(dir);
  const providers = lab.files.map((file) => ({
    id: `fixture:${file.platform}`,
    platform: file.platform,
    title: `Mock lab ${file.platform} (${file.file})`,
    fixture: true,
    configured: () => true,
    async collect({ entity, window }) {
      const base = { provider: "fixture", platform: file.platform, query: `fixture ${path.basename(dir)}/${file.file} filtered by ${entity.kind}=${entity.value}` };
      const at = now();
      const events = [];
      for (const raw of file.events) {
        const epochMs = eventEpoch(raw, at);
        if (!Number.isFinite(epochMs)) continue;
        if (epochMs < window.fromMs || epochMs > window.toMs) continue;
        if (!mentions(raw, entity)) continue;
        events.push({
          ts: new Date(epochMs).toISOString(),
          epochMs,
          provider: "fixture",
          platform: file.platform,
          product: String(raw.product || ""),
          kind: String(raw.kind || `${file.platform}.event`),
          severity: raw.severity,
          entities: raw.entities || {},
          summary: String(raw.summary || ""),
          raw: { ...(raw.raw || {}), fixture: file.file },
        });
      }
      return { ...base, status: events.length ? "ok" : "empty", events, ms: 0 };
    },
  }));
  providers.lab = lab;
  return providers;
}

module.exports = { createFixtureEvidenceProviders, fixtureDirFromEnv, loadLab, DEFAULT_LAB_DIR };
