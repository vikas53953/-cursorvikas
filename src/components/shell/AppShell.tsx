import type { ReactNode } from "react";
import {
  Layers3,
  LayoutDashboard,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Shield,
  SquareStack,
  Users,
} from "lucide-react";
import { NetworkCore } from "../NetworkCore";
import { BrandMark } from "./BrandMark";
import type { JarvisConnectionState, JarvisMood, MouthShape } from "../../lib/realtime";

export type AppPage = "voice" | "assurance" | "investigate" | "inventory" | "squad" | "work" | "settings";

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
      { id: "work", label: "Work", icon: SquareStack },
    ],
  },
];

const PAGE_CRUMB: Record<AppPage, { section: string; title: string }> = {
  voice: { section: "Assistant", title: "Voice" },
  assurance: { section: "Monitor", title: "Assurance" },
  investigate: { section: "Monitor", title: "Investigate" },
  inventory: { section: "Monitor", title: "Inventory" },
  squad: { section: "Workspace", title: "Squad" },
  work: { section: "Workspace", title: "Work" },
  settings: { section: "Console", title: "Settings" },
};

type AppShellProps = {
  page: AppPage;
  onPage: (page: AppPage) => void;
  productName: string;
  operatorName: string;
  railCollapsed: boolean;
  onToggleRail: () => void;
  onOpenPalette: () => void;
  sourceLabel: string;
  sourceTone: "ok" | "warn" | "bad" | "fixture" | "neutral";
  lookbackHours: number;
  onLookbackHours: (hours: number) => void;
  connectionState: JarvisConnectionState;
  mood: JarvisMood;
  mouthShape: MouthShape;
  children: ReactNode;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function AppShell({
  page,
  onPage,
  productName,
  operatorName,
  railCollapsed,
  onToggleRail,
  onOpenPalette,
  sourceLabel,
  sourceTone,
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
            className="ops-collapse-btn"
            onClick={onToggleRail}
            title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {railCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <button
            type="button"
            className="ops-mark-btn"
            onClick={railCollapsed ? onToggleRail : undefined}
            title={productName}
            aria-label={productName}
          >
            <BrandMark />
          </button>
          <div className="ops-brand-copy">
            <strong>{productName}</strong>
            <em>Operations</em>
          </div>
        </div>
        <button type="button" className="ops-rail-search" onClick={onOpenPalette} aria-label="Search">
          <Search size={16} />
          <span>Search</span>
        </button>
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
        <div className={`ops-account ${page === "settings" ? "active" : ""}`}>
          <span className="ops-account-avatar">{initials(operatorName)}</span>
          <div className="ops-account-copy">
            <strong>{operatorName}</strong>
            <em>Signed in</em>
          </div>
          <button
            type="button"
            className="ops-account-gear"
            onClick={() => onPage("settings")}
            title="Settings"
            aria-label="Settings"
          >
            <Settings size={16} />
          </button>
        </div>
      </aside>

      <header className="ops-topbar">
        <div className="ops-crumb">
          <span>{crumb.section}</span>
          <span className="ops-crumb-sep" />
          <strong>{crumb.title}</strong>
        </div>
        <div className="ops-status">
          <span className={`ops-status-dot ops-status-${sourceTone}`} />
          <span className="ops-status-source" title={sourceLabel}>
            {sourceLabel}
          </span>
          <span className="ops-status-sep" />
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
          <span className="ops-status-sep" />
          <span>{operatorName}</span>
        </div>
        <button type="button" className="ops-orb-chip" onClick={() => onPage("voice")} aria-label="Open voice" title="Voice">
          <NetworkCore mood={mood} mouthShape={mouthShape} compact compactSize="xs" />
          <span>{voiceLive ? "Listening" : "Voice"}</span>
        </button>
      </header>

      <main className={`ops-main ${page === "voice" ? "ops-main-flush" : ""}`}>{children}</main>
    </div>
  );
}
