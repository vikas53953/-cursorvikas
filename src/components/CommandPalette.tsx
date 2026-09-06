import { useEffect, useMemo, useRef } from "react";
import { FileText, Layers3, LayoutDashboard, Mic, Search, Settings, Shield, Terminal, Users } from "lucide-react";
import type { AppPage } from "./shell/AppShell";
import { parseSearchSeed, type RecentInvestigation } from "../lib/commandSearch";

type DeviceHit = { name: string; ip?: string; role?: string };

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  query: string;
  onQuery: (value: string) => void;
  devices: DeviceHit[];
  recent: RecentInvestigation[];
  onGoPage: (page: AppPage) => void;
  onInvestigate: (seed: { kind: "user" | "ip" | "host"; value: string }) => void;
  onAsk: (text: string) => void;
};

const PAGES: Array<{ id: AppPage; label: string; hint: string; icon: typeof Search }> = [
  { id: "voice", label: "Voice", hint: "Talk or type to the assistant", icon: Mic },
  { id: "assurance", label: "Assurance", hint: "Network snapshot", icon: LayoutDashboard },
  { id: "investigate", label: "Investigate", hint: "Path and timeline", icon: Shield },
  { id: "inventory", label: "Inventory", hint: "Devices and topology", icon: Layers3 },
  { id: "squad", label: "Squad", hint: "Team board", icon: Users },
  { id: "observability", label: "Observability", hint: "Last tool run", icon: Terminal },
  { id: "reports", label: "Reports", hint: "Saved artifacts", icon: FileText },
  { id: "settings", label: "Settings", hint: "Identity and appearance", icon: Settings },
];

export function CommandPalette({
  open,
  onClose,
  query,
  onQuery,
  devices,
  recent,
  onGoPage,
  onInvestigate,
  onAsk,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();

  const pageHits = useMemo(
    () => PAGES.filter((page) => !q || page.label.toLowerCase().includes(q) || page.hint.toLowerCase().includes(q)),
    [q],
  );
  const deviceHits = useMemo(
    () =>
      devices
        .filter((device) => !q || `${device.name} ${device.ip} ${device.role}`.toLowerCase().includes(q))
        .slice(0, 8),
    [devices, q],
  );
  const recentHits = useMemo(
    () => recent.filter((item) => !q || `${item.kind} ${item.value}`.toLowerCase().includes(q)).slice(0, 5),
    [recent, q],
  );
  const seed = parseSearchSeed(query);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="cmd-overlay" role="dialog" aria-modal="true" aria-label="Command palette">
      <button type="button" className="cmd-backdrop" onClick={onClose} aria-label="Close command palette" />
      <div className="cmd-panel">
        <div className="cmd-search">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              if (seed) {
                onInvestigate(seed);
                return;
              }
              if (query.trim()) onAsk(query.trim());
            }}
            placeholder="Jump to a page, device, user, or IP"
          />
        </div>
        <div className="cmd-body">
          {seed ? (
            <button type="button" className="cmd-row" onClick={() => onInvestigate(seed)}>
              <Shield size={15} />
              <span>
                Investigate {seed.kind} <strong>{seed.value}</strong>
              </span>
            </button>
          ) : null}
          {recentHits.length > 0 ? (
            <section>
              <h3>Last investigations</h3>
              {recentHits.map((item) => (
                <button
                  key={`${item.kind}-${item.value}`}
                  type="button"
                  className="cmd-row"
                  onClick={() => onInvestigate({ kind: item.kind, value: item.value })}
                >
                  <Shield size={15} />
                  <span>
                    {item.kind} <strong>{item.value}</strong>
                  </span>
                  <em>{item.at}</em>
                </button>
              ))}
            </section>
          ) : null}
          {deviceHits.length > 0 ? (
            <section>
              <h3>Devices</h3>
              {deviceHits.map((device) => (
                <button
                  key={device.name}
                  type="button"
                  className="cmd-row"
                  onClick={() => onInvestigate({ kind: "host", value: device.name })}
                >
                  <Layers3 size={15} />
                  <span>
                    <strong>{device.name}</strong>
                    {device.ip ? ` · ${device.ip}` : ""}
                  </span>
                </button>
              ))}
            </section>
          ) : null}
          <section>
            <h3>Pages</h3>
            {pageHits.map((page) => {
              const Icon = page.icon;
              return (
                <button key={page.id} type="button" className="cmd-row" onClick={() => onGoPage(page.id)}>
                  <Icon size={15} />
                  <span>
                    <strong>{page.label}</strong>
                    <em> {page.hint}</em>
                  </span>
                </button>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}
