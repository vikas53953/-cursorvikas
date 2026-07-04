const { normalizeDevice } = require("../../core/contracts.cjs");

function createCatalystCenterInventory({ catc, sourceId }) {
  async function search() {
    // Use the 60s-cached read path (same as every other inventory consumer) so
    // per-turn scope resolution + runShowCommand don't double the live API load.
    const getRows = typeof catc.getInventoryCached === "function" ? catc.getInventoryCached : catc.getInventory;
    const rows = await getRows();
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
