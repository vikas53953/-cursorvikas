export type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "accent" | "fixture";

export function StatusPill({ tone, label, dot = true, title }: { tone: Tone; label: string; dot?: boolean; title?: string }) {
  return (
    <span className={`status-pill sp-${tone}`} title={title}>
      {dot ? <i aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

export function statusTone(status: string | undefined): Tone {
  switch (String(status || "").toLowerCase()) {
    case "ok":
    case "healthy":
    case "up":
    case "done":
    case "reachable":
      return "ok";
    case "warning":
    case "watch":
    case "degraded":
    case "medium":
    case "low":
      return "warn";
    case "critical":
    case "error":
    case "failed":
    case "down":
    case "high":
      return "bad";
    case "info":
    case "in_progress":
    case "running":
      return "info";
    default:
      return "neutral";
  }
}

export function severityTone(severity: string | undefined): Tone {
  switch (String(severity || "").toLowerCase()) {
    case "critical":
    case "high":
      return "bad";
    case "medium":
    case "low":
      return "warn";
    case "info":
      return "info";
    default:
      return "neutral";
  }
}
