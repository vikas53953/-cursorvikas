const { normalizeDevice } = require("../../core/contracts.cjs");

function createCatalystCenterInventory({ catc, sourceId }) {
  async function search() {
    const rows = await catc.getInventory();
    return rows.map((row) => normalizeDevice(row, { sourceId, executor: "catalyst-center", domain: "data" }));
  }
  async function health() {
    try {
      await catc.checkReachable();
      return { ok: true, reachable: true };
    } catch (error) {
      return { ok: false, reachable: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { search, health };
}

module.exports = { createCatalystCenterInventory };
