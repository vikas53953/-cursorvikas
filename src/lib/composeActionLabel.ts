export function composeActionLabel(draft: string, busy: boolean): string {
  if (busy) return "Running…";
  const text = draft.trim().toLowerCase();
  if (!text) return "Send";

  const sw = text.match(/\b(sw\d+)\b/)?.[1];

  if (sw && (/show\s+ip\s+arp/.test(text) || (/arp/.test(text) && /show/.test(text)))) {
    return `Run ARP on ${sw}`;
  }
  if (sw && (/precheck|pre-check|pre post|prepost/.test(text) || /run\s+precheck/.test(text))) {
    return `Pre-check ${sw}`;
  }
  if (sw && /run_show_command|show\s+/.test(text)) {
    const cmd = text.match(/show\s+[\w\s-|]+/)?.[0]?.trim();
    if (cmd && cmd.length <= 28) return `${sw} · ${cmd}`;
    return `Run on ${sw}`;
  }
  if (text.startsWith("@")) return "Send to agent";
  return "Send";
}
