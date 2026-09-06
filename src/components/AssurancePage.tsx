import { RefreshCw } from "lucide-react";
import { HealthDonut } from "./ui/HealthDonut";
import { StatusPill, toneFromHealth, toneFromStatus } from "./ui/StatusPill";
import type { DashboardEvent, DashboardSnapshot } from "../vite-env";
import type { TranscriptEntry } from "../lib/realtime";

type AssurancePageProps = {
  snapshot: DashboardSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: (force: boolean) => void;
  sessionLog?: TranscriptEntry[];
  onInvestigateDevice?: (name: string) => void;
  assistantName?: string;
  onOpenSettings?: () => void;
};

function eventTone(event: DashboardEvent): "ok" | "warn" | "bad" | "info" | "neutral" {
  const raw = String(event.severity || event.type || "").toLowerCase();
  if (["1", "critical", "p1", "error"].includes(raw)) return "bad";
  if (["2", "high", "major", "p2"].includes(raw)) return "bad";
  if (["3", "medium", "warn", "warning", "p3"].includes(raw)) return "warn";
  if (["4", "low", "minor"].includes(raw)) return "warn";
  if (["5", "info", "audit"].includes(raw) || /audit|aaa/.test(String(event.event || event.text || "").toLowerCase())) return "info";
  return "neutral";
}

