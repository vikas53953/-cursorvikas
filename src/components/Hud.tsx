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
  listening: "Listening...",
  thinking: "Thinking...",
  speaking: "Speaking",
  working: "Running tools",
  error: "Error",
};

// Always-visible heads-up display: what state Jarvis is in, what it heard,
// and which command is running right now. `floating` renders a compact
// overlay so Jarvis stays visible even when the panel is fullscreen.
export function Hud({ connectionState, mood, activity, lastHeard, speakingText = "", feed = [], floating = false, compact = false }: HudProps) {
  const offline = connectionState !== "connected";
  const stateLabel =
    connectionState === "connecting" ? "Connecting..." : offline ? "Voice off - press the mic" : STATE_LABEL[mood] || mood;
  const stateClass = offline ? "offline" : mood;
  const hudClass = floating ? "hud hud-floating hud-compact" : compact ? "hud hud-compact" : "hud";
  const showSpeaking = Boolean(speakingText.trim()) && (mood === "speaking" || mood === "thinking" || mood === "working");

  return (
    <div className={hudClass}>
      <div className={`hud-state hud-state-${stateClass}`}>
        <span className="hud-dot" />
        <strong>{stateLabel}</strong>
      </div>
      {lastHeard ? (
        <div className="hud-line hud-heard">
          <span>You</span>
          <p>{lastHeard}</p>
        </div>
      ) : null}
      {showSpeaking ? (
        <div className="hud-line hud-speaking">
          <span>Jarvis</span>
          <p>{speakingText}</p>
        </div>
      ) : null}
      {activity.kind !== "idle" ? (
        <div className={`hud-line hud-activity hud-activity-${activity.kind}`}>
          <span>{activity.kind === "tool_start" ? "Running" : activity.kind === "tool_error" ? "Failed" : "Done"}</span>
          <p>{activity.text}</p>
        </div>
      ) : null}
      {feed.length > 0 ? (
        <ul className="hud-feed" aria-label="Recent voice activity">
          {feed.map((line, index) => (
            <li key={`${line}-${index}`}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
