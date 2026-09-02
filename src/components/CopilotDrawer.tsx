import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, X } from "lucide-react";
import { NetworkCore } from "./NetworkCore";
import { Markdown } from "./Markdown";
import type { JarvisConnectionState, JarvisMood, MouthShape, TranscriptEntry } from "../lib/realtime";

export type HudActivity = {
  kind: "idle" | "tool_start" | "tool_done" | "tool_error";
  text: string;
};

const MOOD_LABEL: Record<JarvisMood, string> = {
  idle: "Standing by",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  working: "Running tools",
  error: "Error",
};

type CopilotDrawerProps = {
  connectionState: JarvisConnectionState;
  mood: JarvisMood;
  mouthShape: MouthShape;
  activity: HudActivity;
  lastHeard: string;
  speakingText: string;
  transcript: TranscriptEntry[];
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onSend: (message: string) => void | Promise<void>;
  onClose: () => void;
};

// Right-hand assistant drawer: the voice orb, live state, transcript and a typed composer.
export function CopilotDrawer({
  connectionState,
  mood,
  mouthShape,
  activity,
  lastHeard,
  speakingText,
  transcript,
  busy,
  onConnect,
  onDisconnect,
  onSend,
  onClose,
}: CopilotDrawerProps) {
  const [draft, setDraft] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const connected = connectionState === "connected";
  const connecting = connectionState === "connecting";
  const stateLabel = connecting ? "Connecting" : connected ? MOOD_LABEL[mood] : busy ? "Working" : "Standing by";
  const stateTone = connecting ? "warn" : !connected && !busy ? "neutral" : mood === "error" ? "bad" : mood === "idle" ? "ok" : "info";

  // Transcript state is newest-first; the drawer reads top-to-bottom like a chat.
  const ordered = [...transcript].reverse();

  useEffect(() => {
    const node = feedRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [transcript.length, busy]);

  function submit() {
    const trimmed = draft.trim();
    if (!trimmed || busy) return;
    setDraft("");
    void onSend(trimmed);
  }

  const showLive = connected && (lastHeard || speakingText || activity.kind !== "idle");

  return (
    <div className="copilot">
      <header className="copilot-head">
        <div className="copilot-orb">
          <NetworkCore mood={busy && mood === "idle" ? "working" : mood} mouthShape={mouthShape} compact compactSize="sm" />
        </div>
        <div className="copilot-title">
          <strong>NetJarvis Assistant</strong>
          <span className={`status-pill sp-${stateTone}`}>
            <i aria-hidden="true" />
            {stateLabel}
            {connected ? " · voice" : " · text"}
          </span>
        </div>
        <button type="button" className="icon-btn icon-btn-muted" onClick={onClose} aria-label="Close assistant">
          <X size={16} />
        </button>
      </header>

      <div className="copilot-voice">
        <button
          type="button"
          className={`ui-btn ${connected ? "ui-btn-danger" : "ui-btn-primary"}`}
          onClick={connected ? onDisconnect : onConnect}
          disabled={connecting}
        >
          {connected ? <MicOff size={14} /> : <Mic size={14} />}
          {connecting ? "Connecting…" : connected ? "Stop voice" : "Connect voice"}
        </button>
        <small>{connected ? "Speak naturally. Interrupt any time." : "Realtime voice needs OPENAI_API_KEY in .env.local."}</small>
      </div>

      {showLive ? (
        <section className="copilot-live" aria-live="polite">
          {lastHeard ? (
            <div className="copilot-live-row">
              <span>You</span>
              <p>{lastHeard}</p>
            </div>
          ) : null}
          {speakingText && (mood === "speaking" || mood === "thinking" || mood === "working") ? (
            <div className="copilot-live-row copilot-live-jarvis">
              <span>NetJarvis</span>
              <p>{speakingText}</p>
            </div>
          ) : null}
          {activity.kind !== "idle" ? (
            <div className={`copilot-live-row copilot-live-${activity.kind}`}>
              <span>{activity.kind === "tool_start" ? "Running" : activity.kind === "tool_error" ? "Failed" : "Done"}</span>
              <p>{activity.text}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="copilot-feed" ref={feedRef}>
        {ordered.map((entry) => (
          <article className={`copilot-msg copilot-msg-${entry.role}`} key={entry.id}>
            <header>
              <b>{entry.role === "jarvis" ? "NetJarvis" : entry.role === "user" ? "You" : entry.role}</b>
              <time>{entry.at}</time>
            </header>
            {entry.role === "jarvis" ? <Markdown text={entry.text} mentions={false} /> : <p>{entry.text}</p>}
          </article>
        ))}
        {busy ? (
          <article className="copilot-msg copilot-msg-jarvis copilot-msg-busy">
            <header>
              <b>NetJarvis</b>
            </header>
            <p>
              <span className="ui-spinner ui-spinner-sm" aria-hidden="true" /> Working on it…
            </p>
          </article>
        ) : null}
      </div>

      <footer className="copilot-compose">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder="Type to NetJarvis… e.g. what VLANs are on sw1?"
          aria-label="Type to NetJarvis"
          disabled={busy}
          className="ui-input"
        />
        <button type="button" className="ui-btn ui-btn-primary" onClick={submit} disabled={busy || !draft.trim()} aria-label="Send">
          <Send size={14} />
        </button>
      </footer>
    </div>
  );
}
