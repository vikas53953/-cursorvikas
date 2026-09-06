import type { ReactNode } from "react";
import {
  FileText,
  Layers3,
  LayoutDashboard,
  Mic,
  Moon,
  Search,
  Shield,
  Sun,
  Terminal,
  Users,
} from "lucide-react";
import { NetworkCore } from "../NetworkCore";
import { StatusPill } from "../ui/StatusPill";
import type { Theme } from "../../hooks/useTheme";
import type { JarvisConnectionState, JarvisMood, MouthShape } from "../../lib/realtime";

export type AppPage = "voice" | "assurance" | "investigate" | "inventory" | "squad" | "observability" | "reports";

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
};

type AppShellProps = {
  page: AppPage;
  onPage: (page: AppPage) => void;
  theme: Theme;
  onToggleTheme: () => void;
  sourceLive: boolean | null;
  sourceLabel: string;
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

function BrandMark() {
  return (
    <svg className="ops-mark" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="3" fill="#049fd9" />
      <circle cx="14" cy="14" r="3.2" fill="#fff" />
      <circle cx="6.5" cy="8" r="1.7" fill="#fff" opacity="0.92" />
      <circle cx="21.5" cy="8.5" r="1.7" fill="#fff" opacity="0.92" />
      <circle cx="7" cy="20.5" r="1.7" fill="#fff" opacity="0.92" />
      <circle cx="21" cy="20" r="1.7" fill="#fff" opacity="0.92" />
      <path d="M14 14 L6.5 8 M14 14 L21.5 8.5 M14 14 L7 20.5 M14 14 L21 20" stroke="#fff" strokeWidth="1.15" opacity="0.85" />
    </svg>
  );
}

export function AppShell({
  page,
  onPage,
  theme,
  onToggleTheme,
  sourceLive,
  sourceLabel,
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
    <div className={`ops-shell ${page === "voice" ? "ops-shell-voice" : ""}`}>
      <div className="window-drag-strip" aria-hidden="true" />
      <aside className="ops-rail">
        <div className="ops-brand">
          <BrandMark />
          <div>
            <strong>NetJarvis</strong>
            <em>Operations</em>
          </div>
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
          <StatusPill
            tone={sourceLive == null ? "neutral" : sourceLive ? "ok" : "bad"}
            label={sourceLive == null ? "Source" : sourceLive ? "Live" : "Unreachable"}
            title={sourceLabel}
          />
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
        <button type="button" className="ui-btn ui-btn-ghost" onClick={onToggleTheme} aria-label="Toggle theme">
          {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
        </button>
        <span className="ops-operator" title="Signed-in operator">
          Operator
        </span>
      </header>

      <main className={`ops-main ${page === "voice" ? "ops-main-flush" : ""}`}>{children}</main>
    </div>
  );
}
