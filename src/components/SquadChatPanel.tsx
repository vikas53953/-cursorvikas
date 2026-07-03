import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import type { JarvisConnectionState, TranscriptEntry } from "../lib/realtime";
import type { AgentOrg } from "../vite-env";

export type SquadChatTarget = {
  id: string;
  name: string;
  scope?: string;
};

type SquadChatPanelProps = {
  sessionLog: TranscriptEntry[];
  connectionState: JarvisConnectionState;
  onSend: (target: SquadChatTarget, message: string) => void | Promise<void>;
};

// Text chat with Jarvis or any squad specialist — same realtime session as voice.
export function SquadChatPanel({ sessionLog, connectionState, onSend }: SquadChatPanelProps) {
  const [org, setOrg] = useState<AgentOrg | null>(null);
  const [targetId, setTargetId] = useState("jarvis");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setOrg(await window.jarvis.getOrg());
    } catch {
      // Keep last good org chart.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const targets = buildTargets(org);
  const target = targets.find((item) => item.id === targetId) || targets[0];
  const messages = sessionLog.filter((entry) => entry.role === "user" || entry.role === "jarvis").slice(0, 40).reverse();

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, sessionLog]);

  async function submit() {
    const trimmed = draft.trim();
    if (!trimmed || !target || sending) return;
    setSending(true);
    try {
      await onSend(target, trimmed);
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  const offline = connectionState !== "connected";

  return (
    <aside className="squad-chat">
      <header className="squad-chat-header">
        <div>
          <span className="squad-chat-eyebrow">Squad chat</span>
          <strong>Network team channel</strong>
        </div>
        <label className="squad-chat-select-wrap">
          <span>With</span>
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            {targets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      {target ? (
        <p className="squad-chat-scope" title={target.scope}>
          {target.id === "jarvis" ? "Squad lead — routes to the right specialist" : target.scope || target.name}
        </p>
      ) : null}

      <div className="squad-chat-feed" ref={feedRef}>
        {messages.length === 0 ? (
          <p className="squad-chat-empty">Type a message to {target?.name || "NetJarvis"}. Same engine as voice — tools and delegation run behind the scenes.</p>
        ) : (
          messages.map((entry) => (
            <article className={`squad-chat-msg squad-chat-msg-${entry.role}`} key={entry.id}>
              <header>
                <strong>{entry.role === "jarvis" ? "NetJarvis" : "You"}</strong>
                <time>{entry.at}</time>
              </header>
              <p>{entry.text}</p>
            </article>
          ))
        )}
      </div>

      <footer className="squad-chat-compose">
        {offline ? <small className="squad-chat-hint">Connect voice once (left mic) — then text chat works here too.</small> : null}
        <div className="squad-chat-input-row">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={`Message ${target?.name || "NetJarvis"}...`}
            disabled={sending}
          />
          <button onClick={() => void submit()} disabled={sending || !draft.trim()} aria-label="Send message" title="Send">
            <Send size={15} />
          </button>
        </div>
        {target?.id === "jarvis" ? (
          <span className="squad-chat-badge">
            <Sparkles size={11} /> Default · Jarvis lead
          </span>
        ) : null}
      </footer>
    </aside>
  );
}

function buildTargets(org: AgentOrg | null): SquadChatTarget[] {
  const jarvis: SquadChatTarget = {
    id: "jarvis",
    name: org?.jarvis?.name || "NetJarvis",
    scope: "Squad lead — coordinates and delegates to specialists",
  };
  const agents =
    org?.groups?.flatMap((group) =>
      group.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        scope: agent.scope,
      })),
    ) || [];
  return [jarvis, ...agents];
}
