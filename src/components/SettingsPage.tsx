import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Globe, Palette as PaletteIcon, Search, Settings, Shield, User } from "lucide-react";
import { NAME_IDEAS, PALETTES, resolveScheme, swatchesFor, type Palette, type PaletteId } from "../theme/palettes";
import type { Prefs } from "../hooks/usePrefs";
import type { DashboardSnapshot } from "../vite-env";

type SettingsPageProps = {
  prefs: Prefs;
  onPrefs: (patch: Partial<Prefs>) => void;
  snapshot: DashboardSnapshot | null;
  onOpenPalette: () => void;
  onBack: () => void;
};

type SectionId = "general" | "profile" | "appearance" | "network" | "jump";

const SECTIONS: Array<{ id: SectionId; label: string; group: "core" | "ops"; icon: typeof Settings; hint: string }> = [
  { id: "general", label: "General", group: "core", icon: Settings, hint: "density console defaults" },
  { id: "profile", label: "Profile", group: "core", icon: User, hint: "name operator assistant" },
  { id: "appearance", label: "Appearance", group: "core", icon: PaletteIcon, hint: "theme palette light dark" },
  { id: "network", label: "Network", group: "ops", icon: Globe, hint: "catalyst fixture splunk source" },
  { id: "jump", label: "Jump", group: "ops", icon: Shield, hint: "search palette page device user ip" },
];

