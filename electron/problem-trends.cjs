// Problem Management Agent trend history from accumulated pre-check snapshots.

const checks = require("./checks.cjs");

function counterTotal(counters) {
  let total = 0;
  for (const host of Object.values(counters || {})) {
    for (const port of Object.values(host || {})) {
      for (const value of Object.values(port || {})) {
        if (typeof value === "number") total += value;
      }
    }
  }
  return total;
}

function deviceHealthScore(devices) {
  if (!devices?.length) return null;
  const healthy = devices.filter((device) => device.status === "ok" || device.reachability === "Reachable").length;
  return Math.round((healthy / devices.length) * 100);
}

async function buildTrendHistory(limit = 12) {
  const snapshots = (await checks.listSnapshots()).slice(-limit);
  const points = [];
  for (const meta of snapshots) {
    const full = await checks.loadSnapshot(meta.id);
    if (!full) continue;
    points.push({
      id: full.id,
      label: full.label,
      at: full.at,
      mode: full.mode,
      devices: full.devices.length,
      interfaces: full.interfaces.length,
      downInterfaces: (full.interfaces || []).filter((iface) => iface.status !== "up").length,
      healthScore: deviceHealthScore(full.devices),
      errorCounterTotal: counterTotal(full.errorCounters),
    });
  }

  const trends = [];
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    const deltas = [];
    if (prev.downInterfaces !== next.downInterfaces) deltas.push(`down interfaces ${prev.downInterfaces} -> ${next.downInterfaces}`);
    if (prev.errorCounterTotal !== next.errorCounterTotal) deltas.push(`error counters ${prev.errorCounterTotal} -> ${next.errorCounterTotal}`);
    if (prev.healthScore != null && next.healthScore != null && prev.healthScore !== next.healthScore) {
      deltas.push(`health score ${prev.healthScore}% -> ${next.healthScore}%`);
    }
    if (deltas.length > 0) {
      trends.push({ from: prev.label, to: next.label, at: next.at, changes: deltas });
    }
  }

  return { points, trends, snapshotCount: points.length };
}

module.exports = { buildTrendHistory };
