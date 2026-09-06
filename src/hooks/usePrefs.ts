import { useCallback, useState } from "react";

export type Prefs = {
  productName: string;
  operatorName: string;
  assistantName: string;
  railCollapsed: boolean;
};

const KEY = "vigil.prefs";
const DEFAULTS: Prefs = {
  productName: "Vigil",
  operatorName: "Operator",
  assistantName: "NetJarvis",
  railCollapsed: false,
};

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      productName: String(parsed.productName || DEFAULTS.productName).trim() || DEFAULTS.productName,
      operatorName: String(parsed.operatorName || DEFAULTS.operatorName).trim() || DEFAULTS.operatorName,
      assistantName: String(parsed.assistantName || DEFAULTS.assistantName).trim() || DEFAULTS.assistantName,
      railCollapsed: Boolean(parsed.railCollapsed),
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

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      writePrefs(next);
      return next;
    });
  }, []);

  return { prefs, update };
}
