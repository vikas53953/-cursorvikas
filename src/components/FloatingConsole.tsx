import { Mic, MicOff } from "lucide-react";
import type { HudActivity } from "./Hud";
import type { JarvisConnectionState, JarvisMood } from "../lib/realtime";

type FloatingConsoleProps = {
  connectionState: JarvisConnectionState;
  mood: JarvisMood;
  activity: HudActivity;
  lastHeard: string;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
};

const STATE_LABEL: Record<string, string> = {
  idle: "Standing by",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  working: "Running tools",
  error: "Error",
};

// Fullscreen voice dock — ambient status ribbon + pulsing talk orb (no boxed HUD).
export function FloatingConsole({
  connectionState,
  mood,
  activity,
  lastHeard,
  isConnected,
  onConnect,
  onDisconnect,
}: FloatingConsoleProps) {
  const offline = connectionState !== "connected";
  const stateLabel =
    connectionState === "connecting" ? "Connecting" : offline ? "Voice ready" : STATE_LABEL[mood] || mood;
  const stateClass = connectionState === "connecting" ? "connecting" : offline ? "offline" : mood;

  return (
    <div className={`voice-dock voice-dock-${stateClass} ${isConnected ? "voice-dock-live" : ""}`} role="toolbar" aria-label="NetJarvis voice dock">
      <div className="voice-dock-glow" aria-hidden="true" />
      <button
        type="button"
        className={`voice-dock-orb ${isConnected ? "voice-dock-orb-active" : ""}`}
        onClick={isConnected ? onDisconnect : onConnect}
        disabled={connectionState === "connecting"}
        title={isConnected ? "Stop voice" : "Start voice"}
        aria-label={isConnected ? "Stop voice" : "Start voice"}
      >
        <span className="voice-dock-orb-ring" aria-hidden="true" />
        <span className="voice-dock-orb-ring voice-dock-orb-ring-2" aria-hidden="true" />
        <span className="voice-dock-orb-core" aria-hidden="true" />
        {isConnected ? <MicOff size={20} strokeWidth={2.2} /> : <Mic size={20} strokeWidth={2.2} />}
        <span className="voice-dock-orb-caption">{isConnected ? "Stop" : "Talk"}</span>
      </button>

      <div className="voice-dock-panel">
        <div className="voice-dock-status">
          <span className="voice-dock-pulse" />
          <strong>{stateLabel}</strong>
          {isConnected ? <em className="voice-dock-live-tag">LIVE</em> : null}
        </div>
        {lastHeard ? (
          <p className="voice-dock-heard" title={lastHeard}>
            <span>Heard</span> &ldquo;{lastHeard}&rdquo;
          </p>
        ) : (
          <p className="voice-dock-idle-copy">Hover the orb to talk with NetJarvis</p>
        )}
        {activity.kind !== "idle" ? (
          <p className={`voice-dock-activity voice-dock-activity-${activity.kind}`} title={activity.text}>
            <span>{activity.kind === "tool_start" ? "Running" : activity.kind === "tool_error" ? "Failed" : "Done"}</span>
            {activity.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
