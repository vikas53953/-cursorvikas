import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { DashboardSnapshot } from "../vite-env";

const REFRESH_MS = 30000;

export function OpsDashboard() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number>(0);

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    try {
      const data = await window.jarvis.getDashboard({ force });
      if (data.error) {
        setError(data.error);
      } else {
        setSnapshot(data);
        setError(data.liveError || data.staleError || null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    timerRef.current = window.setInterval(() => void load(false), REFRESH_MS);
    return () => window.clearInterval(timerRef.current);
  }, [load]);

  if (!snapshot) {
    return (
      <div className="dash-loading">
        <div className="progress-pulse" />
        <p>{error ? `Dashboard error: ${error}` : "Contacting the network..."}</p>
      </div>
    );
  }

  const devices = snapshot.devices || [];
  const links = snapshot.links || [];
  const events = snapshot.events || [];
  const issues = snapshot.issues?.items || [];
  const health = snapshot.health || {};
  const overall = snapshot.overall || "healthy";

  return (
    <div className="dashboard">
      <header className={`dash-header dash-overall-${overall}`}>
        <div className="dash-headline">
          <span className={`dash-mode dash-mode-${snapshot.mode || "sim"}`}>{snapshot.mode === "live" ? "LIVE" : "SIM"}</span>
          <div>
            <strong>Network {overall}</strong>
            <p>{snapshot.source}</p>
          </div>
        </div>
        <div className="dash-header-right">
          <div className="dash-score">
            <span>{health.score != null ? health.score : "--"}</span>
            <small>health</small>
          </div>
          <button
            className="simple-button dash-refresh"
            onClick={() => void load(true)}
            disabled={loading}
            aria-label="Refresh dashboard"
            title="Refresh now"
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
        </div>
      </header>

      <div className="dash-kpis">
        <div className="dash-kpi">
          <strong>{devices.length}</strong>
          <span>devices</span>
        </div>
        <div className="dash-kpi">
          <strong>{health.healthyDevices ?? devices.filter((device) => device.status === "ok").length}</strong>
          <span>healthy</span>
        </div>
        <div className={snapshot.issues?.active ? "dash-kpi dash-kpi-warn" : "dash-kpi"}>
          <strong>{snapshot.issues?.active ?? 0}</strong>
          <span>issues</span>
        </div>
        <div className="dash-kpi">
          <strong>{links.length > 0 ? `${links.filter((link) => link.status === "up").length}/${links.length}` : "--"}</strong>
          <span>links up</span>
        </div>
      </div>

      {error ? <p className="dash-error">Live source problem: {error}</p> : null}

      <section className="dash-section">
        <h3>Devices</h3>
        <div className="status-grid">
          {devices.map((device) => (
            <article className={`status-tile status-${device.status}`} key={device.id || device.name}>
              <header>
                <strong>{device.name}</strong>
                <span className="status-dot" aria-label={device.status} />
              </header>
              <p className="status-role">
                {[device.role, device.ip || device.site].filter(Boolean).join(" · ")}
              </p>
              <p className="status-stats">
                {[
                  device.cpu ? `CPU ${device.cpu}` : null,
                  device.memory ? `mem ${device.memory}` : null,
                  device.healthScore != null ? `health ${device.healthScore}/10` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || device.reachability}
              </p>
              {device.note ? <p className="status-note">{device.note}</p> : <p className="status-note status-note-clear">{device.uptime ? `up ${device.uptime}` : "No active alerts"}</p>}
            </article>
          ))}
        </div>
      </section>

      {issues.length > 0 ? (
        <section className="dash-section">
          <h3>Active issues</h3>
          <ul className="dash-list">
            {issues.map((issue, index) => (
              <li key={issue.issueId || issue.id || index}>
                <span className="dash-badge">{issue.priority || "issue"}</span> {issue.name || issue.issueId} ({issue.status || "active"})
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {links.length > 0 ? (
        <section className="dash-section">
          <h3>Links</h3>
          <ul className="dash-list dash-links">
            {links.map((link, index) => (
              <li key={index} className={link.status === "up" ? "" : "dash-link-down"}>
                <span>{link.source}</span> {shortPort(link.sourcePort)} — {shortPort(link.targetPort)} <span>{link.target}</span>
                <em>{link.status}</em>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {events.length > 0 ? (
        <section className="dash-section">
          <h3>Recent events</h3>
          <ul className="dash-list dash-events">
            {events.slice(0, 8).map((event, index) => (
              <li key={index}>
                <time>{event.time || event.when || ""}</time>
                <span>{event.text || event.event || ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="dash-footer">Updated {snapshot.updatedAt} · auto-refreshes every 30s</footer>
    </div>
  );
}

function shortPort(port?: string): string {
  return String(port || "")
    .replace("GigabitEthernet", "Gi")
    .replace("TenGigabitEthernet", "Te")
    .replace("FortyGigabitEthernet", "Fo")
    .replace("HundredGigE", "Hu");
}
