import type { ReactNode } from "react";
import {
  Activity,
  FileText,
  Layers3,
  LayoutDashboard,
  Moon,
  Search,
  Shield,
  Sun,
  Terminal,
  Users,
} from "lucide-react";
import { StatusPill } from "../ui/StatusPill";
import type { Theme } from "../../hooks/useTheme";

export type AppPage = "assurance" | "investigate" | "inventory" | "squad" | "observability" | "reports";

const NAV: Array<{ id: AppPage; label: string; hint: string; icon: typeof LayoutDashboard }> = [
  { id: "assurance", label: "Assurance", hint: "Enterprise health", icon: LayoutDashboard },
  { id: "investigate", label: "Investigate", hint: "Path + timeline", icon: Shield },
  { id: "inventory", label: "Inventory", hint: "Devices and topology", icon: Layers3 },
  { id: "squad", label: "Squad", hint: "Agent team board", icon: Users },
  { id: "observability", label: "Observability", hint: "Tool output", icon: Terminal },
  { id: "reports", label: "Reports", hint: "Artifact library", icon: FileText },
];

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
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  children: ReactNode;
};

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
  assistantOpen,
  onToggleAssistant,
  children,
}: AppShellProps) {
  const current = NAV.find((item) => item.id === page);

  return (
    <div className={`ops-shell ${assistantOpen ? "ops-shell-drawer-open" : ""}`}>
      <div className="window-drag-strip" aria-hidden="true" />
      <aside className="ops-rail">
        <div className="ops-brand">
          <span className="ops-mark" aria-hidden="true">
            NJ
          </span>
          <div>
            <strong>NetJarvis</strong>
            <em>Network operations</em>
          </div>
        </div>
        <nav aria-label="Primary">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={page === item.id ? "active" : ""}
                onClick={() => onPage(item.id)}
              >
                <Icon size={16} />
                <span>
                  <b>{item.label}</b>
                  <i>{item.hint}</i>
                </span>
              </button>
            );
          })}
        </nav>
        <button type="button" className="ops-ask" onClick={onToggleAssistant}>
          <Activity size={16} />
          Ask NetJarvis
        </button>
      </aside>

      <header className="ops-topbar">
        <div className="ops-crumb">
          <span>NetJarvis</span>
          <span>/</span>
          <strong>{current?.label || "Assurance"}</strong>
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
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search a device, user, or IP — or ask the assistant"
          />
        </form>
        <label className="ops-window">
          Window
          <select value={lookbackHours} onChange={(event) => onLookbackHours(Number(event.target.value))}>
            <option value={1}>Last 1h</option>
            <option value={6}>Last 6h</option>
            <option value={12}>Last 12h</option>
            <option value={24}>Last 24h</option>
            <option value={72}>Last 72h</option>
          </select>
        </label>
        <StatusPill
          tone={sourceLive == null ? "neutral" : sourceLive ? "ok" : "bad"}
          label={sourceLive == null ? "SOURCE" : sourceLive ? "LIVE" : "UNREACHABLE"}
          title={sourceLabel}
        />
        <button type="button" className="ui-btn ui-btn-ghost" onClick={onToggleTheme} aria-label="Toggle theme">
          {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
        </button>
      </header>

      <main className="ops-main">{children}</main>
    </div>
  );
}
