// Turns a plain-language reference into a bounded device set, matched against
// real inventory. No hardcoded device-name schemes.
const ROLE_WORDS = { core: "core", edge: "edge", distribution: "distribution", dist: "distribution", access: "access", leaf: "leaf", spine: "spine", firewall: "firewall", fw: "firewall", proxy: "proxy", "load balancer": "loadbalancer", loadbalancer: "loadbalancer", lb: "loadbalancer" };

function resolveScope(text, devices, { cap = Infinity } = {}) {
  const lower = String(text || "").toLowerCase();
  const tokens = lower.split(/[^a-z0-9.\-]+/).filter(Boolean);
  const tokenSet = new Set(tokens);

  // 1. exact name / IP hits (highest precedence)
  let hits = devices.filter((d) => tokenSet.has(String(d.name || "").toLowerCase()) || tokenSet.has(String(d.mgmtIp || "")));

  // 2. role (+ optional site) filter
  if (hits.length === 0) {
    const roles = new Set();
    for (const [word, role] of Object.entries(ROLE_WORDS)) if (lower.includes(word)) roles.add(role);
    const sites = new Set(devices.map((d) => d.site).filter(Boolean).filter((s) => tokenSet.has(s.toLowerCase())));
    if (roles.size > 0) {
      hits = devices.filter((d) => roles.has(d.role) && (sites.size === 0 || sites.has(String(d.site || "").toLowerCase())));
    }
  }

  // 3. name substring fallback: only treat a token as a device-name fragment
  // when it carries a digit or hyphen (sw1, core-r1, fw-1). This avoids
  // English words like "is" false-matching "DIST-SW1".
  if (hits.length === 0) {
    const fragments = tokens.filter((t) => t.length >= 3 && /[0-9-]/.test(t));
    hits = devices.filter((d) => fragments.some((t) => String(d.name || "").toLowerCase().includes(t)));
  }

  const total = hits.length;
  const bounded = hits.slice(0, cap === Infinity ? hits.length : cap);
  return { devices: bounded, total, capped: total > bounded.length };
}

module.exports = { resolveScope };
