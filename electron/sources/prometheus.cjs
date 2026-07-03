// Prometheus metrics adapter (read-only stub for multi-source dashboards).

async function getSummary() {
  const url = process.env.PROMETHEUS_URL;
  if (!url) {
    return {
      ok: false,
      configured: false,
      error: "PROMETHEUS_URL is not set. Add it to .env.local to enable Prometheus metrics.",
    };
  }

  try {
    const query = encodeURIComponent('up{job!=""}');
    const response = await fetch(`${url.replace(/\/$/, "")}/api/v1/query?query=${query}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return { ok: false, configured: true, error: `Prometheus query failed: ${response.status}` };
    }
    const data = await response.json();
    const results = Array.isArray(data?.data?.result) ? data.data.result : [];
    const up = results.filter((item) => String(item.value?.[1]) === "1").length;
    const down = results.length - up;
    return {
      ok: true,
      configured: true,
      source: "prometheus",
      targets: results.length,
      up,
      down,
      sample: results.slice(0, 8).map((item) => ({
        metric: item.metric?.instance || item.metric?.job || "target",
        up: String(item.value?.[1]) === "1",
      })),
    };
  } catch (error) {
    return { ok: false, configured: true, error: error instanceof Error ? error.message : String(error) };
  }
}

module.exports = { getSummary };
