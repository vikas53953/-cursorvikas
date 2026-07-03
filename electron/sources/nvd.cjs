// NVD (National Vulnerability Database) adapter - keyless CVE lookups.
// Used by the vulnerability_check tool to ground "any vulnerabilities on
// these switches?" questions in real data instead of guesses.

const logger = require("../logger.cjs");

const NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";

function severityOf(cve) {
  const metrics = cve.metrics || {};
  for (const key of ["cvssMetricV40", "cvssMetricV31", "cvssMetricV30", "cvssMetricV2"]) {
    const entry = metrics[key]?.[0];
    if (entry) {
      return {
        severity: entry.cvssData?.baseSeverity || entry.baseSeverity || "",
        score: entry.cvssData?.baseScore ?? null,
      };
    }
  }
  return { severity: "", score: null };
}

// Searches recent CVEs by keyword (e.g. "Cisco IOS XE"). windowDays is capped
// at 120 by the NVD API for date-range queries.
async function searchCves(keyword, { windowDays = 119, limit = 15 } = {}) {
  const end = new Date();
  const start = new Date(end.getTime() - Math.min(119, windowDays) * 24 * 3600 * 1000);
  const fmt = (date) => `${date.toISOString().slice(0, 19)}.000`;
  const url =
    `${NVD_URL}?keywordSearch=${encodeURIComponent(keyword)}` +
    `&pubStartDate=${fmt(start)}&pubEndDate=${fmt(end)}&resultsPerPage=${Math.min(50, limit * 2)}`;

  const started = Date.now();
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
  logger.log("nvd.http", { keyword, status: response.status, ms: Date.now() - started });
  if (!response.ok) {
    throw new Error(`NVD query failed with status ${response.status}. The service rate-limits aggressively; try again in a minute.`);
  }
  const data = await response.json();

  const rows = (data.vulnerabilities || []).map((entry) => {
    const cve = entry.cve;
    const { severity, score } = severityOf(cve);
    const description = (cve.descriptions || []).find((item) => item.lang === "en")?.value || "";
    return {
      id: cve.id,
      published: (cve.published || "").slice(0, 10),
      severity,
      score,
      description,
      url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
    };
  });

  const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, "": 4 };
  rows.sort((a, b) => (rank[a.severity] ?? 4) - (rank[b.severity] ?? 4) || String(b.published).localeCompare(String(a.published)));
  return { totalInWindow: data.totalResults ?? rows.length, windowDays: Math.min(119, windowDays), cves: rows.slice(0, limit) };
}

module.exports = { searchCves };
