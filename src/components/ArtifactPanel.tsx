import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import mermaid from "mermaid";
import { OpsDashboard } from "./OpsDashboard";
import { TeamBoard } from "./TeamBoard";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { SquadChatPanel, type SquadChatTarget } from "./SquadChatPanel";
import { ObservabilityPanel, type ObservabilityEvent } from "./ObservabilityPanel";
import type { JarvisConnectionState, TranscriptEntry } from "../lib/realtime";
import type { JarvisArtifact, TeamTask } from "../vite-env";

export type RightPanelTab = "dashboard" | "team" | "observability" | "artifacts";

type ArtifactPanelProps = {
  artifact: JarvisArtifact | null;
  tab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  visible: boolean;
  fullscreen: boolean;
  onToggleVisible: () => void;
  onToggleFullscreen: () => void;
  sessionLog: TranscriptEntry[];
  mood: import("../lib/realtime").JarvisMood;
  taskRefreshToken: number;
  observabilityEvents: ObservabilityEvent[];
  connectionState: JarvisConnectionState;
  chatBusy?: boolean;
  onSendSquadChat: (target: SquadChatTarget, message: string) => void | Promise<void>;
  onChatExpandedChange?: (expanded: boolean) => void;
};

type MermaidState = {
  svg: string;
  error: string | null;
  source: string;
};

type NoteCard = {
  id?: string;
  text?: string;
  tags?: string[];
  createdAt?: string;
};

type StatusBoardData = {
  updatedAt?: string;
  overall?: string;
  summary?: {
    devices?: number;
    activeAlerts?: number;
    bgpEstablished?: string;
    ospfFull?: string;
  };
  tiles?: Array<{
    id?: string;
    name?: string;
    role?: string;
    site?: string;
    status?: string;
    cpu?: string;
    uptime?: string;
    note?: string;
  }>;
};

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  securityLevel: "strict",
});

export function ArtifactPanel({ artifact, tab, onTabChange, visible, fullscreen, onToggleVisible, onToggleFullscreen, sessionLog, mood, taskRefreshToken, observabilityEvents, connectionState, chatBusy = false, onSendSquadChat, onChatExpandedChange }: ArtifactPanelProps) {
  const [mermaidState, setMermaidState] = useState<MermaidState>({ svg: "", error: null, source: "" });
  const rawId = useId();
  const mermaidId = useMemo(() => `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`, [rawId]);

  useEffect(() => {
    let cancelled = false;
    if (artifact?.kind !== "mermaid") {
      setMermaidState({ svg: "", error: null, source: "" });
      return;
    }

    const source = normalizeMermaidSource(artifact.content, artifact.title);
    mermaid
      .render(mermaidId, source)
      .then((result) => {
        if (!cancelled) setMermaidState({ svg: result.svg, error: null, source });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const fallback = fallbackMermaidSource(artifact.title);
        mermaid
          .render(`${mermaidId}-fallback`, fallback)
          .then((result) => {
            if (!cancelled) setMermaidState({ svg: result.svg, error: message, source });
          })
          .catch(() => {
            if (!cancelled) setMermaidState({ svg: "", error: message, source });
          });
      });

    return () => {
      cancelled = true;
    };
  }, [artifact, mermaidId]);

  if (!visible) {
    return (
      <button className="artifact-tab" onClick={onToggleVisible}>
        Show Panel
      </button>
    );
  }

  const titleByTab: Record<RightPanelTab, string> = {
    dashboard: fullscreen ? "NOC Dashboard" : "Dashboard",
    team: "Agent Squad",
    observability: "Observability",
    artifacts: "Artifacts",
  };

  const tabs: Array<{ key: RightPanelTab; label: string }> = [
    { key: "dashboard", label: "Dashboard" },
    { key: "team", label: "Agent Squad" },
    { key: "observability", label: "Observability" },
    { key: "artifacts", label: "Artifacts" },
  ];

  return (
    <aside className={`artifact-panel ${fullscreen ? "artifact-fullscreen" : ""}`}>
      <header className="artifact-header">
        <div className="artifact-title">
          <span className="eyebrow">Network Operations</span>
          <h2>{titleByTab[tab]}</h2>
        </div>
        <div className="artifact-actions">
          <div className="panel-tabs" role="tablist">
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "panel-tab active" : "panel-tab"}
                onClick={() => onTabChange(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "dashboard" ? (
            <button onClick={onToggleFullscreen} title={fullscreen ? "Exit full NOC dashboard" : "Open full NOC dashboard"}>
              {fullscreen ? "Window" : "Full NOC"}
            </button>
          ) : (
            <button onClick={onToggleFullscreen}>{fullscreen ? "Window" : "Fullscreen"}</button>
          )}
          <button onClick={onToggleVisible}>Hide</button>
        </div>
      </header>
      <div className={`artifact-body ${fullscreen && tab === "dashboard" ? "artifact-body-noc" : ""}`}>
        {tab === "dashboard" ? (
          <OpsDashboard sessionLog={sessionLog} expanded={fullscreen} />
        ) : tab === "team" ? (
          <TeamBoard
            mood={mood}
            active={tab === "team"}
            refreshToken={taskRefreshToken}
            sessionLog={sessionLog}
            connectionState={connectionState}
            chatBusy={chatBusy}
            onSendSquadChat={onSendSquadChat}
            onChatExpandedChange={onChatExpandedChange}
          />
        ) : tab === "artifacts" ? (
          <ArtifactsPanel />
        ) : tab === "observability" ? (
          <ObservabilityPanel events={observabilityEvents} artifact={artifact} sessionLog={sessionLog} />
        ) : null}
      </div>
    </aside>
  );
}


