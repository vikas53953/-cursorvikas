import { useState } from "react";
import { LayoutGrid, Mic, MicOff } from "lucide-react";
import { NetworkCore } from "./NetworkCore";
import type { HudActivity } from "./Hud";
import type { JarvisConnectionState, JarvisMood, MouthShape } from "../lib/realtime";

export type HudLayout = "mini-core" | "command-bar";

const LAYOUT_STORAGE_KEY = "netjarvis-hud-layout";
const LAYOUT_CYCLE: HudLayout[] = ["mini-core", "command-bar"];
const LAYOUT_LABEL: Record<HudLayout, string> = {
  "mini-core": "Mini NetworkCore",
  "command-bar": "Command bar",
};

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
  idle: "Standing by",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  working: "Running tools",
  error: "Error",
};

function readLayout(): HudLayout {
  try {
    return localStorage.getItem(LAYOUT_STORAGE_KEY) === "command-bar" ? "command-bar" : "mini-core";
  } catch {
    return "mini-core";
  }
}

// Fullscreen HUD — switchable Mini NetworkCore (corner) or bottom-center command bar.
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
  const [layout, setLayout] = useState<HudLayout>(readLayout);

  const offline = connectionState !== "connected";
  const stateLabel =
    connectionState === "connecting" ? "Connecting" : offline ? "Voice ready" : STATE_LABEL[mood] || mood;
  const stateClass = connectionState === "connecting" ? "connecting" : offline ? "offline" : mood;

  function cycleLayout() {
    setLayout((current) => {
      const index = LAYOUT_CYCLE.indexOf(current);
      const next = LAYOUT_CYCLE[(index + 1) % LAYOUT_CYCLE.length];
      try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, next);
      } catch {
        // Preference storage is best-effort.
      }
      return next;
    });
  }

  const rootClass = [
    "voice-dock",
    `voice-dock-layout-${layout}`,
    `voice-dock-${stateClass}`,
    isConnected ? "voice-dock-live" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const voiceControl = (
    <button
      type="button"
      className={`voice-dock-voice ${isConnected ? "voice-dock-voice-live" : ""}`}
      onClick={isConnected ? onDisconnect : onConnect}
      disabled={connectionState === "connecting"}
      title={isConnected ? "Stop voice" : "Start voice"}
      aria-label={isConnected ? "Stop voice" : "Start voice"}
    >
      {layout === "mini-core" ? (
        <NetworkCore mood={mood} mouthShape={mouthShape} compact />
      ) : (
        <>
          <span className="voice-dock-orb-ring" aria-hidden="true" />
          <span className="voice-dock-orb-ring voice-dock-orb-ring-2" aria-hidden="true" />
          <span className="voice-dock-orb-core" aria-hidden="true" />
          {isConnected ? <MicOff size={18} strokeWidth={2.2} /> : <Mic size={18} strokeWidth={2.2} />}
        </>
      )}
    </button>
  );

  return (
    <div className={rootClass} role="toolbar" aria-label="NetJarvis voice dock">
      <div className="voice-dock-glow" aria-hidden="true" />
      <button
        type="button"
        className="voice-dock-layout-toggle"
        onClick={cycleLayout}
        title={`HUD style: ${LAYOUT_LABEL[layout]}. Click to switch.`}
        aria-label={`Switch HUD style. Current: ${LAYOUT_LABEL[layout]}`}
      >
        <LayoutGrid size={13} />
        <span>{LAYOUT_LABEL[layout]}</span>
      </button>

      {layout === "command-bar" ? (
        <div className="voice-dock-command-bar">
          <div className="voice-dock-command-left">{voiceControl}</div>
          <div className="voice-dock-command-center">
            <DockStatus
              stateLabel={stateLabel}
              isConnected={isConnected}
              lastHeard={lastHeard}
              activity={activity}
              inline
            />
          </div>
          <div className="voice-dock-command-right">
            <span className="voice-dock-pulse" aria-hidden="true" />
            {isConnected ? <em className="voice-dock-live-tag">ON AIR</em> : <span className="voice-dock-ready-tag">READY</span>}
          </div>
        </div>
      ) : (
        <div className="voice-dock-row">
          <div className="voice-dock-orb-wrap">{voiceControl}</div>
          <DockStatus stateLabel={stateLabel} isConnected={isConnected} lastHeard={lastHeard} activity={activity} />
        </div>
      )}
    </div>
  );
}

function DockStatus({
  stateLabel,
  isConnected,
  lastHeard,
  activity,
  inline = false,
}: {
  stateLabel: string;
  isConnected: boolean;
  lastHeard: string;
  activity: HudActivity;
  inline?: boolean;
}) {
  const panelClass = inline ? "voice-dock-panel voice-dock-panel-inline" : "voice-dock-panel";

  return (
    <div className={panelClass}>
      <div className="voice-dock-status">
        {!inline ? <span className="voice-dock-pulse" aria-hidden="true" /> : null}
        <strong>{stateLabel}</strong>
        {!inline && isConnected ? <em className="voice-dock-live-tag">ON AIR</em> : null}
      </div>
      {lastHeard ? (
        <p className="voice-dock-heard" title={lastHeard}>
          <span>Heard</span> &ldquo;{lastHeard}&rdquo;
        </p>
      ) : (
        <p className="voice-dock-idle-copy">{inline ? "Tap the core to talk with NetJarvis" : "Tap the core to talk with NetJarvis"}</p>
      )}
      {activity.kind !== "idle" ? (
        <p className={`voice-dock-activity voice-dock-activity-${activity.kind}`} title={activity.text}>
          <span>{activity.kind === "tool_start" ? "Running" : activity.kind === "tool_error" ? "Failed" : "Done"}</span>
          {activity.text}
        </p>
      ) : null}
    </div>
  );
}
