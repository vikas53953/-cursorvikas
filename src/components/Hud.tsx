import type { JarvisConnectionState, JarvisMood } from "../lib/realtime";

export type HudActivity = {
  kind: "idle" | "tool_start" | "tool_done" | "tool_error";
  text: string;
};

type HudProps = {
  connectionState: JarvisConnectionState;
  mood: JarvisMood;
  activity: HudActivity;
  lastHeard: string;
  speakingText?: string;
  feed?: string[];
  floating?: boolean;
  compact?: boolean;
};

const STATE_LABEL: Record<string, string> = {
  idle: "Standing by",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  working: "Running tools",
  error: "Error",
};

const STATE_TONE: Record<string, string> = {
  idle: "neutral",
  listening: "info",
  thinking: "warning",
  speaking: "success",
  working: "info",
  error: "error",
  offline: "neutral",
  connecting: "warning",
};

export function Hud({
  connectionState,
  mood,
  activity,
  lastHeard,
  speakingText = "",
  feed = [],
  floating = false,
  compact = false,
}: HudProps) {
  const offline = connectionState !== "connected";
  const stateLabel =
    connectionState === "connecting" ? "Connecting" : offline ? "Voice off" : STATE_LABEL[mood] || mood;
  const stateClass = offline ? "offline" : mood;
  const tone = connectionState === "connecting" ? "warning" : offline ? "neutral" : STATE_TONE[mood] || "neutral";
  const hudClass = floating ? "hud hud-floating hud-compact" : compact ? "hud hud-compact" : "hud";
  const showSpeaking = Boolean(speakingText.trim()) && (mood === "speaking" || mood === "thinking" || mood === "working");
  const primaryLine = showSpeaking ? speakingText : activity.kind === "tool_start" ? activity.text : lastHeard;

  return (
    <section className={hudClass} aria-label="Voice status">
      <header className={`hud-primary hud-tone-${tone}`}>
        <div className={`hud-state hud-state-${stateClass}`}>
          <span className="hud-dot" aria-hidden="true" />
          <strong>{stateLabel}</strong>
        </div>
        {primaryLine ? (
          <p className="hud-primary-text" title={primaryLine}>
            {primaryLine}
          </p>
        ) : (
          <p className="hud-primary-text hud-primary-muted">Press the mic to start voice.</p>
        )}
      </header>

      {(lastHeard && showSpeaking) || activity.kind !== "idle" ? (
        <div className="hud-secondary">
          {lastHeard && showSpeaking ? (
            <div className="hud-row">
              <span className="hud-label">You</span>
              <p>{lastHeard}</p>
            </div>
          ) : null}
          {activity.kind !== "idle" ? (
            <div className={`hud-row hud-row-${activity.kind}`}>
              <span className="hud-label">
                {activity.kind === "tool_start" ? "Running" : activity.kind === "tool_error" ? "Failed" : "Done"}
              </span>
              <p>{activity.text}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {feed.length > 0 ? (
        <details className="hud-details">
          <summary>Activity log ({feed.length})</summary>
          <ul className="hud-feed" aria-label="Recent voice activity">
            {feed.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
