import { useEffect, useState, type MouseEvent } from "react";
import { Copy } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import { artifactEmailBody, artifactPlainText, downloadArtifact } from "../lib/artifactExport";
import { artifactNarrativeText, artifactTechnicalText } from "../lib/observability";
import type { TranscriptEntry } from "../lib/realtime";
import type { JarvisArtifact, SessionAuditTurn, SessionIndexEntry } from "../vite-env";
import { CliOutputView } from "./CliOutput";

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

// Focused observability: current output (technical + narrative) with optional recent tool log.
export function ObservabilityPanel({ events, artifact, sessionLog }: ObservabilityPanelProps) {
  const [copied, setCopied] = useState<"" | "all" | "email">("");
  const [auditSessions, setAuditSessions] = useState<SessionIndexEntry[]>([]);
  const [auditTurns, setAuditTurns] = useState<SessionAuditTurn[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const sessions = await window.jarvis.listSessions(5);
        if (!active) return;
        setAuditSessions(sessions);
        if (sessions[0]?.id) {
          const turns = await window.jarvis.listSessionTurns(sessions[0].id, 12);
          if (active) setAuditTurns(turns);
        }
      } catch {
        // Audit API is optional in dev; never break the panel.
      }
    })();
    return () => {
      active = false;
    };
  }, [events.length, sessionLog.length]);

  const recentTools = (events.length > 0 ? events : fallbackFromTranscript(sessionLog))
    .filter((event) => event.role === "tool")
    .slice(0, 8);
  const fullTechnical = artifact ? artifactTechnicalText(artifact) : "";
  const hasSession = fullTechnical.includes("## Behind the scenes");
  const sceneText = hasSession ? fullTechnical.split("## CLI output")[0]?.replace("## Behind the scenes", "").trim() : "";
  const cliText = hasSession ? fullTechnical.split("## CLI output")[1]?.trim() : fullTechnical;

  async function copyAll() {
    if (!artifact) return;
    await navigator.clipboard.writeText(artifactPlainText(artifact));
    setCopied("all");
    window.setTimeout(() => setCopied(""), 1500);
  }

  async function copyEmail() {
    if (!artifact) return;
    await navigator.clipboard.writeText(artifactEmailBody(artifact));
    setCopied("email");
    window.setTimeout(() => setCopied(""), 1500);
  }

  return (
    <div className="observability-panel">
      {artifact ? (
        <section className="observability-current">
          <header>
            <strong>Current output</strong>
            <span>{artifact.kind}</span>
          </header>
          <h4>{artifact.title}</h4>
          <div className="observability-split">
            {hasSession ? (
              <div className="observability-technical">
                <div className="obs-block-head">
                  <small>Behind the scenes</small>
                  <CopyChip text={sceneText} label="behind the scenes" />
                </div>
                <pre>{sceneText}</pre>
              </div>
            ) : null}
            <div className="observability-technical">
              <div className="obs-block-head">
                <small>{hasSession ? "CLI output" : "Technical"}</small>
                <CopyChip text={cliText} label="technical output" />
              </div>
              <CliOutputView text={cliText} />
            </div>
            <div className="observability-narrative">
              <div className="obs-block-head">
                <small>Narrative</small>
                <CopyChip text={artifactNarrativeText(artifact)} label="narrative summary" />
              </div>
              <div>{artifactNarrativeText(artifact)}</div>
            </div>
          </div>

          <footer className="observability-actions">
            <button onClick={() => void copyAll()} title="Copy full output">
              {copied === "all" ? "Copied!" : "Copy all"}
            </button>
            <button onClick={() => void copyEmail()} title="Copy formatted as an email">
              {copied === "email" ? "Copied!" : "Copy email"}
            </button>
            <button onClick={() => downloadArtifact(artifact)} title={artifact.kind === "table" ? "Download as CSV" : "Download as file"}>
              {artifact.kind === "table" ? "Download CSV" : "Download"}
            </button>
          </footer>
        </section>
      ) : (
        <p className="observability-empty">No active output yet. When Jarvis runs a tool, the latest technical output and narrative summary appear here.</p>
      )}

      {recentTools.length > 0 ? (
        <CollapsibleSection title="Recent tool activity" count={recentTools.length}>
          <ul className="observability-feed-list">
            {recentTools.map((event) => (
              <li key={event.id} className={`obs-entry obs-entry-${event.role} obs-status-${event.status || "done"}`}>
                <header>
                  <time>{event.at}</time>
                  <strong>{event.tool || "tool"}</strong>
                  {event.status === "running" ? <em className="obs-running">running</em> : null}
                  <CopyChip text={event.narrative} label="event summary" />
                </header>
                <p className="obs-narrative">{event.narrative}</p>
                {event.technical ? (
                  <details className="obs-technical-block">
                    <summary>
                      Technical detail
                      <CopyChip text={event.technical} label="technical detail" />
                    </summary>
                    <pre>{event.technical}</pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      ) : null}

      {auditTurns.length > 0 ? (
        <CollapsibleSection title="Session audit trail" count={auditTurns.length}>
          <p className="observability-audit-meta">
            Durable log for enterprise traceability — session <code>{auditSessions[0]?.id || "—"}</code>
          </p>
          <ul className="observability-feed-list observability-audit-list">
            {auditTurns.map((turn) => (
              <li key={turn.id} className={`obs-entry obs-status-${turn.ok === false ? "error" : "done"}`}>
                <header>
                  <time>{new Date(turn.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time>
                  <strong>{turn.intent || "unknown"}</strong>
                  {turn.skill ? <span className="obs-skill">{turn.skill}</span> : null}
                  {turn.ms != null ? <span className="obs-latency">{turn.ms}ms</span> : null}
                </header>
                {turn.reply ? <p className="obs-narrative">{turn.reply}</p> : null}
                {turn.tools && turn.tools.length > 0 ? (
                  <small className="obs-tools">{turn.tools.map((t) => t.tool).join(", ")}</small>
                ) : null}
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      ) : null}
    </div>
  );
}

function CopyChip({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button type="button" className="obs-copy-chip" onClick={(event) => void copy(event)} title={copied ? "Copied" : `Copy ${label}`} aria-label={`Copy ${label}`}>
      <Copy size={12} />
      {copied ? <span>OK</span> : null}
    </button>
  );
}

function fallbackFromTranscript(sessionLog: TranscriptEntry[]): ObservabilityEvent[] {
  return sessionLog
    .filter((entry) => entry.role === "tool")
    .slice(0, 8)
    .map((entry) => ({
      id: entry.id,
      at: entry.at,
      role: "tool" as const,
      narrative: entry.text,
      technical: entry.text,
      tool: "session",
      status: "done" as const,
    }));
}
