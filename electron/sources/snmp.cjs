// SNMP adapter. Honest until a real client is wired.

async function getSummary() {
  const host = process.env.SNMP_HOST;
  if (!host) {
    return {
      ok: false,
      configured: false,
      error: "SNMP_HOST is not set. Add SNMP_HOST (and optional SNMP_COMMUNITY) to .env.local.",
    };
  }

  return {
    ok: false,
    configured: true,
    source: "snmp",
    host,
    community: process.env.SNMP_COMMUNITY ? "(set)" : "public",
    sysDescr: null,
    sysUpTime: null,
    error: "SNMP is configured but not implemented. No sysDescr/sysUpTime until a native client is wired.",
  };
}

module.exports = { getSummary };
