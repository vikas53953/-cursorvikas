import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import type { TranscriptEntry } from "../lib/realtime";
import type { DashboardSnapshot } from "../vite-env";

const REFRESH_MS = 30000;

type OpsDashboardProps = {
  sessionLog?: TranscriptEntry[];
  expanded?: boolean;
};

// Production NOC-style network operations dashboard — KPIs always visible, detail in collapsible sections.
export function OpsDashboard({ sessionLog = [], expanded = false }: OpsDashboardProps) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number>(0);
  const retryRef = useRef<number>(0);

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
      window.clearTimeout(retryRef.current);
      retryRef.current = window.setTimeout(() => void load(force), 5000);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    timerRef.current = window.setInterval(() => void load(false), REFRESH_MS);
    return () => {
      window.clearInterval(timerRef.current);
      window.clearTimeout(retryRef.current);
    };
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
  const linksDown = links.filter((link) => link.status !== "up").length;

  return (
    <div className={`dashboard noc-dashboard ${expanded ? "noc-dashboard-expanded" : ""}`}>
      <header className={`noc-command-bar dash-overall-${overall}`}>
        <div className="noc-command-left">
          <span className={`dash-mode dash-mode-${snapshot.mode || "sim"}`}>{snapshot.mode === "live" ? "LIVE" : "SIM"}</span>
          <div>
            <strong>Network Operations Center</strong>
            <p>
              {snapshot.source} · <em className={`noc-overall noc-overall-${overall}`}>{overall}</em>
            </p>
          </div>
        </div>
        <div className="noc-command-right">
          <div className="dash-score">
            <span>{health.score != null ? health.score : "--"}</span>
            <small>health</small>
          </div>
          <button className="simple-button dash-refresh" onClick={() => void load(true)} disabled={loading} title="Refresh now">
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
        </div>
      </header>

      <div className="noc-kpi-ribbon">
        <article className="noc-kpi">
          <strong>{devices.length}</strong>
          <span>Devices</span>
        </article>
        <article className="noc-kpi">
          <strong>{health.healthyDevices ?? devices.filter((device) => device.status === "ok").length}</strong>
          <span>Healthy</span>
        </article>
        <article className={snapshot.issues?.active ? "noc-kpi noc-kpi-alert" : "noc-kpi"}>
          <strong>{snapshot.issues?.active ?? 0}</strong>
          <span>Issues</span>
        </article>
        <article className="noc-kpi">
          <strong>{links.length > 0 ? `${links.length - linksDown}/${links.length}` : "--"}</strong>
          <span>Links up</span>
        </article>
        <article className="noc-kpi">
          <strong>{events.length}</strong>
          <span>Events</span>
        </article>
      </div>

      {error ? <p className="dash-error">Live source problem: {error}</p> : null}

      <CollapsibleSection title="Devices" count={devices.length} defaultOpen={expanded}>
        <div className="status-grid noc-device-grid">
          {devices.map((device) => (
            <article className={`status-tile status-${device.status}`} key={device.id || device.name}>
              <header>
                <strong>{device.name}</strong>
                <span className="status-dot" aria-label={device.status} />
              </header>
              <p className="status-role">{[device.role, device.ip || device.site].filter(Boolean).join(" · ")}</p>
              <p className="status-stats">
                {[device.cpu ? `CPU ${device.cpu}` : null, device.memory ? `mem ${device.memory}` : null, device.healthScore != null ? `health ${device.healthScore}/10` : null]
                  .filter(Boolean)
                  .join(" · ") || device.reachability}
              </p>
              {device.note ? <p className="status-note">{device.note}</p> : <p className="status-note status-note-clear">{device.uptime ? `up ${device.uptime}` : "Clear"}</p>}
            </article>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Active issues" count={issues.length} badge={issues.length > 0 ? "alert" : undefined} defaultOpen={issues.length > 0 && expanded}>
        {issues.length === 0 ? <p className="noc-empty">No active issues.</p> : (
          <ul className="dash-list noc-table-list">
            {issues.map((issue, index) => (
              <li key={issue.issueId || issue.id || index}>
                <span className="dash-badge">{issue.priority || "issue"}</span>
                <span>{issue.name || issue.issueId}</span>
                <em>{issue.status || "active"}</em>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Links" count={links.length} defaultOpen={linksDown > 0}>
        <ul className="dash-list dash-links noc-table-list">
          {links.map((link, index) => (
            <li key={index} className={link.status === "up" ? "" : "dash-link-down"}>
              <span>{link.source}</span>
              <span>
                {shortPort(link.sourcePort)} — {shortPort(link.targetPort)}
              </span>
              <span>{link.target}</span>
              <em>{link.status}</em>
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Recent network events" count={events.length}>
        <ul className="dash-list dash-events noc-table-list">
          {events.slice(0, 12).map((event, index) => (
            <li key={index}>
              <time>{event.time || event.when || ""}</time>
              <span>{event.text || event.event || ""}</span>
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Live session log" count={sessionLog.length}>
        <ul className="dash-list dash-session noc-table-list">
          {sessionLog.slice(0, 15).map((entry) => (
            <li key={entry.id} className={`dash-session-${entry.role}`}>
              <time>{entry.at}</time>
              <strong>{entry.role === "jarvis" ? "Jarvis" : entry.role}</strong>
              <span>{entry.text}</span>
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <footer className="dash-footer">Updated {snapshot.updatedAt} · auto-refresh 30s · expand sections as needed</footer>
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
