const test = require("node:test");
const assert = require("node:assert/strict");

test("SNMP without host is unconfigured, not healthy", async () => {
  delete process.env.SNMP_HOST;
  delete require.cache[require.resolve("../electron/sources/snmp.cjs")];
  const snmp = require("../electron/sources/snmp.cjs");
  const summary = await snmp.getSummary();
  assert.equal(summary.ok, false);
  assert.equal(summary.configured, false);
});

test("SNMP with host set still reports not implemented", async () => {
  process.env.SNMP_HOST = "10.0.0.1";
  delete require.cache[require.resolve("../electron/sources/snmp.cjs")];
  const snmp = require("../electron/sources/snmp.cjs");
  const summary = await snmp.getSummary();
  assert.equal(summary.ok, false);
  assert.equal(summary.configured, true);
  assert.equal(summary.sysDescr, null);
  assert.match(String(summary.error), /not implemented|no SNMP client/i);
  delete process.env.SNMP_HOST;
});
