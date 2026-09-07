import { resolveScheme, type DisplayMode, type Scheme } from "../theme/palettes";

/** @deprecated Appearance now lives on usePrefs. Kept so existing imports typecheck. */
export type Theme = Scheme;

export function useTheme() {
  const scheme = resolveScheme("auto");
  return {
    theme: scheme,
    setTheme: (_theme: Theme) => {
      /* appearance is owned by Settings / usePrefs */
    },
    toggle: () => {
      /* appearance is owned by Settings / usePrefs */
    },
    displayMode: "auto" as DisplayMode,
  };
}
