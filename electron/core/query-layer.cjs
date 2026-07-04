const { resolveScope } = require("./scope-resolver.cjs");

const DEFAULTS = { interactiveCap: 25, hardCap: 500, concurrency: 10 };

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function createQueryLayer({ registry, config = {} }) {
  const cfg = { ...DEFAULTS, ...config };

  async function resolveScopeText(text) {
    const devices = await registry.allDevices();
    const scoped = resolveScope(text, devices, { cap: cfg.interactiveCap });
    return { ...scoped, exceededHardCap: scoped.total > cfg.hardCap };
  }

  // Shared per-device dispatch: bounded concurrency + per-device isolation so
  // one executor failure never fails the whole run. Used by both run (scoped)
  // and runAll (every device).
  async function executeOn(devices, commands) {
    return mapLimit(devices, cfg.concurrency, async (device) => {
      const executor = registry.executorFor(device);
      if (!executor) return { host: device.name, ok: false, outputs: {}, error: `No executor for ${device.name}.` };
      try {
        return await executor.runReadOnly(device, commands);
      } catch (error) {
        return { host: device.name, ok: false, outputs: {}, error: error instanceof Error ? error.message : String(error) };
      }
    });
  }

  async function run(text, commands) {
    const scope = await resolveScopeText(text);
    if (scope.total === 0) {
      return { ok: false, error: "No devices matched that scope. Name a device, role, or site to narrow it.", devices: [], results: [] };
    }
    if (scope.exceededHardCap) {
      return { ok: false, error: `That matches ${scope.total} devices — over the ${cfg.hardCap} safety limit. Please narrow the scope.`, devices: [], results: [] };
    }
    const results = await executeOn(scope.devices, commands);
    return { ok: true, devices: scope.devices, results, capped: scope.capped, total: scope.total };
  }

  // All-devices entry: every device across every source, subject to the SAME
  // hardCap / interactiveCap / concurrency limits as run.
  async function runAll(commands) {
    const devices = await registry.allDevices();
    if (devices.length === 0) {
      return { ok: false, error: "No devices available.", devices: [], results: [] };
    }
    if (devices.length > cfg.hardCap) {
      return { ok: false, error: `That matches ${devices.length} devices — over the ${cfg.hardCap} safety limit. Please narrow the scope.`, devices: [], results: [] };
    }
    const bounded = devices.slice(0, cfg.interactiveCap);
    const results = await executeOn(bounded, commands);
    return { ok: true, devices: bounded, results, capped: devices.length > bounded.length, total: devices.length };
  }

  return { resolveScope: resolveScopeText, run, runAll };
}

module.exports = { createQueryLayer, DEFAULTS };
