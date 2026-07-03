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
export function Hud({ connectionState, mood, activity, lastHeard, floating = false, compact = false }: HudProps) {
  const offline = connectionState !== "connected";
  const stateLabel =
    connectionState === "connecting" ? "Connecting..." : offline ? "Voice off - press the mic" : STATE_LABEL[mood] || mood;
  const stateClass = offline ? "offline" : mood;
  const hudClass = compact || floating ? "hud hud-floating hud-compact" : "hud";

  return (
    <div className={hudClass}>
      <div className={`hud-state hud-state-${stateClass}`}>
        <span className="hud-dot" />
        <strong>{stateLabel}</strong>
      </div>
      {lastHeard ? (
        <div className="hud-line hud-heard" title={lastHeard}>
          <span>Heard</span>
          <p>&ldquo;{lastHeard}&rdquo;</p>
        </div>
      ) : null}
      {activity.kind !== "idle" ? (
        <div className={`hud-line hud-activity hud-activity-${activity.kind}`} title={activity.text}>
          <span>{activity.kind === "tool_start" ? "Running" : activity.kind === "tool_error" ? "Failed" : "Done"}</span>
          <p>{activity.text}</p>
        </div>
      ) : null}
    </div>
  );
}
