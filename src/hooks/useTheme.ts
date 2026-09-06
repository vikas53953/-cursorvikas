import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "netjarvis.theme";

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    /* ignore */
  }
  return "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  function toggle() {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  }

  return { theme, setTheme, toggle };
}