const FAMILIES: Array<{ id: Palette["family"]; label: string }> = [
  { id: "ops", label: "Operations" },
  { id: "classic", label: "Classic" },
  { id: "night", label: "Night" },
  { id: "studio", label: "Studio" },
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function Row({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <strong>{title}</strong>
        {detail ? <p>{detail}</p> : null}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className={`set-toggle ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on} aria-label={label} />
  );
}

export function SettingsPage({ prefs, onPrefs, snapshot, onOpenPalette, onBack }: SettingsPageProps) {
  const [section, setSection] = useState<SectionId>("general");
  const [filter, setFilter] = useState("");
  const live = snapshot?.reachable === true;
  const fixture = Boolean(snapshot?.fixture);
  const scheme = resolveScheme(prefs.displayMode);
  const operatorLocked = prefs.useConsoleAsOperator;
  const q = filter.trim().toLowerCase();

  const visible = useMemo(
    () => SECTIONS.filter((item) => !q || item.label.toLowerCase().includes(q) || item.hint.includes(q)),
    [q],
  );

  const current = SECTIONS.find((item) => item.id === section) || SECTIONS[0];

  function choosePalette(id: PaletteId) {
    onPrefs({ palette: id });
  }

  return (
    <div className="set-stage" role="dialog" aria-modal="true" aria-label="Settings">
      <aside className="set-rail">
        <button type="button" className="set-back" onClick={onBack}>
          <ArrowLeft size={16} />
          Back
        </button>
        <label className="set-search">
          <Search size={15} />
          <input
            name="search-settings"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpenPalette();
            }}
            placeholder="Search Settings"
          />
        </label>
        <nav aria-label="Settings">
          {(["core", "ops"] as const).map((group, index) => {
            const items = visible.filter((item) => item.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                {index > 0 ? <div className="set-sep" /> : null}
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={section === item.id ? "active" : ""}
                      onClick={() => setSection(item.id)}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="set-account">
          <span className="set-avatar">{initials(prefs.operatorName)}</span>
          <div>
            <strong>{prefs.operatorName}</strong>
            <em>Signed in</em>
          </div>
          <span className="set-gear" aria-hidden="true">
            <Settings size={16} />
          </span>
        </div>
      </aside>

      <main className="set-main">
        <h1>{current.label}</h1>

        {section === "general" ? (
          <>
            <section className="set-block">
              <h2>Console</h2>
              <Row title="Density" detail="Compact tightens the rail, tables, and page chrome for a long shift.">
                <select value={prefs.density} onChange={(event) => onPrefs({ density: event.target.value as Prefs["density"] })}>
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </Row>
              <Row title="Keep this look" detail="Remember the current palette and display mode for new sessions.">
                <Toggle on={prefs.pinAppearance} onClick={() => onPrefs({ pinAppearance: !prefs.pinAppearance })} label="Keep this look" />
              </Row>
              <Row title="Highlight recent palettes" detail="Mark the last few themes you picked in Appearance.">
                <Toggle on={prefs.highlightRecent} onClick={() => onPrefs({ highlightRecent: !prefs.highlightRecent })} label="Highlight recent palettes" />
              </Row>
            </section>
            <button type="button" className="set-return" onClick={onBack}>
              Back to console
            </button>
          </>
        ) : null}

        {section === "profile" ? (
          <section className="set-block">
            <h2>Identity</h2>
            <Row title="Console name" detail="Shown on the rail. Pick a short word an operator would say out loud.">
              <input className="set-input" name="product-name" value={prefs.productName} onChange={(event) => onPrefs({ productName: event.target.value })} />
            </Row>
            <div className="name-ideas set-chips">
              {NAME_IDEAS.map((name) => (
                <button key={name} type="button" className={prefs.productName === name ? "active" : ""} onClick={() => onPrefs({ productName: name })}>
                  {name}
                </button>
              ))}
            </div>
            <Row title="Use console name as operator" detail="The signed-in name follows the console name.">
              <Toggle
                on={prefs.useConsoleAsOperator}
                onClick={() => onPrefs({ useConsoleAsOperator: !prefs.useConsoleAsOperator })}
                label="Use console name as operator"
              />
            </Row>
            <Row title="Operator" detail={operatorLocked ? "Following the console name." : "Who is signed in on this seat."}>
              <input
                className="set-input"
                name="operator-name"
                value={prefs.operatorName}
                onChange={(event) => onPrefs({ operatorName: event.target.value })}
                disabled={operatorLocked}
              />
            </Row>
            <Row title="Assistant name" detail="Used in Voice. Default is NetJarvis.">
              <input className="set-input" name="assistant-name" value={prefs.assistantName} onChange={(event) => onPrefs({ assistantName: event.target.value })} />
            </Row>
          </section>
        ) : null}

        {section === "appearance" ? (
          <>
            <section className="set-block">
              <h2>Display</h2>
              <Row title="Display mode" detail="Auto follows the operating system. Light and Dark filter the same gallery.">
                <select value={prefs.displayMode} onChange={(event) => onPrefs({ displayMode: event.target.value as Prefs["displayMode"] })}>
                  <option value="auto">Auto</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </Row>
              <Row title="Palette intensity" detail="How strong the selected theme reads.">
                <select value={prefs.intensity} onChange={(event) => onPrefs({ intensity: event.target.value as Prefs["intensity"] })}>
                  <option value="muted">Muted</option>
                  <option value="standard">Standard</option>
                  <option value="vivid">Vivid</option>
                </select>
              </Row>
            </section>
            {prefs.highlightRecent && prefs.recentPalettes.length > 0 ? (
              <section className="set-block">
                <h2>Recent</h2>
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
              </section>
            ) : null}
            <section className="set-block">
              <h2>Themes</h2>
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
            </section>
          </>
        ) : null}

        {section === "network" ? (
          <section className="set-block">
            <h2>Source</h2>
            <Row
              title="Status"
              detail={`${snapshot?.source || "No source reported yet."}${snapshot?.error ? ` ${snapshot.error}` : ""}`}
            >
              <span className={`set-pill ${live ? "ok" : fixture ? "fixture" : "bad"}`}>
                {live ? "Live" : fixture ? "Fixture lab" : "Unreachable"}
              </span>
            </Row>
            <Row title="Catalyst Center" detail={live ? "Connected." : "Not reachable from this host. Set CATC_* in .env.local."}>
              <span className="set-muted">{live ? "Connected" : "Down"}</span>
            </Row>
            <Row
              title="Mock lab"
              detail={
                fixture
                  ? "Enabled (NETJARVIS_EVIDENCE_FIXTURE). Assurance and Investigate show labelled fixture data."
                  : "Off. Set NETJARVIS_EVIDENCE_FIXTURE=1 to load fixtures/mock-lab. Never presented as live."
              }
            >
              <span className="set-muted">{fixture ? "On" : "Off"}</span>
            </Row>
            <Row title="Splunk" detail="Optional evidence plane. Configure SPLUNK_URL + SPLUNK_TOKEN for live investigations.">
              <span className="set-muted">Optional</span>
            </Row>
          </section>
        ) : null}

        {section === "jump" ? (
          <section className="set-block">
            <h2>Command palette</h2>
            <Row title="Search Settings" detail="Search at the top of this page, or Search on the console rail, opens the same palette. Jump to a page, device, user, or IP.">
              <button type="button" className="set-open" onClick={onOpenPalette}>
                Open
              </button>
            </Row>
          </section>
        ) : null}
      </main>
    </div>
  );
}
