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

  async function run(text, commands) {
    const scope = await resolveScopeText(text);
    if (scope.total === 0) {
      return { ok: false, error: "No devices matched that scope. Name a device, role, or site to narrow it.", devices: [], results: [] };
    }
    if (scope.exceededHardCap) {
      return { ok: false, error: `That matches ${scope.total} devices — over the ${cfg.hardCap} safety limit. Please narrow the scope.`, devices: [], results: [] };
    }
    const results = await mapLimit(scope.devices, cfg.concurrency, async (device) => {
      const executor = registry.executorFor(device);
      if (!executor) return { host: device.name, ok: false, outputs: {}, error: `No executor for ${device.name}.` };
      return executor.runReadOnly(device, commands);
    });
    return { ok: true, devices: scope.devices, results, capped: scope.capped, total: scope.total };
  }

  return { resolveScope: resolveScopeText, run };
}

module.exports = { createQueryLayer, DEFAULTS };
