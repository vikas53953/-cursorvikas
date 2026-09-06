import { useMemo, useState } from "react";
import { TopologyMap } from "./TopologyMap";
import { StatusPill, toneFromHealth, toneFromStatus } from "./ui/StatusPill";
import type { DashboardSnapshot } from "../vite-env";

type InventoryPageProps = {
  snapshot: DashboardSnapshot | null;
  onInvestigate?: (name: string) => void;
};

function shortPort(port?: string): string {
  return String(port || "")
    .replace("GigabitEthernet", "Gi")
    .replace("TenGigabitEthernet", "Te")
    .replace("FortyGigabitEthernet", "Fo")
    .replace("HundredGigE", "Hu");
}

export function InventoryPage({ snapshot, onInvestigate }: InventoryPageProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"table" | "topology">("topology");
  const devices = snapshot?.devices || [];
  const links = snapshot?.links || [];
  const unreachable = snapshot?.reachable === false;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((device) =>
      `${device.name} ${device.role} ${device.ip} ${device.site} ${device.platform}`.toLowerCase().includes(q),
    );
  }, [devices, query]);

  return (
    <div className="page inventory-page">
      <header className="page-toolbar">
        <div>
          <p className="page-kicker">Inventory · Catalyst Center</p>
          <h1>Devices and topology</h1>
          <p className="page-sub">{snapshot?.source || "network source"} · {devices.length} devices · {links.length} links</p>
        </div>
        <div className="page-toolbar-actions">
          <div className="ui-seg" role="tablist">
            <button type="button" className={view === "topology" ? "active" : ""} onClick={() => setView("topology")}>
              Topology
            </button>
            <button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}>
              Table
            </button>
          </div>
          <input
            className="ui-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter hostname, IP, role…"
          />
        </div>
      </header>

      {unreachable ? (
        <div className="ui-banner ui-banner-bad">Source unreachable — topology and inventory are empty on purpose.</div>
      ) : null}

      {view === "topology" ? (
        <section className="dashlet">
          <header className="dashlet-head">
            <h2>Layer map</h2>
            <span>Roles stacked the way a campus fabric is built</span>
          </header>
          <TopologyMap devices={filtered} links={links} onSelect={onInvestigate} />
        </section>
      ) : null}

      <section className="dashlet">
        <header className="dashlet-head">
          <h2>Device inventory</h2>
          <span>
            {filtered.length} / {devices.length}
          </span>
        </header>
        {filtered.length === 0 ? (
          <p className="ui-empty">No devices match.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Hostname</th>
                <th>Role</th>
                <th>IP</th>
                <th>Platform</th>
                <th>Health</th>
                <th>CPU</th>
                <th>Memory</th>
                <th>Uptime</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((device) => (
                <tr key={device.id || device.name}>
                  <td>
                    <button type="button" className="linkish" onClick={() => onInvestigate?.(device.name)}>
                      {device.name}
                    </button>
                  </td>
                  <td>{device.role || "—"}</td>
                  <td className="mono">{device.ip || "—"}</td>
                  <td>{device.platform || "—"}</td>
                  <td>
                    <StatusPill tone={toneFromHealth(device.healthScore)} label={device.healthScore != null ? `${device.healthScore}/10` : device.status} />
                  </td>
                  <td>{device.cpu || "—"}</td>
                  <td>{device.memory || "—"}</td>
                  <td>{device.uptime || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="dashlet">
        <header className="dashlet-head">
          <h2>Links</h2>
          <span>{links.length}</span>
        </header>
        {links.length === 0 ? (
          <p className="ui-empty">No link records in this snapshot.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Port</th>
                <th>Target</th>
                <th>Port</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link, index) => (
                <tr key={`${link.source}-${link.target}-${index}`}>
                  <td>{link.source}</td>
                  <td className="mono">{shortPort(link.sourcePort)}</td>
                  <td>{link.target}</td>
                  <td className="mono">{shortPort(link.targetPort)}</td>
                  <td>
                    <StatusPill tone={toneFromStatus(link.status)} label={link.status || "—"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
