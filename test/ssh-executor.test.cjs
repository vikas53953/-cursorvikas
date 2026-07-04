const test = require("node:test");
const assert = require("node:assert/strict");
const { createSshExecutor } = require("../electron/sources/executors/ssh-executor.cjs");

const device = { id: "r1", name: "csr1", mgmtIp: "10.0.0.1", platform: "ios-xe", executor: "ssh" };

// Fake transport: returns canned CLI text per command.
const fakeConnect = async () => ({
  exec: async (command) => `output for: ${command}`,
  close: () => {},
});

test("runs read-only commands over the injected transport", async () => {
  const exec = createSshExecutor({ connect: fakeConnect });
  const r = await exec.runReadOnly(device, ["show version"]);
  assert.equal(r.ok, true);
  assert.equal(r.host, "csr1");
  assert.match(r.outputs["show version"], /output for: show version/);
});

test("blocks a mutating command before connecting", async () => {
  let connected = false;
  const exec = createSshExecutor({ connect: async () => { connected = true; return { exec: async () => "", close() {} }; } });
  const r = await exec.runReadOnly(device, ["reload"]);
  assert.equal(r.ok, false);
  assert.equal(connected, false);
});

test("closes the session even when a command errors", async () => {
  let closed = false;
  const connect = async () => ({ exec: async () => { throw new Error("channel failed"); }, close: () => { closed = true; } });
  const exec = createSshExecutor({ connect });
  const r = await exec.runReadOnly({ name: "csr1", platform: "ios-xe", executor: "ssh" }, ["show version"]);
  assert.equal(r.ok, false);
  assert.equal(closed, true);
});

test("times out instead of hanging forever on a stuck command", async () => {
  let closed = false;
  const connect = async () => ({
    exec: () => new Promise(() => {}), // never resolves - simulates a stuck channel
    close: () => { closed = true; },
  });
  const exec = createSshExecutor({ connect, execTimeoutMs: 20 });
  const r = await exec.runReadOnly(device, ["show version"]);
  assert.equal(r.ok, false);
  assert.equal(closed, true);
});
