export type SearchSeed = { kind: "user" | "ip" | "host"; value: string };

export function parseSearchSeed(raw: string): SearchSeed | null {
  const value = raw.trim();
  if (!value) return null;
  if (/\s/.test(value) && !/^(?:user|host|ip|investigate)\b/i.test(value)) return null;
  const userMatch = value.match(/^(?:user|investigate(?:\s+user)?)\s+(\S+)$/i);
  if (userMatch) return { kind: "user", value: userMatch[1] };
  const hostMatch = value.match(/^(?:host|investigate\s+host)\s+(\S+)$/i);
  if (hostMatch) return { kind: "host", value: hostMatch[1] };
  const ipMatch = value.match(/^(?:ip|investigate\s+ip)\s+(\S+)$/i);
  if (ipMatch) return { kind: "ip", value: ipMatch[1] };
  if (/^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value)) return { kind: "ip", value };
  if (/[.\-]/.test(value) || /\d$/.test(value)) return { kind: "host", value };
  if (/^investigate\s+/i.test(value)) return { kind: "user", value: value.replace(/^investigate\s+/i, "").trim() };
  return { kind: "user", value };
}

export type RecentInvestigation = SearchSeed & { at: string };

const RECENT_KEY = "vigil.recentInvestigations";

export function readRecentInvestigations(): RecentInvestigation[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentInvestigation[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.value).slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function writeRecentInvestigation(seed: SearchSeed): RecentInvestigation[] {
  const next: RecentInvestigation[] = [
    { ...seed, at: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) },
    ...readRecentInvestigations().filter((item) => !(item.kind === seed.kind && item.value === seed.value)),
  ].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
