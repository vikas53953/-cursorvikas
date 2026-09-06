import type { ReactNode } from "react";
import {
  FileText,
  Layers3,
  LayoutDashboard,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Shield,
  Terminal,
  Users,
} from "lucide-react";
import { NetworkCore } from "../NetworkCore";
import { BrandMark } from "./BrandMark";
import type { JarvisConnectionState, JarvisMood, MouthShape } from "../../lib/realtime";

export type AppPage = "voice" | "assurance" | "investigate" | "inventory" | "squad" | "observability" | "reports" | "settings";

type NavItem = { id: AppPage; label: string; icon: typeof LayoutDashboard };
type NavGroup = { id: string; label: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    id: "assistant",
    label: "Assistant",
    items: [{ id: "voice", label: "Voice", icon: Mic }],
  },
  {
    id: "monitor",
    label: "Monitor",
    items: [
      { id: "assurance", label: "Assurance", icon: LayoutDashboard },
      { id: "investigate", label: "Investigate", icon: Shield },
      { id: "inventory", label: "Inventory", icon: Layers3 },
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { id: "squad", label: "Squad", icon: Users },
      { id: "observability", label: "Observability", icon: Terminal },
      { id: "reports", label: "Reports", icon: FileText },
    ],
  },
];

const PAGE_CRUMB: Record<AppPage, { section: string; title: string }> = {
  voice: { section: "Assistant", title: "Voice" },
  assurance: { section: "Monitor", title: "Assurance" },
  investigate: { section: "Monitor", title: "Investigate" },
  inventory: { section: "Monitor", title: "Inventory" },
  squad: { section: "Workspace", title: "Squad" },
  observability: { section: "Workspace", title: "Observability" },
  reports: { section: "Workspace", title: "Reports" },
  settings: { section: "Console", title: "Settings" },
};

type AppShellProps = {
  page: AppPage;
  onPage: (page: AppPage) => void;
  productName: string;
  railCollapsed: boolean;
  onToggleRail: () => void;
  search: string;
  onSearch: (value: string) => void;
  onSearchSubmit: () => void;
  lookbackHours: number;
  onLookbackHours: (hours: number) => void;
  connectionState: JarvisConnectionState;
  mood: JarvisMood;
  mouthShape: MouthShape;
  children: ReactNode;
};

export function AppShell({
  page,
  onPage,
  productName,
  railCollapsed,
  onToggleRail,
  search,
  onSearch,
  onSearchSubmit,
  lookbackHours,
  onLookbackHours,
  connectionState,
  mood,
  mouthShape,
  children,
}: AppShellProps) {
  const crumb = PAGE_CRUMB[page];
  const voiceLive = connectionState === "connected";

  return (
    <div
      className={`ops-shell ${page === "voice" ? "ops-shell-voice" : ""} ${railCollapsed ? "ops-shell-collapsed" : ""}`}
    >
      <div className="window-drag-strip" aria-hidden="true" />
      <aside className="ops-rail">
        <div className="ops-brand">
          <button
            type="button"
            className="ops-mark-btn"
            onClick={railCollapsed ? onToggleRail : undefined}
            title={railCollapsed ? "Expand sidebar" : productName}
            aria-label={railCollapsed ? "Expand sidebar" : productName}
          >
            <BrandMark />
          </button>
          <div className="ops-brand-copy">
            <strong>{productName}</strong>
            <em>Operations</em>
          </div>
          <button
            type="button"
            className="ops-collapse"
            onClick={onToggleRail}
            aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {railCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        {NAV.map((group) => (
          <nav key={group.id} aria-label={group.label}>
            <p className="ops-nav-label">{group.label}</p>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`${page === item.id ? "active" : ""} ${item.id === "voice" && voiceLive ? "ops-nav-live" : ""}`}
                  onClick={() => onPage(item.id)}
                  title={item.label}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                  {item.id === "voice" && voiceLive ? <i className="ops-live-dot" aria-label="Voice connected" /> : null}
                </button>
              );
            })}
          </nav>
        ))}
        <div className="ops-rail-foot">
          <button
            type="button"
            className={`ops-settings-btn ${page === "settings" ? "active" : ""}`}
            onClick={() => onPage("settings")}
            title="Settings"
          >
            <Settings size={16} />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      <header className="ops-topbar">
        <div className="ops-crumb">
          <span>{crumb.section}</span>
          <span className="ops-crumb-sep" />
          <strong>{crumb.title}</strong>
        </div>
        <form
          className="ops-search"
          onSubmit={(event) => {
            event.preventDefault();
            onSearchSubmit();
          }}
        >
          <Search size={14} />
          <input
            name="global-search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Find a device, user, or IP"
          />
        </form>
        <label className="ops-window">
          <span>Window</span>
          <select value={lookbackHours} onChange={(event) => onLookbackHours(Number(event.target.value))}>
            <option value={1}>Last 1 hour</option>
            <option value={6}>Last 6 hours</option>
            <option value={12}>Last 12 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={72}>Last 72 hours</option>
          </select>
        </label>
        <button type="button" className="ops-orb-chip" onClick={() => onPage("voice")} aria-label="Open voice" title="Voice">
          <NetworkCore mood={mood} mouthShape={mouthShape} compact compactSize="xs" />
          <span>{voiceLive ? "Listening" : "Voice"}</span>
        </button>
      </header>

      <main className={`ops-main ${page === "voice" ? "ops-main-flush" : ""}`}>{children}</main>
    </div>
  );
}
