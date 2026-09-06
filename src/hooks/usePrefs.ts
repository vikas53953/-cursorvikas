import { useCallback, useEffect, useState } from "react";
import {
  applyAppearance,
  PALETTE_BY_ID,
  type DisplayMode,
  type Intensity,
  type PaletteId,
} from "../theme/palettes";

export type Prefs = {
  productName: string;
  operatorName: string;
  assistantName: string;
  railCollapsed: boolean;
  useConsoleAsOperator: boolean;
  displayMode: DisplayMode;
  palette: PaletteId;
  intensity: Intensity;
  recentPalettes: PaletteId[];
  highlightRecent: boolean;
  pinAppearance: boolean;
};

const KEY = "vigil.prefs";
const DEFAULTS: Prefs = {
  productName: "Vigil",
  operatorName: "Operator",
  assistantName: "NetJarvis",
  railCollapsed: false,
  useConsoleAsOperator: false,
  displayMode: "auto",
  palette: "vigil",
  intensity: "standard",
  recentPalettes: ["vigil"],
  highlightRecent: true,
  pinAppearance: true,
};

function asPalette(value: unknown): PaletteId {
  return value && typeof value === "string" && value in PALETTE_BY_ID ? (value as PaletteId) : DEFAULTS.palette;
}

function asDisplay(value: unknown): DisplayMode {
  return value === "light" || value === "dark" || value === "auto" ? value : DEFAULTS.displayMode;
}

function asIntensity(value: unknown): Intensity {
  return value === "muted" || value === "vivid" || value === "standard" ? value : DEFAULTS.intensity;
}

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const pinAppearance = parsed.pinAppearance !== false;
    const palette = pinAppearance ? asPalette(parsed.palette) : DEFAULTS.palette;
    const displayMode = pinAppearance ? asDisplay(parsed.displayMode) : DEFAULTS.displayMode;
    const intensity = pinAppearance ? asIntensity(parsed.intensity) : DEFAULTS.intensity;
    const recent = Array.isArray(parsed.recentPalettes)
      ? parsed.recentPalettes.map(asPalette).filter((id, index, list) => list.indexOf(id) === index).slice(0, 5)
      : DEFAULTS.recentPalettes;
    return {
      productName: String(parsed.productName || DEFAULTS.productName).trim() || DEFAULTS.productName,
      operatorName: String(parsed.operatorName || DEFAULTS.operatorName).trim() || DEFAULTS.operatorName,
      assistantName: String(parsed.assistantName || DEFAULTS.assistantName).trim() || DEFAULTS.assistantName,
      railCollapsed: Boolean(parsed.railCollapsed),
      useConsoleAsOperator: Boolean(parsed.useConsoleAsOperator),
      displayMode,
      palette,
      intensity,
      recentPalettes: recent.length ? recent : DEFAULTS.recentPalettes,
      highlightRecent: parsed.highlightRecent !== false,
      pinAppearance,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function writePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

function withPaletteHistory(current: Prefs, palette: PaletteId): PaletteId[] {
  return [palette, ...current.recentPalettes.filter((id) => id !== palette)].slice(0, 5);
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const initial = readPrefs();
    applyAppearance({ palette: initial.palette, displayMode: initial.displayMode, intensity: initial.intensity });
    return initial;
  });

  useEffect(() => {
    applyAppearance({ palette: prefs.palette, displayMode: prefs.displayMode, intensity: prefs.intensity });
    document.title = `${prefs.productName} — Network operations`;
  }, [prefs.palette, prefs.displayMode, prefs.intensity, prefs.productName]);

  useEffect(() => {
    if (prefs.displayMode !== "auto") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearance({ palette: prefs.palette, displayMode: "auto", intensity: prefs.intensity });
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [prefs.displayMode, prefs.palette, prefs.intensity]);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((current) => {
      const next: Prefs = { ...current, ...patch };
      if (patch.palette && patch.palette !== current.palette) {
        next.recentPalettes = withPaletteHistory(current, patch.palette);
      }
      if (next.useConsoleAsOperator) {
        next.operatorName = next.productName;
      }
      writePrefs(next);
      return next;
    });
  }, []);

  return { prefs, update };
}