function renderArtifact(artifact: JarvisArtifact, mermaidState: MermaidState) {
  if (artifact.kind === "table") {
    return <JsonTable content={artifact.content} />;
  }

  if (artifact.kind === "notes") {
    return <NotesGrid content={artifact.content} />;
  }

  if (artifact.kind === "statusBoard") {
    return <StatusBoard content={artifact.content} />;
  }

  if (artifact.kind === "taskBoard") {
    return <TaskBoardArtifact content={artifact.content} />;
  }

  if (artifact.kind === "mermaid") {
    return (
      <div className="mermaid-stack">
        <div className="mermaid-output" dangerouslySetInnerHTML={{ __html: mermaidState.svg }} />
        {mermaidState.error ? (
          <details className="mermaid-repair">
            <summary>NetJarvis repaired this chart so it would still display.</summary>
            <p>The original Mermaid syntax did not parse, so a safe fallback chart was shown.</p>
            <pre>{mermaidState.source}</pre>
          </details>
        ) : null}
      </div>
    );
  }

  if (artifact.kind === "code") {
    return (
      <pre className="code-artifact">
        <code>{artifact.content}</code>
      </pre>
    );
  }

  if (artifact.kind === "markdown") {
    return <MarkdownArtifact content={artifact.content} />;
  }

  if (artifact.kind === "progress") {
    return (
      <div className="progress-card">
        <div className="progress-pulse" />
        <p>{artifact.content}</p>
      </div>
    );
  }

  return <pre className="text-artifact">{artifact.content}</pre>;
}

