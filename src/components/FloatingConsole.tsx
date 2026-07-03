import { useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { NetworkCore } from "./NetworkCore";
import type { HudActivity } from "./Hud";
import type { JarvisConnectionState, JarvisMood, MouthShape } from "../lib/realtime";

type FloatingConsoleProps = {
  connectionState: JarvisConnectionState;
  mood: JarvisMood;
  mouthShape: MouthShape;
  activity: HudActivity;
  lastHeard: string;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
};

const STATE_LABEL: Record<string, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  working: "Working",
  error: "Error",
};

// Fullscreen voice dock — hidden until hover on bottom-center; minimal command bar only.
export function FloatingConsole({
  connectionState,
  mood,
  mouthShape,
  activity,
  lastHeard,
  isConnected,
  onConnect,
  onDisconnect,
}: FloatingConsoleProps) {
  const [hovered, setHovered] = useState(false);

  const sessionActive = connectionState === "connecting" || connectionState === "connected";
  const visible = hovered || sessionActive;
  const offline = connectionState !== "connected";
  const stateLabel =
    connectionState === "connecting" ? "Connecting" : offline ? "Voice off" : STATE_LABEL[mood] || mood;
  const stateClass = connectionState === "connecting" ? "connecting" : offline ? "offline" : mood;
  const statusLine =
    isConnected && lastHeard
      ? lastHeard
      : isConnected && activity.kind !== "idle"
        ? activity.text
        : isConnected
          ? stateLabel
          : "Hover here to talk";

  const rootClass = [
    "voice-dock-minimal",
    `voice-dock-${stateClass}`,
    visible ? "voice-dock-minimal-visible" : "",
    isConnected ? "voice-dock-live" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="voice-hover-zone"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label="Voice control hover zone"
    >
      <div className={rootClass} role="toolbar" aria-label="NetJarvis voice">
        <button
          type="button"
          className={`voice-dock-minimal-avatar ${isConnected ? "voice-dock-minimal-avatar-live" : ""}`}
          onClick={isConnected ? onDisconnect : onConnect}
          disabled={connectionState === "connecting"}
          title={isConnected ? "Stop voice" : "Start voice"}
          aria-label={isConnected ? "Stop voice" : "Start voice"}
        >
          <NetworkCore mood={mood} mouthShape={mouthShape} compact compactSize="xs" />
        </button>

        <div className="voice-dock-minimal-status" title={statusLine}>
          <span className="voice-dock-pulse" aria-hidden="true" />
          <strong>{stateLabel}</strong>
          {sessionActive ? <span className="voice-dock-minimal-detail">{statusLine}</span> : null}
        </div>

        <button
          type="button"
          className={`voice-dock-minimal-action ${isConnected ? "voice-dock-minimal-action-stop" : ""}`}
          onClick={isConnected ? onDisconnect : onConnect}
          disabled={connectionState === "connecting"}
          aria-label={isConnected ? "Stop voice" : "Start voice"}
        >
          {isConnected ? <MicOff size={14} /> : <Mic size={14} />}
          <span>{isConnected ? "Stop" : connectionState === "connecting" ? "..." : "Talk"}</span>
        </button>
      </div>
    </div>
  );
}
