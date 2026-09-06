import { NAME_IDEAS, PALETTES, resolveScheme, swatchesFor, type PaletteId } from "../theme/palettes";
import type { Prefs } from "../hooks/usePrefs";

type FirstRunProps = {
  prefs: Prefs;
  onPrefs: (patch: Partial<Prefs>) => void;
  onDone: () => void;
};

export function FirstRun({ prefs, onPrefs, onDone }: FirstRunProps) {
  const scheme = resolveScheme(prefs.displayMode);

  return (
    <div className="first-run" role="dialog" aria-modal="true" aria-label="Set up this console">
      <div className="first-run-card">
        <p className="first-run-kicker">First session</p>
        <h1>Name the console, then pick a look</h1>
        <p className="page-sub">This lands you on Voice. You can change everything later under the signed-in operator.</p>

        <label className="settings-field">
          Console name
          <input
            className="ui-input"
            name="first-run-name"
            value={prefs.productName}
            onChange={(event) => onPrefs({ productName: event.target.value })}
          />
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

        <p className="settings-label">Palette</p>
        <div className="theme-grid">
          {PALETTES.filter((palette) => palette.family === "ops" || palette.id === "tokyo-night" || palette.id === "solarized").map(
            (palette) => {
              const [a, b, c] = swatchesFor(palette, scheme);
              return (
                <button
                  key={palette.id}
                  type="button"
                  className={`theme-card ${prefs.palette === palette.id ? "active" : ""}`}
                  onClick={() => onPrefs({ palette: palette.id as PaletteId })}
                >
                  <span className="theme-swatch" style={{ background: `linear-gradient(90deg, ${a} 0 34%, ${b} 34% 66%, ${c} 66% 100%)` }} />
                  <strong>{palette.label}</strong>
                </button>
              );
            },
          )}
        </div>

        <button type="button" className="ui-btn ui-btn-primary first-run-go" onClick={onDone}>
          Open Voice
        </button>
      </div>
    </div>
  );
}
