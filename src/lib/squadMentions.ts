import type { AgentOrg } from "../vite-env";

export type SquadMention = {
  id: string;
  handle: string;
  label: string;
  group?: string;
};

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

// Handles registered at runtime (built-in teams plus any custom agents the
// engineer created). Used to validate mentions and build delegation prefixes.
const knownHandles = new Set<string>(Object.keys(HANDLE_TO_TEAM));

export function registerMemberHandles(handles: string[]): void {
  for (const handle of handles) {
    if (handle) knownHandles.add(handle.toLowerCase());
  }
}

function isKnownHandle(handle: string): boolean {
  return knownHandles.has(handle.toLowerCase());
}

const MENTION_PATTERN = /@([a-z][a-z0-9_-]*)/gi;

export function buildMemberMentions(
  targets: Array<{ id: string; name: string; scope?: string }>,
  org: AgentOrg | null,
): SquadMention[] {
  const groupName = (id: string) => {
    if (id === "jarvis") return "Lead";
    for (const group of org?.groups || []) {
      if (group.agents.some((agent) => agent.id === id)) return group.name;
    }
    return "Squad";
  };

  return targets.map((target) => ({
    id: target.id,
    handle: target.id,
    label: target.name,
    group: groupName(target.id),
  }));
}

export function filterMemberMentions(members: SquadMention[], query: string): SquadMention[] {
  const needle = query.toLowerCase();
  return members.filter(
    (member) =>
      !needle ||
      member.handle.startsWith(needle) ||
      member.label.toLowerCase().includes(needle) ||
      member.group?.toLowerCase().includes(needle),
  );
}

export function parseMentionHandles(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const handle = match[1]?.toLowerCase();
    if (handle && isKnownHandle(handle)) found.add(handle);
  }
  return [...found];
}

export function resolveMentionTeams(handles: string[]): string[] {
  const teams = new Set<string>();
  for (const handle of handles) {
    // Built-in aliases (fw -> firewall) map through HANDLE_TO_TEAM; custom
    // agents route to their own handle.
    teams.add(HANDLE_TO_TEAM[handle] || handle);
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
      handle: isKnownHandle(handle) ? handle : undefined,
    });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }
  return parts.length > 0 ? parts : [{ type: "text", value: text }];
}
