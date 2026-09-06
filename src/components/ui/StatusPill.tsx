export type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "fixture";

export function StatusPill({
  tone,
  label,
  dot = true,
  title,
}: {
  tone: Tone;
  label: string;
  dot?: boolean;
  title?: string;
}) {
  return (
    <span className={`status-pill status-pill-${tone}`} title={title}>
      {dot ? <i aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

export function toneFromHealth(score?: number | null): Tone {
  if (score == null) return "neutral";
  if (score >= 8) return "ok";
  if (score >= 4) return "warn";
  return "bad";
}

export function toneFromStatus(status?: string): Tone {
  const s = String(status || "").toLowerCase();
  if (["ok", "up", "healthy", "success", "live", "reachable"].includes(s)) return "ok";
  if (["warn", "warning", "degraded", "empty"].includes(s)) return "warn";
  if (["bad", "down", "critical", "failed", "error", "unreachable", "p1"].includes(s)) return "bad";
  if (["info", "unconfigured"].includes(s)) return "info";
  if (s === "fixture") return "fixture";
  return "neutral";
}

export function toneFromSeverity(severity?: string): Tone {
  const s = String(severity || "").toLowerCase();
  if (s === "critical" || s === "high") return "bad";
  if (s === "medium" || s === "low") return "warn";
  if (s === "info") return "info";
  return "neutral";
}
