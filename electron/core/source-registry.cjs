function createRegistry() {
  const sources = [];
  function register(source) { sources.push(source); return source; }
  function list() { return sources.slice(); }
  async function allDevices() {
    const lists = await Promise.all(sources.map(async (s) => {
      try { return await s.inventory.search(); } catch { return []; }
    }));
    return lists.flat();
  }
  function executorFor(device) {
    const source = sources.find((s) => s.executor.supports(device));
    return source ? source.executor : null;
  }
  async function health() {
    return Promise.all(sources.map(async (s) => ({ id: s.id, domain: s.domain, ...(await s.inventory.health()) })));
  }
  return { register, list, allDevices, executorFor, health };
}

module.exports = { createRegistry };
