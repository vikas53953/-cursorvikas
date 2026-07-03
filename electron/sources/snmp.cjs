// SNMP adapter (read-only stub for multi-source inventory/health).

async function getSummary() {
  const host = process.env.SNMP_HOST;
  if (!host) {
    return {
      ok: false,
      configured: false,
      error: "SNMP_HOST is not set. Add SNMP_HOST (and optional SNMP_COMMUNITY) to .env.local.",
    };
  }

  // Lightweight placeholder until a native SNMP client is wired in.
  return {
    ok: true,
    configured: true,
    source: "snmp",
    host,
    community: process.env.SNMP_COMMUNITY ? "(set)" : "public",
    note: "SNMP polling stub is active. Install a native SNMP client dependency to return live sysDescr/sysUpTime here.",
    sysDescr: null,
    sysUpTime: null,
  };
}

module.exports = { getSummary };