function StatusBoard({ content }: { content: string }) {
  const board = parseStatusBoard(content);
  if (!board) return <pre className="text-artifact">{content}</pre>;

  const tiles = board.tiles || [];
  const summary = board.summary || {};

  return (
    <section className="status-board">
      <header className={`status-board-meta status-overall-${board.overall || "healthy"}`}>
        <div>
          <span>Network {board.overall || "healthy"}</span>
          <p>
            {summary.devices ?? tiles.length} devices · {summary.activeAlerts ?? 0} active alerts · BGP {summary.bgpEstablished || "-"} · OSPF {summary.ospfFull || "-"}
          </p>
        </div>
        <small>as of {board.updatedAt || "now"}</small>
      </header>
      <div className="status-grid">
        {tiles.map((tile) => (
          <article className={`status-tile status-${tile.status || "ok"}`} key={tile.id || tile.name}>
            <header>
              <strong>{tile.name}</strong>
              <span className="status-dot" aria-label={tile.status} />
            </header>
            <p className="status-role">
              {tile.role} · {tile.site}
            </p>
            <p className="status-stats">
              CPU {tile.cpu} · up {tile.uptime}
            </p>
            {tile.note ? <p className="status-note">{tile.note}</p> : <p className="status-note status-note-clear">No active alerts</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

function TaskBoardArtifact({ content }: { content: string }) {
  try {
    const data = JSON.parse(content) as { tasks?: TeamTask[] };
    return <TeamBoard staticTasks={data.tasks || []} />;
  } catch {
    return <pre className="text-artifact">{content}</pre>;
  }
}

function parseStatusBoard(content: string): StatusBoardData | null {
  try {
    const value = JSON.parse(content) as unknown;
    if (!value || typeof value !== "object") return null;
    return value as StatusBoardData;
  } catch {
    return null;
  }
}

function MarkdownArtifact({ content }: { content: string }) {
  const [visibleContent, setVisibleContent] = useState("");

  useEffect(() => {
    setVisibleContent("");
    let index = 0;
    const step = Math.max(8, Math.ceil(content.length / 180));
    const timer = window.setInterval(() => {
      index = Math.min(content.length, index + step);
      setVisibleContent(content.slice(0, index));
      if (index >= content.length) window.clearInterval(timer);
    }, 14);

    return () => window.clearInterval(timer);
  }, [content]);

  return (
    <div className="markdown-artifact">
      <div className="stream-line" />
      {renderMarkdown(visibleContent)}
    </div>
  );
}

function renderMarkdown(content: string) {
  return content.split("\n").map((line, index) => {
    if (line.startsWith("# ")) {
      return <h1 key={index}>{renderInline(line.slice(2))}</h1>;
    }
    if (line.startsWith("## ")) {
      return <h2 key={index}>{renderInline(line.slice(3))}</h2>;
    }
    if (line.startsWith("### ")) {
      return <h3 key={index}>{renderInline(line.slice(4))}</h3>;
    }
    if (line.startsWith("- ")) {
      return <li key={index}>{renderInline(line.slice(2))}</li>;
    }
    if (/^\d+\.\s/.test(line)) {
      return <li key={index}>{renderInline(line.replace(/^\d+\.\s/, ""))}</li>;
    }
    if (!line.trim()) {
      return <div className="markdown-gap" key={index} />;
    }
    return <p key={index}>{renderInline(line)}</p>;
  });
}

function renderInline(text: string) {
  const parts: ReactNode[] = [];
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <a href={match[2]} key={`${match[2]}-${match.index}`} target="_blank" rel="noreferrer">
        {match[1]}
      </a>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : text;
}

function NotesGrid({ content }: { content: string }) {
  const notes = parseNotes(content);
  if (notes.length === 0) return <pre className="text-artifact">{content}</pre>;

  return (
    <div className="notes-grid">
      {notes.map((note, index) => (
        <article className="note-card" key={note.id || index}>
          <p>{note.text || "Untitled note"}</p>
          <footer>
            <span>{formatDate(note.createdAt)}</span>
            {note.tags && note.tags.length > 0 ? <small>{note.tags.map((tag) => `#${tag}`).join(" ")}</small> : null}
          </footer>
        </article>
      ))}
    </div>
  );
}

function parseNotes(content: string): NoteCard[] {
  try {
    const value = JSON.parse(content) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((note): note is NoteCard => note !== null && typeof note === "object");
  } catch {
    return [];
  }
}

function formatDate(value: string | undefined): string {
  if (!value) return "just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function normalizeMermaidSource(content: string, title: string): string {
  const stripped = content
    .replace(/```mermaid/gi, "")
    .replace(/```/g, "")
    .replace(/\r/g, "")
    .trim();

  if (!stripped) return fallbackMermaidSource(title);

  const lines = stripped
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-"));

  const first = lines[0] || "";
  const hasHeader = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline)\b/i.test(first);
  return hasHeader ? lines.join("\n") : `flowchart TD\n${lines.join("\n")}`;
}

function fallbackMermaidSource(title: string): string {
  const safeTitle = title.replace(/["<>]/g, "") || "Chart";
  return `flowchart TD\n  A["${safeTitle}"] --> B["Chart syntax issue"]\n  B --> C["Fallback displayed"]`;
}

function JsonTable({ content }: { content: string }) {
  const parsed = parseRows(content);
  if (!parsed) return <pre className="text-artifact">{content}</pre>;

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const keys = Array.from(
    rows.reduce<Set<string>>((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set()),
  );

  if (rows.length === 0 || keys.length === 0) {
    return <pre className="text-artifact">{content}</pre>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{keys.map((key) => <th key={key}>{key}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.id || index}`}>
              {keys.map((key) => (
                <td key={key}>{formatCell(row[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseRows(content: string): Array<Record<string, unknown>> | Record<string, unknown> | null {
  try {
    const value = JSON.parse(content) as unknown;
    if (Array.isArray(value) && value.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      return value as Array<Record<string, unknown>>;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
