// Real Splunk REST client (read-only search only).
//
// Uses the streaming export endpoint so a search runs to completion in a
// single request and returns finalized rows only - no job polling, no previews.
//   POST {SPLUNK_URL}/services/search/jobs/export
//        search=<spl>&output_mode=json&earliest_time=..&latest_time=..&max_count=..
// Auth: SPLUNK_TOKEN (JWT/authentication token -> "Authorization: Bearer") or
// SPLUNK_USERNAME + SPLUNK_PASSWORD (HTTP Basic). TLS verification is ON by
// default; SPLUNK_VERIFY_TLS=false opts out for self-signed lab instances only.
//
// Every SPL string goes through assertReadOnlySpl() before it leaves the box.

const https = require("node:https");
const http = require("node:http");
const { assertReadOnlySpl } = require("../../core/spl-policy.cjs");

const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_MAX_COUNT = 500;

function configFromEnv(env = process.env) {
  const baseUrl = String(env.SPLUNK_URL || "").trim().replace(/\/+$/, "");
  return {
    baseUrl,
    token: String(env.SPLUNK_TOKEN || "").trim(),
    username: String(env.SPLUNK_USERNAME || "").trim(),
    password: String(env.SPLUNK_PASSWORD || ""),
    verifyTls: String(env.SPLUNK_VERIFY_TLS ?? "true").toLowerCase() !== "false",
    timeoutMs: Number(env.SPLUNK_TIMEOUT_MS) > 0 ? Number(env.SPLUNK_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
    maxCount: Number(env.SPLUNK_MAX_COUNT) > 0 ? Number(env.SPLUNK_MAX_COUNT) : DEFAULT_MAX_COUNT,
  };
}

function isConfigured(config) {
  return Boolean(config.baseUrl && (config.token || (config.username && config.password)));
}

function authHeader(config) {
  if (config.token) return `Bearer ${config.token}`;
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
}

// Minimal HTTP transport (injectable for tests). Resolves {status, body}.
function defaultTransport({ url, method, headers, body, timeoutMs, verifyTls }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === "http:" ? http : https;
    const req = lib.request(
      {
        method,
        hostname: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: target.pathname + target.search,
        headers,
        timeout: timeoutMs,
        ...(target.protocol === "https:" ? { rejectUnauthorized: verifyTls } : {}),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Splunk request timed out after ${timeoutMs} ms`)));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Export output is newline-delimited JSON; each line is {preview, offset, result, lastrow?}.
function parseExportBody(text) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (obj && obj.result && obj.preview !== true) rows.push(obj.result);
    else if (obj && Array.isArray(obj.results)) rows.push(...obj.results);
  }
  return rows;
}

function createSplunkClient({ config = configFromEnv(), transport = defaultTransport } = {}) {
  /**
   * Runs a read-only SPL search over [earliestMs, latestMs]. Returns
   * { ok, rows, spl, ms, error? }. Never throws for query/transport failures.
   */
  async function search(spl, { earliestMs, latestMs, maxCount } = {}) {
    const started = Date.now();
    if (!isConfigured(config)) {
      return { ok: false, configured: false, rows: [], spl, ms: 0, error: "Splunk is not configured. Set SPLUNK_URL and SPLUNK_TOKEN (or SPLUNK_USERNAME/SPLUNK_PASSWORD) in .env.local." };
    }
    const verdict = assertReadOnlySpl(spl);
    if (!verdict.ok) return { ok: false, configured: true, rows: [], spl, ms: 0, error: verdict.error };

    const query = String(spl).trim();
    const params = new URLSearchParams();
    params.set("search", query.startsWith("|") || /^search\b/i.test(query) ? query : `search ${query}`);
    params.set("output_mode", "json");
    if (Number.isFinite(earliestMs)) params.set("earliest_time", String(Math.floor(earliestMs / 1000)));
    if (Number.isFinite(latestMs)) params.set("latest_time", String(Math.ceil(latestMs / 1000)));
    params.set("max_count", String(maxCount || config.maxCount));

    try {
      const body = params.toString();
      const response = await transport({
        url: `${config.baseUrl}/services/search/jobs/export`,
        method: "POST",
        headers: {
          Authorization: authHeader(config),
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          Accept: "application/json",
        },
        body,
        timeoutMs: config.timeoutMs,
        verifyTls: config.verifyTls,
      });
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, configured: true, rows: [], spl: query, ms: Date.now() - started, error: `Splunk HTTP ${response.status}: ${String(response.body || "").slice(0, 200)}` };
      }
      return { ok: true, configured: true, rows: parseExportBody(response.body), spl: query, ms: Date.now() - started };
    } catch (error) {
      return { ok: false, configured: true, rows: [], spl: query, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function health() {
    if (!isConfigured(config)) return { ok: false, configured: false, reachable: false, error: "not configured" };
    const started = Date.now();
    try {
      const response = await transport({
        url: `${config.baseUrl}/services/server/info?output_mode=json`,
        method: "GET",
        headers: { Authorization: authHeader(config), Accept: "application/json" },
        timeoutMs: Math.min(config.timeoutMs, 10000),
        verifyTls: config.verifyTls,
      });
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, configured: true, reachable: false, error: `HTTP ${response.status}`, ms: Date.now() - started };
      }
      let version = "";
      try {
        version = JSON.parse(response.body)?.entry?.[0]?.content?.version || "";
      } catch {
        version = "";
      }
      return { ok: true, configured: true, reachable: true, version, ms: Date.now() - started };
    } catch (error) {
      return { ok: false, configured: true, reachable: false, error: error instanceof Error ? error.message : String(error), ms: Date.now() - started };
    }
  }

  return { search, health, configured: () => isConfigured(config), config: { baseUrl: config.baseUrl, verifyTls: config.verifyTls } };
}

module.exports = { createSplunkClient, configFromEnv, isConfigured, parseExportBody, defaultTransport };
