const { assertReadOnly } = require("../../core/read-only-policy.cjs");

function createCatalystCenterExecutor({ catc }) {
  function supports(device) {
    return device && device.executor === "catalyst-center";
  }
  async function runReadOnly(device, commands) {
    for (const command of commands) {
      const verdict = assertReadOnly(device.platform || "ios-xe", command);
      if (!verdict.ok) return { host: device.name, outputs: {}, ok: false, error: verdict.error };
    }
    try {
      const result = await catc.runCommands([device.id], commands);
      const outputs = result[device.name] || result[device.id] || {};
      return { host: device.name, outputs, ok: true };
    } catch (error) {
      return { host: device.name, outputs: {}, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { supports, runReadOnly };
}

module.exports = { createCatalystCenterExecutor };
