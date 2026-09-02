import type { CSSProperties } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, WifiOff } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import { StatusPill, statusTone } from "./ui/StatusPill";
import type { TranscriptEntry } from "../lib/realtime";
import type { DashboardSnapshot } from "../vite-env";

type OpsDashboardProps = {
  snapshot: DashboardSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  sessionLog?: TranscriptEntry[];
};

// Overview page body: status strip, KPI tiles, device table, issues, links, events, session log.
export function OpsDashboard({ snapshot, loading, error, onRefresh, sessionLog = [] }: OpsDashboardProps) {
  if (!snapshot) {
    return (
      <div className="ui-card ui-empty ui-empty-tall">
        <span className="ui-spinner" aria-hidden="true" />
        <strong>{error ? "Dashboard unavailable" : "Contacting the network source…"}</strong>
        {error ? <span>{error}</span> : <span>Inventory, health and issues load from Catalyst Center.</span>}
      </div>
    );
  }

  const unreachable = snapshot.reachable === false;
  const devices = snapshot.devices || [];
  const links = snapshot.links || [];
  const events = snapshot.events || [];
  const issues = snapshot.issues?.items || [];
  const health = snapshot.health || {};
  const overall = snapshot.overall || "healthy";
  const linksUp = links.filter((link) => link.status === "up").length;
  const healthy = health.healthyDevices ?? devices.filter((device) => device.status === "ok").length;
  const score = health.score != null ? Math.round(Number(health.score)) : null;
  const overallTone = unreachable ? "neutral" : overall === "degraded" ? "bad" : overall === "watch" ? "warn" : "ok";
  const overallText = unreachable ? "Source unreachable" : overall === "degraded" ? "Network degraded" : overall === "watch" ? "Network needs attention" : "Network healthy";
  const overallDetail = unreachable
    ? snapshot.error || "No live data is available."
    : `${healthy} of ${devices.length} devices healthy · ${snapshot.issues?.active ?? 0} active issue${(snapshot.issues?.active ?? 0) === 1 ? "" : "s"}`;

  return (
    <div className="overview">
      <section className={`status-strip status-strip-${overallTone}`}>
        <StatusPill tone={unreachable ? "bad" : "ok"} label={unreachable ? "UNREACHABLE" : "LIVE"} />
        <span className="status-sep" aria-hidden="true" />
        <div className="health-ring" style={{ "--v": score ?? 0 } as CSSProperties} aria-label={score != null ? `Health score ${score}` : "Health score unavailable"}>
          <b>{score ?? "--"}</b>
        </div>
        <div className="status-copy">
          <strong>{overallText}</strong>
          <span>{overallDetail}</span>
        </div>
        <div className="status-meta">
          <span>Updated {snapshot.updatedAt} · auto-refresh 30s</span>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={13} className={loading ? "spin" : ""} /> Refresh
          </button>
        </div>
      </section>

      {error && !unreachable ? (
        <div className="ui-banner ui-banner-warn">
          <AlertTriangle size={16} />
          <div>
            <strong>Live source problem.</strong> {error}
          </div>
        </div>
      ) : null}
      {unreachable ? (
        <div className="ui-banner ui-banner-bad">
          <WifiOff size={16} />
          <div>
            <strong>Network source unreachable.</strong> {snapshot.error || "No error detail."} NetJarvis retries automatically and never shows simulated data.
          </div>
        </div>
      ) : null}

      <div className="kpis">
        <Kpi label="Devices" value={devices.length} hint={devices[0]?.platform || "managed"} />
        <Kpi label="Healthy" value={healthy} hint={devices.length ? `${Math.round((healthy / devices.length) * 100)}% of fleet` : "—"} tone={devices.length && healthy === devices.length ? "ok" : undefined} />
        <Kpi label="Issues" value={snapshot.issues?.active ?? 0} hint={issues.some((issue) => issue.priority === "P1") ? "includes P1" : "active"} tone={(snapshot.issues?.active ?? 0) > 0 ? "bad" : undefined} />
        <Kpi label="Links up" value={links.length ? `${linksUp}/${links.length}` : "--"} hint="topology" tone={links.length && linksUp < links.length ? "warn" : undefined} />
        <Kpi label="Events" value={events.length} hint="recent" />
        <Kpi label="Health score" value={score ?? "--"} hint="of 100" />
      </div>

      <div className="overview-grid">
        <section className="ui-card">
          <header className="ui-card-head">
            <h2>
              Devices <em className="ui-count">{devices.length}</em>
            </h2>
          </header>
          {devices.length === 0 ? (
            <div className="ui-empty">
              <strong>No devices</strong>
              <span>{unreachable ? "The network source is unreachable." : "The inventory returned no devices."}</span>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Mgmt IP</th>
                    <th>Platform</th>
                    <th>Status</th>
                    <th className="num">Health</th>
                    <th className="num">CPU</th>
                    <th className="num">Memory</th>
                    <th>Uptime</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((device) => (
                    <tr key={device.id || device.name}>
                      <td>
                        <strong>{device.name}</strong>
                        {device.note ? <div className="cell-note">{device.note}</div> : null}
                      </td>
                      <td className="cap">{device.role || "—"}</td>
                      <td className="mono">{device.ip || "—"}</td>
                      <td>{device.platform || "—"}</td>
                      <td>
                        <StatusPill tone={statusTone(device.status)} label={statusLabel(device.status)} />
                      </td>
                      <td className="num">{device.healthScore ?? "—"}</td>
                      <td className="num">{device.cpu || "—"}</td>
                      <td className="num">{device.memory || "—"}</td>
                      <td>{device.uptime || device.reachability || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="ui-card">
          <header className="ui-card-head">
            <h2>
              Active issues <em className={`ui-count ${issues.length ? "ui-count-bad" : ""}`}>{issues.length}</em>
            </h2>
          </header>
          {issues.length === 0 ? (
            <div className="ui-empty">
              <CheckCircle2 size={26} className="ui-empty-ok" />
              <strong>No active issues</strong>
              <span>{unreachable ? "No data while the source is unreachable." : "Catalyst Center reports a clean board."}</span>
            </div>
          ) : (
            <ul className="issue-list">
              {issues.map((issue, index) => (
                <li key={issue.issueId || issue.id || index}>
                  <StatusPill tone={issue.priority === "P1" ? "bad" : issue.priority === "P2" ? "warn" : "info"} label={issue.priority || "issue"} />
                  <span className="issue-name">{issue.name || issue.issueId}</span>
                  <em>{issue.status || "active"}</em>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="overview-grid overview-grid-even">
        <section className="ui-card">
          <header className="ui-card-head">
            <h2>
              Links <em className="ui-count">{links.length}</em>
            </h2>
          </header>
          {links.length === 0 ? (
            <div className="ui-empty">
              <strong>No topology links</strong>
              <span>{unreachable ? "No data while the source is unreachable." : "Catalyst Center returned no links for this network."}</span>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Device A</th>
                    <th>Port</th>
                    <th>Device B</th>
                    <th>Port</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link, index) => (
                    <tr key={index}>
                      <td>
                        <strong>{link.source}</strong>
                      </td>
                      <td className="mono">{shortPort(link.sourcePort)}</td>
                      <td>
                        <strong>{link.target}</strong>
                      </td>
                      <td className="mono">{shortPort(link.targetPort)}</td>
                      <td>
                        <StatusPill tone={link.status === "up" ? "ok" : "bad"} label={link.status || "unknown"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="ui-card">
          <header className="ui-card-head">
            <h2>
              Recent network events <em className="ui-count">{events.length}</em>
            </h2>
          </header>
          {events.length === 0 ? (
            <div className="ui-empty">
              <strong>No recent events</strong>
              <span>The event series is empty for this window.</span>
            </div>
          ) : (
            <ul className="event-list">
              {events.slice(0, 12).map((event, index) => (
                <li key={index}>
                  <time>{event.time || event.when || ""}</time>
                  <i className={`sev-dot sev-${severityTone(event.severity)}`} aria-hidden="true" />
                  <span className="event-device">{event.device || ""}</span>
                  <span className="event-text">{event.text || event.event || ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <CollapsibleSection title="Live session log" count={sessionLog.length}>
        {sessionLog.length === 0 ? (
          <p className="ui-muted">Nothing yet. Voice and chat turns appear here.</p>
        ) : (
          <ul className="session-list">
            {sessionLog.slice(0, 15).map((entry) => (
              <li key={entry.id} className={`session-${entry.role}`}>
                <time>{entry.at}</time>
                <strong>{entry.role === "jarvis" ? "NetJarvis" : entry.role}</strong>
                <span>{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <article className={`kpi ${tone ? `kpi-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

function statusLabel(status: string): string {
  if (status === "ok") return "Healthy";
  if (status === "warning") return "Watch";
  if (status === "critical") return "Critical";
  return status || "Unknown";
}

function severityTone(severity?: string): string {
  const s = String(severity || "").toLowerCase();
  if (/crit|p1|1$/.test(s)) return "bad";
  if (/high|error|p2|2$/.test(s)) return "bad";
  if (/warn|med|p3|3$/.test(s)) return "warn";
  return "info";
}

function shortPort(port?: string): string {
  return String(port || "—")
    .replace("GigabitEthernet", "Gi")
    .replace("TenGigabitEthernet", "Te")
    .replace("FortyGigabitEthernet", "Fo")
    .replace("HundredGigE", "Hu");
}
