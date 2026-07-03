export type SquadMention = {
  id: string;
  handle: string;
  label: string;
  group?: string;
};

// Slack/Teams-style @handles for the Agent Squad channel.
export const SQUAD_MENTIONS: SquadMention[] = [
  { id: "jarvis", handle: "jarvis", label: "NetJarvis", group: "Lead" },
  { id: "data", handle: "data", label: "Data Network Agent", group: "Data Team" },
  { id: "firewall", handle: "firewall", label: "Firewall Agent", group: "Security Team" },
  { id: "fw", handle: "fw", label: "Firewall Agent", group: "Security Team" },
  { id: "proxy", handle: "proxy", label: "Proxy Agent", group: "Security Team" },
  { id: "loadbalancer", handle: "loadbalancer", label: "Load Balancer Agent", group: "Security Team" },
  { id: "lb", handle: "lb", label: "Load Balancer Agent", group: "Security Team" },
  { id: "security", handle: "security", label: "Security Team", group: "Security Team" },
  { id: "change", handle: "change", label: "Change Management Agent", group: "Incident Management" },
  { id: "incident", handle: "incident", label: "Incident Management Agent", group: "Incident Management" },
  { id: "problem", handle: "problem", label: "Problem Management Agent", group: "Incident Management" },
];

const HANDLE_TO_TEAM: Record<string, string> = {
  jarvis: "jarvis",
  data: "data",
  firewall: "firewall",
  fw: "firewall",
  proxy: "proxy",
  loadbalancer: "loadbalancer",
  lb: "loadbalancer",
  security: "firewall",
  change: "change",
  incident: "incident",
  problem: "problem",
};

const MENTION_PATTERN = /@([a-z][a-z0-9_-]*)/gi;

export function parseMentionHandles(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const handle = match[1]?.toLowerCase();
    if (handle && HANDLE_TO_TEAM[handle]) found.add(handle);
  }
  return [...found];
}

export function resolveMentionTeams(handles: string[]): string[] {
  const teams = new Set<string>();
  for (const handle of handles) {
    const team = HANDLE_TO_TEAM[handle];
    if (team) teams.add(team);
  }
  return [...teams];
}

export function buildMentionPrefix(text: string): string {
  const handles = parseMentionHandles(text);
  if (handles.length === 0) return "";
  const teams = resolveMentionTeams(handles);
  const labels = handles.map((handle) => `@${handle}`).join(", ");
  const teamList = teams.filter((team) => team !== "jarvis").join(", ");
  if (teamList) {
    return `[Squad channel mentions: ${labels}. Delegate to or respond as: ${teamList}.] `;
  }
  return `[Squad channel mention: ${labels}.] `;
}

export function filterMentionSuggestions(query: string): SquadMention[] {
  const needle = query.toLowerCase();
  const seen = new Set<string>();
  return SQUAD_MENTIONS.filter((mention) => {
    if (seen.has(mention.id)) return false;
    seen.add(mention.id);
    return mention.handle.startsWith(needle) || mention.label.toLowerCase().includes(needle);
  }).slice(0, 8);
}

export function splitMentionText(text: string): Array<{ type: "text" | "mention"; value: string; handle?: string }> {
  const parts: Array<{ type: "text" | "mention"; value: string; handle?: string }> = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, index) });
    }
    const handle = match[1]?.toLowerCase() || "";
    parts.push({
      type: "mention",
      value: match[0],
      handle: HANDLE_TO_TEAM[handle] ? handle : undefined,
    });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }
  return parts.length > 0 ? parts : [{ type: "text", value: text }];
}
