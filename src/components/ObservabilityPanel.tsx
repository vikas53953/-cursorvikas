import { formatToolTechnical } from "../lib/observability";
import type { TranscriptEntry } from "../lib/realtime";
import type { JarvisArtifact } from "../vite-env";

export { formatToolTechnical };

export type ObservabilityEvent = {
  id: string;
  at: string;
  role: "tool" | "jarvis" | "user" | "system" | "artifact";
  narrative: string;
  technical?: string;
  status?: "running" | "done" | "error";
  tool?: string;
};

type ObservabilityPanelProps = {
  events: ObservabilityEvent[];
  artifact: JarvisArtifact | null;
  sessionLog: TranscriptEntry[];
};

// Live ops stream: technical command/output plus plain-English narrative.
export function ObservabilityPanel({ events, artifact, sessionLog }: ObservabilityPanelProps) {
  const feed = events.length > 0 ? events : fallbackFromTranscript(sessionLog);

  return (
    <div className="observability-panel">
      <header className="observability-header">
        <div>
          <h3>Live observability stream</h3>
          <p>Technical command/output on the left of each event; narrative summary for quick reading.</p>
        </div>
      </header>

      {artifact ? (
        <section className="observability-current">
          <header>
            <strong>Current output</strong>
            <span>{artifact.kind}</span>
          </header>
          <h4>{artifact.title}</h4>
          <div className="observability-split">
            <div className="observability-technical">
              <small>Technical</small>
              <pre>{technicalFromArtifact(artifact)}</pre>
            </div>
            <div className="observability-narrative">
              <small>Narrative</small>
              <div>{narrativeFromArtifact(artifact)}</div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="observability-feed">
        <h4>Session timeline</h4>
        {feed.length === 0 ? (
          <p className="observability-empty">Waiting for voice activity. Tool calls, CLI output, and Jarvis summaries appear here live.</p>
        ) : (
          <ul>
            {feed.slice(0, 40).map((event) => (
              <li key={event.id} className={`obs-entry obs-entry-${event.role} obs-status-${event.status || "done"}`}>
                <header>
                  <time>{event.at}</time>
                  <strong>{event.role === "tool" ? event.tool || "tool" : event.role}</strong>
                  {event.status === "running" ? <em className="obs-running">running</em> : null}
                </header>
                <p className="obs-narrative">{event.narrative}</p>
                {event.technical ? (
                  <details className="obs-technical-block" open={event.role === "tool"}>
                    <summary>Technical detail</summary>
                    <pre>{event.technical}</pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function technicalFromArtifact(artifact: JarvisArtifact): string {
  if (artifact.kind === "code") return artifact.content;
  if (artifact.kind === "table") {
    try {
      const rows = JSON.parse(artifact.content) as Array<Record<string, unknown>>;
      const list = Array.isArray(rows) ? rows : [rows];
      if (list.length === 0) return artifact.content;
      const keys = Object.keys(list[0] || {});
      return [keys.join("\t"), ...list.slice(0, 40).map((row) => keys.map((key) => String(row[key] ?? "")).join("\t"))].join("\n");
    } catch {
      return artifact.content;
    }
  }
  if (artifact.kind === "markdown") {
    const lines = artifact.content.split("\n");
    const technical = lines.filter((line) => line.startsWith("- ") || line.startsWith("## ") || line.includes("CVE") || line.includes("sw"));
    return technical.length > 0 ? technical.join("\n") : artifact.content.slice(0, 2000);
  }
  return artifact.content.slice(0, 4000);
}

function narrativeFromArtifact(artifact: JarvisArtifact): string {
  if (artifact.kind === "markdown") {
    const headline = artifact.content.split("\n").find((line) => line.startsWith("# "));
    const summary = artifact.content
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#") && !line.startsWith("```"))
      .slice(0, 6)
      .join(" ");
    return headline ? `${headline.replace(/^#\s*/, "")}. ${summary}` : summary || artifact.title;
  }
  return `${artifact.title} — inspect the technical panel for raw command output or structured data.`;
}

function fallbackFromTranscript(sessionLog: TranscriptEntry[]): ObservabilityEvent[] {
  return sessionLog.slice(0, 30).map((entry) => ({
    id: entry.id,
    at: entry.at,
    role: entry.role === "jarvis" ? "jarvis" : entry.role === "tool" ? "tool" : entry.role === "user" ? "user" : "system",
    narrative: entry.text,
    technical: entry.role === "tool" ? entry.text : undefined,
    tool: entry.role === "tool" ? "session" : undefined,
    status: "done",
  }));
}

