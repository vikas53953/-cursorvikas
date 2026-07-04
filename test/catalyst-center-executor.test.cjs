const test = require("node:test");
const assert = require("node:assert/strict");
const { createCatalystCenterExecutor } = require("../electron/sources/executors/catalyst-center-executor.cjs");

const device = { id: "u1", name: "sw1", platform: "ios-xe", executor: "catalyst-center" };

test("runReadOnly returns per-command output for the device", async () => {
  const catc = { runCommands: async (uuids, commands) => ({ sw1: { [commands[0]]: "VLAN Name ..." } }) };
  const exec = createCatalystCenterExecutor({ catc });
  const r = await exec.runReadOnly(device, ["show vlan brief"]);
  assert.equal(r.ok, true);
  assert.equal(r.host, "sw1");
  assert.match(r.outputs["show vlan brief"], /VLAN Name/);
});

test("rejects a non-read-only command before calling the device", async () => {
  let called = false;
  const catc = { runCommands: async () => { called = true; return {}; } };
  const exec = createCatalystCenterExecutor({ catc });
  const r = await exec.runReadOnly(device, ["configure terminal"]);
  assert.equal(r.ok, false);
  assert.equal(called, false);
});