function titleCase(value?: string) {
  if (!value) return "";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function AssurancePage({
  snapshot,
  loading,
  error,
  onRefresh,
  sessionLog = [],
  onInvestigateDevice,
  assistantName = "NetJarvis",
  onOpenSettings,
}: AssurancePageProps) {
  if (!snapshot) {
    return (
      <div className="page-loading">
        <div className="progress-pulse" />
        <p>{error ? `Dashboard error: ${error}` : "Contacting Catalyst Center…"}</p>
      </div>
    );
  }

  const fixture = Boolean(snapshot.fixture || snapshot.mode === "fixture");
  const unreachable = snapshot.reachable === false && !fixture;
  const devices = snapshot.devices || [];
  const links = snapshot.links || [];
  const events = snapshot.events || [];
  const issues = snapshot.issues?.items || [];
  const health = snapshot.health || {};
  const overall = snapshot.overall || "unknown";
  const linksDown = links.filter((link) => link.status !== "up").length;
  const healthy = health.healthyDevices ?? devices.filter((device) => device.status === "ok").length;
  const score = health.score ?? null;

  return (
    <div className="page assurance-page">
      <header className="page-toolbar">
        <div>
          <h1>Assurance</h1>
          <p className="page-sub">
            {snapshot.source || "Network source"}
            {snapshot.updatedAt ? ` · updated ${snapshot.updatedAt}` : ""} · refreshes every 30 seconds
          </p>
        </div>
        <div className="page-toolbar-actions">
          <StatusPill
            tone={unreachable ? "bad" : fixture ? "fixture" : "ok"}
            label={unreachable ? "UNREACHABLE" : fixture ? "FIXTURE" : "LIVE"}
          />
          <StatusPill tone={toneFromStatus(overall)} label={overall} />
          <button className="ui-btn" type="button" onClick={() => onRefresh(true)} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      {fixture ? (
        <div className="ui-banner ui-banner-fixture">
          {snapshot.error || "Catalyst Center is unreachable."} Inventory and events below are the opt-in mock lab — not a live network.
        </div>
      ) : null}
      {unreachable ? (
        <div className="ui-banner ui-banner-bad">
          Network source unreachable{snapshot.error ? `: ${snapshot.error}` : ""}. No inventory is invented.
          {onOpenSettings ? (
            <>
              {" "}
              <button type="button" className="linkish" onClick={onOpenSettings}>
                Open Settings
              </button>{" "}
              to enable the mock lab or point at Catalyst Center.
            </>
          ) : null}
        </div>
      ) : null}
      {error && !unreachable && !fixture ? <div className="ui-banner ui-banner-warn">Live source problem: {error}</div> : null}

      <section className="dashlet-row health-row">
        <HealthDonut
          score={score}
          label="Network"
          caption={
            health.totalDevices != null
              ? `${healthy} of ${health.totalDevices} devices healthy`
              : devices.length
                ? `${healthy} of ${devices.length} devices healthy`
                : "No device score yet"
          }
        />
        <HealthDonut
          score={issues.length === 0 && !unreachable ? 10 : issues.length >= 5 ? 2 : issues.length >= 1 ? 5 : null}
          label="Issues"
          caption={`${snapshot.issues?.active ?? issues.length} open`}
        />
        <HealthDonut
          score={links.length === 0 ? null : Math.round(10 * ((links.length - linksDown) / links.length))}
          label="Links"
          caption={links.length ? `${links.length - linksDown} of ${links.length} up` : "No topology yet"}
        />
        <article className="health-donut health-donut-neutral health-stat">
          <div className="health-stat-num">{devices.length || "—"}</div>
          <div>
            <strong>Inventory</strong>
            <p>{unreachable ? "Source down" : fixture ? "Mock-lab devices" : "Managed devices"}</p>
          </div>
        </article>
      </section>

      <div className="dashlet-grid">
        <section className="dashlet">
          <header className="dashlet-head">
            <h2>Network snapshot</h2>
            <span>{devices.length} devices</span>
          </header>
          {devices.length === 0 ? (
            <p className="ui-empty">
              {unreachable
                ? "No devices — Catalyst Center is unreachable, and the mock lab is off."
                : "No devices in the current snapshot."}
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Role</th>
                  <th>Address</th>
                  <th>Health</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.id || device.name}>
                    <td>
                      <button type="button" className="linkish" onClick={() => onInvestigateDevice?.(device.name)}>
                        {device.name}
                      </button>
                    </td>
                    <td>{titleCase(device.role) || "—"}</td>
                    <td className="mono">{device.ip || device.site || "—"}</td>
                    <td>
                      <StatusPill
                        tone={toneFromHealth(device.healthScore)}
                        label={device.healthScore != null ? `${device.healthScore}/10` : "—"}
                      />
                    </td>
                    <td>
                      <StatusPill tone={toneFromStatus(device.status)} label={device.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="dashlet">
          <header className="dashlet-head">
            <h2>Critical issues</h2>
            <span>{issues.length}</span>
          </header>
          {issues.length === 0 ? (
            <p className="ui-empty">
              {fixture ? "No open issues in the mock lab." : "No active issues from Catalyst Center."}
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Issue</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue, index) => (
                  <tr key={issue.issueId || issue.id || index}>
                    <td>
                      <StatusPill tone={toneFromStatus(issue.priority)} label={issue.priority || "issue"} />
                    </td>
                    <td>{issue.name || issue.issueId || "—"}</td>
                    <td>{issue.status || "active"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <div className="dashlet-grid">
        <section className="dashlet">
          <header className="dashlet-head">
            <h2>Recent events</h2>
            <span>{events.length}</span>
          </header>
          {events.length === 0 ? (
            <p className="ui-empty">
              {fixture ? "No mock-lab network events in this window." : "No recent Catalyst Center events."}
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Severity</th>
                  <th>Event</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 12).map((event, index) => (
                  <tr key={index}>
                    <td className="mono">{event.time || event.when || "—"}</td>
                    <td>
                      <StatusPill tone={eventTone(event)} label={String(event.severity || event.type || "info")} />
                    </td>
                    <td>{event.text || event.event || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="dashlet">
          <header className="dashlet-head">
            <h2>Session log</h2>
            <span>{sessionLog.length}</span>
          </header>
          {sessionLog.length === 0 ? (
            <p className="ui-empty">No assistant turns yet.</p>
          ) : (
            <ul className="session-log">
              {sessionLog.slice(0, 12).map((entry) => (
                <li key={entry.id}>
                  <time>{entry.at}</time>
                  <strong>{entry.role === "jarvis" ? assistantName : entry.role}</strong>
                  <span>{entry.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
