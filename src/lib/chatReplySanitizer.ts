// Strip robotic "next steps" sections from squad chat replies. The LLM sometimes
// ignores prompt instructions; this enforces the chatops format server-side.

const SECTION_START =
  /(?:^|\n)(?:#{1,4}\s*|\*\*)?(?:notes?\s+and\s+next\s+steps?|next\s+steps?(?:\s*\([^)]*\))?|recommended\s+actions?|pick\s+one)(?:\*\*)?\s*:?\s*(?:\n|$)/i;

export function sanitizeSquadChatReply(text: string): string {
  const trimmed = String(text || "").trim();
  if (!trimmed) return trimmed;

  const match = trimmed.match(SECTION_START);
  if (!match || match.index === undefined) return trimmed;

  const cut = trimmed.slice(0, match.index).trim();
  return cut || trimmed;
}
