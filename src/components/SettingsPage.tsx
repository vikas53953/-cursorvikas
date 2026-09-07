import { Search } from "lucide-react";
import { NAME_IDEAS, PALETTES, resolveScheme, swatchesFor, type Palette, type PaletteId } from "../theme/palettes";
import type { Prefs } from "../hooks/usePrefs";
import type { DashboardSnapshot } from "../vite-env";
import { StatusPill } from "./ui/StatusPill";

type SettingsPageProps = {
  prefs: Prefs;
  onPrefs: (patch: Partial<Prefs>) => void;
  snapshot: DashboardSnapshot | null;
  onOpenPalette: () => void;
};

const FAMILIES: Array<{ id: Palette["family"]; label: string }> = [
  { id: "ops", label: "Operations" },
  { id: "classic", label: "Classic" },
  { id: "night", label: "Night" },
  { id: "studio", label: "Studio" },
];

export function SettingsPage({ prefs, onPrefs, snapshot, onOpenPalette }: SettingsPageProps) {
  const live = snapshot?.reachable === true;
  const fixture = Boolean(snapshot?.fixture);
  const scheme = resolveScheme(prefs.displayMode);
  const operatorLocked = prefs.useConsoleAsOperator;

  function choosePalette(id: PaletteId) {
    onPrefs({ palette: id });
  }

  return (
    <div className="page settings-page">
      <header className="page-toolbar">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Identity, appearance, and source. One look for the whole console — rail and top bar included.</p>
        </div>
      </header>

      <button type="button" className="settings-search" onClick={onOpenPalette} aria-label="Search Settings">
        <Search size={16} />
        <span>Search Settings</span>
      </button>

      <section className="dashlet">
        <header className="dashlet-head">
          <h2>Identity</h2>
        </header>
        <label className="settings-field">
          Console name
          <input
            className="ui-input"
            name="product-name"
            value={prefs.productName}
            onChange={(event) => onPrefs({ productName: event.target.value })}
          />
          <small>Shown on the rail. Pick a short word an operator would say out loud.</small>
        </label>
        <div className="name-ideas" role="group" aria-label="Name ideas">
          {NAME_IDEAS.map((name) => (
            <button
              key={name}
              type="button"
              className={prefs.productName === name ? "active" : ""}
              onClick={() => onPrefs({ productName: name })}
            >
              {name}
            </button>
          ))}
        </div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={prefs.useConsoleAsOperator}
            onChange={(event) => onPrefs({ useConsoleAsOperator: event.target.checked })}
          />
          Use console name as operator
        </label>
        <label className="settings-field">
          Operator
          <input
            className="ui-input"
            name="operator-name"
            value={prefs.operatorName}
            onChange={(event) => onPrefs({ operatorName: event.target.value })}
            disabled={operatorLocked}
          />
          <small>{operatorLocked ? "Following the console name." : "Who is signed in on this seat."}</small>
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
      </section>

      <section className="dashlet">
        <header className="dashlet-head">
          <h2>Jump</h2>
        </header>
        <p className="page-sub">Search at the top of the rail, or Search Settings above, opens the same palette. Jump to a page, device, user, or IP.</p>
        <button type="button" className="ui-btn ui-btn-primary" onClick={onOpenPalette}>
          Open command palette
        </button>
      </section>

      <section className="dashlet">
        <header className="dashlet-head">
          <h2>Appearance</h2>
        </header>

        <p className="settings-label">Density</p>
        <div className="ui-seg" role="tablist" aria-label="Density">
          <button type="button" className={prefs.density === "comfortable" ? "active" : ""} onClick={() => onPrefs({ density: "comfortable" })}>
            Comfortable
          </button>
          <button type="button" className={prefs.density === "compact" ? "active" : ""} onClick={() => onPrefs({ density: "compact" })}>
            Compact
          </button>
        </div>
        <p className="page-sub">Compact tightens the rail, tables, and page chrome for a long shift.</p>


        <p className="settings-label">Display mode</p>
        <div className="ui-seg" role="tablist" aria-label="Display mode">
          {(["auto", "light", "dark"] as const).map((mode) => (
            <button key={mode} type="button" className={prefs.displayMode === mode ? "active" : ""} onClick={() => onPrefs({ displayMode: mode })}>
              {mode === "auto" ? "Auto" : mode === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
        <p className="page-sub">Auto follows the operating system. Light and Dark filter the same gallery.</p>

        <p className="settings-label">Palette intensity</p>
        <div className="ui-seg" role="tablist" aria-label="Palette intensity">
          {(["muted", "standard", "vivid"] as const).map((level) => (
            <button key={level} type="button" className={prefs.intensity === level ? "active" : ""} onClick={() => onPrefs({ intensity: level })}>
              {level === "muted" ? "Muted" : level === "vivid" ? "Vivid" : "Standard"}
            </button>
          ))}
        </div>

        {prefs.highlightRecent && prefs.recentPalettes.length > 0 ? (
          <>
            <p className="settings-label">Recent</p>
            <div className="theme-recent">
              {prefs.recentPalettes.map((id) => {
                const palette = PALETTES.find((item) => item.id === id);
                if (!palette) return null;
                const [a, b, c] = swatchesFor(palette, scheme);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`theme-card theme-card-compact ${prefs.palette === id ? "active" : ""}`}
                    onClick={() => choosePalette(id)}
                  >
                    <span className="theme-swatch" style={{ background: `linear-gradient(90deg, ${a} 0 34%, ${b} 34% 66%, ${c} 66% 100%)` }} />
                    <span>{palette.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        <p className="settings-label">Themes</p>
        {FAMILIES.map((family) => {
          const items = PALETTES.filter((palette) => palette.family === family.id);
          return (
            <div key={family.id} className="theme-family">
              <h3>{family.label}</h3>
              <div className="theme-grid">
                {items.map((palette) => {
                  const [a, b, c] = swatchesFor(palette, scheme);
                  const recent = prefs.highlightRecent && prefs.recentPalettes.includes(palette.id);
                  return (
                    <button
                      key={palette.id}
                      type="button"
                      className={`theme-card ${prefs.palette === palette.id ? "active" : ""}`}
                      onClick={() => choosePalette(palette.id)}
                    >
                      <span className="theme-swatch" style={{ background: `linear-gradient(90deg, ${a} 0 34%, ${b} 34% 66%, ${c} 66% 100%)` }} />
                      <strong>
                        {palette.label}
                        {recent ? <em>Recent</em> : null}
                      </strong>
                      <span>{palette.blurb}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <label className="settings-check">
          <input
            type="checkbox"
            checked={prefs.highlightRecent}
            onChange={(event) => onPrefs({ highlightRecent: event.target.checked })}
          />
          Highlight recent palettes
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={prefs.pinAppearance}
            onChange={(event) => onPrefs({ pinAppearance: event.target.checked })}
          />
          Keep this look for new sessions
        </label>
      </section>

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
