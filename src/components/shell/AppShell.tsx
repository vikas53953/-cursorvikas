import { type FormEvent, type ReactNode, useState } from "react";
import { Activity, FileText, LayoutDashboard, Mic, MicOff, Moon, Search, Sparkles, Sun, Users } from "lucide-react";
import type { JarvisConnectionState, JarvisMood } from "../../lib/realtime";
import type { DashboardSnapshot } from "../../vite-env";
import type { Theme } from "../../hooks/useTheme";

export type PageKey = "overview" | "investigations" | "squad" | "observability" | "reports";

export const PAGES: Array<{ key: PageKey; label: string; title: string; subtitle: string }> = [
  { key: "overview", label: "Overview", title: "Network Overview", subtitle: "Live health, devices, issues and events from the network source" },
  { key: "investigations", label: "Investigations", title: "Investigations", subtitle: "Correlate VPN, proxy, firewall, endpoint, identity, cloud and network evidence for one entity" },
  { key: "squad", label: "Agent Squad", title: "Agent Squad", subtitle: "Specialist agents, live delegation board and squad chat" },
  { key: "observability", label: "Observability", title: "Observability", subtitle: "Current tool output, activity feed and the session audit trail" },
  { key: "reports", label: "Reports", title: "Reports", subtitle: "Every saved report, table, CLI capture and diagram, ready to download" },
];

const NAV_ICONS: Record<PageKey, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  investigations: Search,
  squad: Users,
  observability: Activity,
  reports: FileText,
};

const MOOD_LABEL: Record<JarvisMood, string> = {
  idle: "Standing by",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  working: "Running tools",
  error: "Error",
};

type AppShellProps = {
  page: PageKey;
  onNavigate: (page: PageKey) => void;
  counts?: Partial<Record<PageKey, number>>;
  snapshot: DashboardSnapshot | null;
  connectionState: JarvisConnectionState;
  mood: JarvisMood;
  theme: Theme;
  onToggleTheme: () => void;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onAsk: (message: string) => void | Promise<void>;
  askBusy?: boolean;
  onConnectVoice: () => void;
  onDisconnectVoice: () => void;
  newOutput?: { title: string; onOpen: () => void; onDismiss: () => void } | null;
  children: ReactNode;
  drawer: ReactNode;
};

export function AppShell({
  page,
  onNavigate,
  counts = {},
  snapshot,
  connectionState,
  mood,
  theme,
  onToggleTheme,
  drawerOpen,
  onToggleDrawer,
  onAsk,
  askBusy = false,
  onConnectVoice,
  onDisconnectVoice,
  newOutput,
  children,
  drawer,
}: AppShellProps) {
  const [ask, setAsk] = useState("");
  const live = snapshot?.mode === "live" && snapshot.reachable !== false;
  const sourceLabel = snapshot ? (live ? "LIVE" : "UNREACHABLE") : "CONNECTING";
  const sourceDetail = snapshot?.source?.replace(/^Cisco Catalyst Center \((.*)\)$/, "$1") || "Catalyst Center";
  const connected = connectionState === "connected";
  const connecting = connectionState === "connecting";

  function submitAsk(event: FormEvent) {
    event.preventDefault();
    const trimmed = ask.trim();
    if (!trimmed || askBusy) return;
    setAsk("");
    void onAsk(trimmed);
  }

  return (
    <div className={`shell ${drawerOpen ? "shell-drawer-open" : ""}`}>
      <header className="topbar" role="banner">
        <button type="button" className="brand" onClick={() => onNavigate("overview")} title="NetJarvis home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <circle cx="4" cy="6" r="2" />
              <circle cx="20" cy="6" r="2" />
              <circle cx="4" cy="18" r="2" />
              <circle cx="20" cy="18" r="2" />
              <path d="M6 7l4 3M18 7l-4 3M6 17l4-3M18 17l-4-3" />
            </svg>
          </span>
          <span className="brand-text">
            <strong>NetJarvis</strong>
            <small>Network Operations</small>
          </span>
        </button>

        <form className="topbar-center" onSubmit={submitAsk} role="search">
          <label className="ask">
            <Search size={15} aria-hidden="true" />
            <input
              value={ask}
              onChange={(event) => setAsk(event.target.value)}
              placeholder='Ask NetJarvis — "how is my network doing", "vlans on sw1", "investigate user jdoe"'
              aria-label="Ask NetJarvis"
              disabled={askBusy}
            />
            <kbd>{askBusy ? "…" : "Enter"}</kbd>
          </label>
          {newOutput ? (
            <div className="new-output-chip" role="status">
              <span>New output: {newOutput.title}</span>
              <button type="button" onClick={newOutput.onOpen}>
                View
              </button>
              <button type="button" onClick={newOutput.onDismiss} aria-label="Dismiss">
                ×
              </button>
            </div>
          ) : null}
        </form>

        <div className="topbar-right">
          <span className={`pill ${live ? "pill-live" : snapshot ? "pill-down" : "pill-muted"}`} title={snapshot?.source || "Network source"}>
            <i aria-hidden="true" />
            {sourceLabel} · {sourceDetail}
          </span>
          <button
            type="button"
            className={`pill pill-button ${connected ? `pill-voice-${mood}` : "pill-muted"}`}
            onClick={connected ? onDisconnectVoice : onConnectVoice}
            disabled={connecting}
            title={connected ? "Stop voice" : "Connect voice"}
          >
            {connected ? <Mic size={12} aria-hidden="true" /> : <MicOff size={12} aria-hidden="true" />}
            {connecting ? "Connecting…" : connected ? MOOD_LABEL[mood] : "Voice off"}
          </button>
          <button
            type="button"
            className={`icon-btn ${drawerOpen ? "active" : ""}`}
            onClick={onToggleDrawer}
            aria-pressed={drawerOpen}
            title={drawerOpen ? "Hide assistant" : "Show assistant"}
          >
            <Sparkles size={18} />
          </button>
          <button type="button" className="icon-btn" onClick={onToggleTheme} title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <nav className="nav" aria-label="Primary">
        {PAGES.map((item) => {
          const Icon = NAV_ICONS[item.key];
          const count = counts[item.key];
          return (
            <button
              type="button"
              key={item.key}
              className={`nav-item ${page === item.key ? "current" : ""}`}
              aria-current={page === item.key ? "page" : undefined}
              onClick={() => onNavigate(item.key)}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
              {count ? <em className="nav-count">{count}</em> : null}
            </button>
          );
        })}
        <div className="nav-foot">
          <span>{live ? "Connected to" : "Source"}</span>
          <strong title={snapshot?.source}>{sourceDetail}</strong>
        </div>
      </nav>

      <main className="main" id="main">
        {children}
      </main>

      {drawerOpen ? <aside className="drawer">{drawer}</aside> : null}
    </div>
  );
}

export function PageHeader({ page, actions }: { page: PageKey; actions?: ReactNode }) {
  const meta = PAGES.find((item) => item.key === page)!;
  return (
    <div className="page-head">
      <div>
        <h1>{meta.title}</h1>
        <p>{meta.subtitle}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
