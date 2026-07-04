// SSH executor: runs read-only CLI on a real device, optionally through a jump
// host. The transport is injected as `connect(device)` so the logic is unit-
// testable without a live device; the default transport uses ssh2.
const { assertReadOnly } = require("../../core/read-only-policy.cjs");

function defaultConnect() {
  // Lazy-require so the module loads without ssh2 present (tests inject connect).
  const { Client } = require("ssh2");
  return async function connect(device) {
    const conn = await dial({
      host: process.env.SSH_JUMP_HOST || device.mgmtIp || process.env.SSH_SANDBOX_HOST,
      port: Number(process.env.SSH_SANDBOX_PORT || 22),
      username: process.env.SSH_JUMP_USER || process.env.SSH_SANDBOX_USER,
      password: process.env.SSH_JUMP_PASS || process.env.SSH_SANDBOX_PASS,
    }, Client);
    // NOTE: a real jump-host hop would open a forwarded channel to device.mgmtIp
    // here; for the single-sandbox Phase 1 target we connect directly.
    return {
      exec: (command) => new Promise((resolve, reject) => {
        conn.exec(command, (err, stream) => {
          if (err) return reject(err);
          let out = "";
          stream.on("data", (d) => (out += d)).on("close", () => resolve(out)).stderr.on("data", (d) => (out += d));
        });
      }),
      close: () => conn.end(),
    };
  };
}

function dial(opts, Client) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on("ready", () => resolve(conn)).on("error", reject).connect({ ...opts, readyTimeout: 20000 });
  });
}

function createSshExecutor({ connect = defaultConnect() } = {}) {
  function supports(device) {
    return device && device.executor === "ssh";
  }
  async function runReadOnly(device, commands) {
    for (const command of commands) {
      const verdict = assertReadOnly(device.platform || "ios-xe", command);
      if (!verdict.ok) return { host: device.name, outputs: {}, ok: false, error: verdict.error };
    }
    let session;
    try {
      session = await connect(device);
      const outputs = {};
      for (const command of commands) outputs[command] = await session.exec(command);
      return { host: device.name, outputs, ok: true };
    } catch (error) {
      return { host: device.name, outputs: {}, ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (session) session.close();
    }
  }
  return { supports, runReadOnly };
}

module.exports = { createSshExecutor };
