import type { Theme } from "../hooks/useTheme";
import type { Prefs } from "../hooks/usePrefs";
import type { DashboardSnapshot } from "../vite-env";
import { StatusPill } from "./ui/StatusPill";

type SettingsPageProps = {
  prefs: Prefs;
  onPrefs: (patch: Partial<Prefs>) => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  snapshot: DashboardSnapshot | null;
};

export function SettingsPage({ prefs, onPrefs, theme, onTheme, snapshot }: SettingsPageProps) {
  const live = snapshot?.reachable === true;
  const fixture = Boolean(snapshot?.fixture);

  return (
    <div className="page settings-page">
      <header className="page-toolbar">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Console name, assistant name, operator, and theme. Source status lives here once — not on every chrome edge.</p>
        </div>
      </header>

      <div className="dashlet-grid">
        <section className="dashlet">
          <header className="dashlet-head">
            <h2>Product</h2>
          </header>
          <label className="settings-field">
            Console name
            <input
              className="ui-input"
              name="product-name"
              value={prefs.productName}
              onChange={(event) => onPrefs({ productName: event.target.value })}
            />
          </label>
          <label className="settings-field">
            Assistant name
            <input
              className="ui-input"
              name="assistant-name"
              value={prefs.assistantName}
              onChange={(event) => onPrefs({ assistantName: event.target.value })}
            />
            <small>Used in Voice. Default is NetJarvis.</small>
          </label>
          <label className="settings-field">
            Operator
            <input
              className="ui-input"
              name="operator-name"
              value={prefs.operatorName}
              onChange={(event) => onPrefs({ operatorName: event.target.value })}
            />
          </label>
        </section>

        <section className="dashlet">
          <header className="dashlet-head">
            <h2>Appearance</h2>
          </header>
          <div className="ui-seg" role="tablist" aria-label="Theme">
            <button type="button" className={theme === "light" ? "active" : ""} onClick={() => onTheme("light")}>
              Light
            </button>
            <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => onTheme("dark")}>
              Dark
            </button>
          </div>
          <p className="page-sub" style={{ marginTop: 12 }}>
            Theme used to live in the top bar. It belongs here so every page stays clean.
          </p>
        </section>
      </div>

      <section className="dashlet">
        <header className="dashlet-head">
          <h2>Network source</h2>
          <StatusPill
            tone={live ? "ok" : fixture ? "fixture" : "bad"}
            label={live ? "Live" : fixture ? "Fixture lab" : "Unreachable"}
          />
        </header>
        <p className="page-sub">
          {snapshot?.source || "No source reported yet."}
          {snapshot?.error ? ` ${snapshot.error}` : ""}
        </p>
        <ul className="settings-source-list">
          <li>
            <strong>Catalyst Center</strong>
            <span>{live ? "Connected" : "Not reachable from this host. Set CATC_* in .env.local."}</span>
          </li>
          <li>
            <strong>Mock lab</strong>
            <span>
              {fixture
                ? "Enabled (NETJARVIS_EVIDENCE_FIXTURE). Assurance and Investigate show labelled fixture data."
                : "Off. Set NETJARVIS_EVIDENCE_FIXTURE=1 to load fixtures/mock-lab. Never presented as live."}
            </span>
          </li>
          <li>
            <strong>Splunk</strong>
            <span>Optional evidence plane. Configure SPLUNK_URL + SPLUNK_TOKEN for live investigations.</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
