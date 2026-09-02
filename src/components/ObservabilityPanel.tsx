import { useEffect, useId, useMemo, useState, type MouseEvent } from "react";
import mermaid from "mermaid";
import { Activity, Copy, Download, Mail } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import { CliOutputView } from "./CliOutput";
import { Markdown } from "./Markdown";
import { StatusPill } from "./ui/StatusPill";
import { artifactEmailBody, artifactPlainText, downloadArtifact } from "../lib/artifactExport";
import { artifactNarrativeText, artifactTechnicalText } from "../lib/observability";
import type { TranscriptEntry } from "../lib/realtime";
import type { JarvisArtifact, SessionAuditTurn, SessionIndexEntry } from "../vite-env";

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
  theme?: "light" | "dark";
};

let mermaidTheme: "default" | "dark" | null = null;
function ensureMermaid(theme: "light" | "dark") {
  const wanted = theme === "dark" ? "dark" : "default";
  if (mermaidTheme === wanted) return;
  mermaid.initialize({ startOnLoad: false, theme: wanted, securityLevel: "strict" });
  mermaidTheme = wanted;
}

// Observability page: current output (behind the scenes / CLI / narrative, mermaid diagrams
// rendered), the recent tool activity feed and the durable session audit trail.
export function ObservabilityPanel({ events, artifact, sessionLog, theme = "light" }: ObservabilityPanelProps) {
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

  const recentTools = (events.length > 0 ? events : fallbackFromTranscript(sessionLog)).filter((event) => event.role === "tool").slice(0, 8);
  const fullTechnical = artifact ? artifactTechnicalText(artifact) : "";
  const hasSession = fullTechnical.includes("## Behind the scenes");
  const sceneText = hasSession ? fullTechnical.split("## CLI output")[0]?.replace("## Behind the scenes", "").trim() : "";
  const cliText = hasSession ? fullTechnical.split("## CLI output")[1]?.trim() : fullTechnical;
  const isMarkdown = artifact?.kind === "markdown";
  const isMermaid = artifact?.kind === "mermaid";

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
    <div className="observability">
      {artifact ? (
        <section className="ui-card">
          <header className="ui-card-head">
            <h2>
              {artifact.title}
              <StatusPill tone={isMermaid ? "accent" : artifact.kind === "code" ? "accent" : artifact.kind === "table" ? "info" : "neutral"} dot={false} label={artifact.kind} />
            </h2>
            <div className="ui-card-actions">
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => void copyAll()} title="Copy full output">
                <Copy size={13} /> {copied === "all" ? "Copied" : "Copy"}
              </button>
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => void copyEmail()} title="Copy formatted as an email">
                <Mail size={13} /> {copied === "email" ? "Copied" : "Copy as email"}
              </button>
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => downloadArtifact(artifact)}>
                <Download size={13} /> {artifact.kind === "table" ? "Download CSV" : "Download"}
              </button>
            </div>
          </header>

          {isMermaid ? (
            <div className="ui-card-body">
              <MermaidView source={artifact.content} title={artifact.title} theme={theme} />
            </div>
          ) : isMarkdown ? (
            <div className="ui-card-body obs-markdown">
              <Markdown text={artifact.content} mentions={false} />
            </div>
          ) : (
            <div className="obs-split">
              {hasSession ? (
                <section className="obs-block">
                  <header className="obs-block-head">
                    <span className="ui-label">Behind the scenes</span>
                    <CopyChip text={sceneText} label="behind the scenes" />
                  </header>
                  <pre className="obs-pre">{sceneText}</pre>
                </section>
              ) : null}
              <section className="obs-block obs-block-wide">
                <header className="obs-block-head">
                  <span className="ui-label">{hasSession ? "CLI output" : "Technical output"}</span>
                  <CopyChip text={cliText} label="technical output" />
                </header>
                <CliOutputView text={cliText} />
              </section>
              <section className="obs-block">
                <header className="obs-block-head">
                  <span className="ui-label">Narrative</span>
                  <CopyChip text={artifactNarrativeText(artifact)} label="narrative summary" />
                </header>
                <p className="obs-narrative">{artifactNarrativeText(artifact)}</p>
              </section>
            </div>
          )}
        </section>
      ) : (
        <div className="ui-card ui-empty ui-empty-tall">
          <Activity size={28} />
          <strong>No output yet</strong>
          <span>When NetJarvis runs a tool, the latest technical output and narrative summary appear here.</span>
        </div>
      )}

      <section className="ui-card">
        <header className="ui-card-head">
          <h2>
            Recent tool activity <em className="ui-count">{recentTools.length}</em>
          </h2>
        </header>
        {recentTools.length === 0 ? (
          <div className="ui-empty">
            <strong>No tool activity in this session</strong>
          </div>
        ) : (
          <ul className="obs-feed">
            {recentTools.map((event) => (
              <li key={event.id} className={`obs-entry obs-status-${event.status || "done"}`}>
                <header>
                  <time>{event.at}</time>
                  <code>{event.tool || "tool"}</code>
                  <StatusPill tone={event.status === "error" ? "bad" : event.status === "running" ? "info" : "ok"} label={event.status || "done"} />
                  <CopyChip text={event.narrative} label="event summary" />
                </header>
                <p>{event.narrative}</p>
                {event.technical ? (
                  <details className="obs-technical">
                    <summary>Technical detail</summary>
                    <pre className="obs-pre">{event.technical}</pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <CollapsibleSection title="Session audit trail" count={auditTurns.length} defaultOpen={auditTurns.length > 0}>
        {auditTurns.length === 0 ? (
          <p className="ui-muted">No audited chat turns yet. Every chat message is written to a per-session JSONL log.</p>
        ) : (
          <>
            <p className="ui-muted obs-audit-meta">
              Durable log for enterprise traceability · session <code>{auditSessions[0]?.id || "—"}</code>
            </p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Intent</th>
                    <th>Skill</th>
                    <th className="num">Latency</th>
                    <th>Tools</th>
                    <th>Reply</th>
                  </tr>
                </thead>
                <tbody>
                  {auditTurns.map((turn) => (
                    <tr key={turn.id} className={turn.ok === false ? "row-bad" : ""}>
                      <td className="mono nowrap">{new Date(turn.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</td>
                      <td>
                        <StatusPill tone={turn.ok === false ? "bad" : "neutral"} dot={false} label={turn.intent || "unknown"} />
                      </td>
                      <td className="mono">{turn.skill || "—"}</td>
                      <td className="num">{turn.ms != null ? `${turn.ms} ms` : "—"}</td>
                      <td className="mono">{turn.tools && turn.tools.length > 0 ? turn.tools.map((t) => t.tool).join(", ") : "—"}</td>
                      <td className="obs-reply">{turn.reply || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CollapsibleSection>
    </div>
  );
}

function MermaidView({ source, title, theme }: { source: string; title: string; theme: "light" | "dark" }) {
  const rawId = useId();
  const id = useMemo(() => `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`, [rawId]);
  const [state, setState] = useState<{ svg: string; error: string | null }>({ svg: "", error: null });

  useEffect(() => {
    let cancelled = false;
    ensureMermaid(theme);
    const normalized = normalizeMermaidSource(source);
    mermaid
      .render(`${id}-${theme}`, normalized)
      .then((result) => {
        if (!cancelled) setState({ svg: result.svg, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ svg: "", error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [source, id, theme]);

  if (state.error) {
    return (
      <div className="ui-banner ui-banner-warn">
        <div>
          <strong>Diagram could not be rendered.</strong> {state.error}
          <pre className="obs-pre">{source}</pre>
        </div>
      </div>
    );
  }
  return <div className="mermaid-view" role="img" aria-label={title} dangerouslySetInnerHTML={{ __html: state.svg }} />;
}

function normalizeMermaidSource(content: string): string {
  const stripped = content.replace(/```mermaid/gi, "").replace(/```/g, "").replace(/\r/g, "").trim();
  const lines = stripped
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-"));
  const hasHeader = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline)\b/i.test(lines[0] || "");
  return hasHeader ? lines.join("\n") : `flowchart TD\n${lines.join("\n")}`;
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
    <button type="button" className="ui-btn ui-btn-ghost ui-btn-xs" onClick={(event) => void copy(event)} title={copied ? "Copied" : `Copy ${label}`} aria-label={`Copy ${label}`}>
      <Copy size={12} />
      {copied ? "Copied" : "Copy"}
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
