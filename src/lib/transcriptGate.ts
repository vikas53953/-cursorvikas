import type { TranscriptEntry } from "./realtime";

export type TranscriptCommitKind =
  | "user"
  | "jarvis_final"
  | "jarvis_interim"
  | "system"
  | "tool";

/**
 * Single write path for session transcript.
 * Interim voice narration never commits; only final Jarvis answers do.
 */
export function commitTranscript(
  items: TranscriptEntry[],
  entry: TranscriptEntry,
  kind: TranscriptCommitKind = entry.role === "user"
    ? "user"
    : entry.role === "jarvis"
      ? "jarvis_final"
      : entry.role === "tool"
        ? "tool"
        : "system",
): TranscriptEntry[] {
  if (kind === "jarvis_interim") return items;

  const prev = items[0];
  if (
    kind === "jarvis_final" &&
    prev?.role === "jarvis" &&
    prev.text.trim() === entry.text.trim()
  ) {
    return items;
  }

  return [entry, ...items].slice(0, 80);
}
