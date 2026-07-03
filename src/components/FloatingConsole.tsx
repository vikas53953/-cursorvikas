import { useState, type CSSProperties } from "react";
import { LayoutGrid } from "lucide-react";
import { NetworkCore } from "./NetworkCore";
import type { HudActivity } from "./Hud";
import type { JarvisConnectionState, JarvisMood, MouthShape } from "../lib/realtime";

export type HudLayout = "command-bar" | "mini-core" | "waveform" | "edge";

const LAYOUT_STORAGE_KEY = "netjarvis-hud-layout";
const LAYOUT_CYCLE: HudLayout[] = ["command-bar", "mini-core", "waveform", "edge"];
const LAYOUT_LABEL: Record<HudLayout, string> = {
  "command-bar": "Command bar",
  "mini-core": "Mini NetworkCore",
  waveform: "Waveform ribbon",
  edge: "Edge HUD",
};

const WAVE_FACTORS = [0.2, 0.35, 0.5, 0.7, 0.9, 1, 0.85, 0.65, 0.85, 1, 0.9, 0.7, 0.5, 0.35, 0.2];

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
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (saved && LAYOUT_CYCLE.includes(saved as HudLayout)) return saved as HudLayout;
  } catch {
    // Preference storage is best-effort.
  }
  return "command-bar";
}

// Fullscreen HUD — four switchable layouts (default: center command bar + mini avatar).
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
  const voiceEnergy = Math.min(1, mouthShape.open * 1.25 + mouthShape.teeth * 0.3 + mouthShape.width * 0.15);

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

  const statusProps = { stateLabel, isConnected, lastHeard, activity };

  return (
    <div className={rootClass} role="toolbar" aria-label="NetJarvis voice dock">
      <div className="voice-dock-glow" aria-hidden="true" />
      <button
        type="button"
        className="voice-dock-layout-toggle"
        onClick={cycleLayout}
        title={`HUD style: ${LAYOUT_LABEL[layout]}. Click to cycle (${LAYOUT_CYCLE.indexOf(layout) + 1}/${LAYOUT_CYCLE.length}).`}
        aria-label={`Switch HUD style. Current: ${LAYOUT_LABEL[layout]}`}
      >
        <LayoutGrid size={13} />
        <span>
          {LAYOUT_LABEL[layout]} {LAYOUT_CYCLE.indexOf(layout) + 1}/{LAYOUT_CYCLE.length}
        </span>
      </button>

      {layout === "command-bar" ? (
        <CommandBarLayout {...statusProps} mood={mood} mouthShape={mouthShape} isConnected={isConnected} connectionState={connectionState} onConnect={onConnect} onDisconnect={onDisconnect} />
      ) : layout === "waveform" ? (
        <WaveformLayout
          {...statusProps}
          mood={mood}
          mouthShape={mouthShape}
          voiceEnergy={voiceEnergy}
          isConnected={isConnected}
          connectionState={connectionState}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
        />
      ) : layout === "edge" ? (
        <EdgeLayout {...statusProps} mood={mood} mouthShape={mouthShape} isConnected={isConnected} connectionState={connectionState} onConnect={onConnect} onDisconnect={onDisconnect} />
      ) : (
        <MiniCoreLayout {...statusProps} mood={mood} mouthShape={mouthShape} isConnected={isConnected} connectionState={connectionState} onConnect={onConnect} onDisconnect={onDisconnect} />
      )}
    </div>
  );
}

type LayoutBodyProps = {
  stateLabel: string;
  isConnected: boolean;
  lastHeard: string;
  activity: HudActivity;
  mood: JarvisMood;
  mouthShape: MouthShape;
  connectionState: JarvisConnectionState;
  onConnect: () => void;
  onDisconnect: () => void;
};

function VoiceAvatarButton({
  mood,
  mouthShape,
  isConnected,
  connectionState,
  onConnect,
  onDisconnect,
  compactSize = "md",
}: LayoutBodyProps & { compactSize?: "md" | "sm" }) {
  return (
    <button
      type="button"
      className={`voice-dock-voice ${isConnected ? "voice-dock-voice-live" : ""}`}
      onClick={isConnected ? onDisconnect : onConnect}
      disabled={connectionState === "connecting"}
      title={isConnected ? "Stop voice" : "Start voice"}
      aria-label={isConnected ? "Stop voice" : "Start voice"}
    >
      <NetworkCore mood={mood} mouthShape={mouthShape} compact compactSize={compactSize} />
    </button>
  );
}

function CommandBarLayout(props: LayoutBodyProps) {
  return (
    <div className="voice-dock-command-bar">
      <div className="voice-dock-command-left">
        <VoiceAvatarButton {...props} compactSize="sm" />
      </div>
      <div className="voice-dock-command-center">
        <DockStatus {...props} inline />
      </div>
      <div className="voice-dock-command-right">
        <span className="voice-dock-pulse" aria-hidden="true" />
        {props.isConnected ? <em className="voice-dock-live-tag">ON AIR</em> : <span className="voice-dock-ready-tag">READY</span>}
      </div>
    </div>
  );
}

function MiniCoreLayout(props: LayoutBodyProps) {
  return (
    <div className="voice-dock-row">
      <div className="voice-dock-orb-wrap">
        <VoiceAvatarButton {...props} compactSize="md" />
      </div>
      <DockStatus {...props} />
    </div>
  );
}

function WaveformLayout({
  mood,
  voiceEnergy,
  ...props
}: LayoutBodyProps & { voiceEnergy: number }) {
  const active = mood === "listening" || mood === "speaking" || mood === "working";

  return (
    <div className="voice-dock-waveform">
      <div className="voice-dock-waveform-top">
        <div className="voice-dock-waveform-core">
          <VoiceAvatarButton {...props} mood={mood} compactSize="sm" />
        </div>
        <DockStatus {...props} inline />
        <div className="voice-dock-command-right">
          <span className="voice-dock-pulse" aria-hidden="true" />
          {props.isConnected ? <em className="voice-dock-live-tag">ON AIR</em> : <span className="voice-dock-ready-tag">READY</span>}
        </div>
      </div>
      <div className={`voice-dock-wave-bars ${active ? "voice-dock-wave-bars-active" : ""}`} aria-hidden="true">
        {WAVE_FACTORS.map((factor, index) => (
          <span
            key={index}
            style={
              {
                "--f": factor,
                "--voice-energy": mood === "speaking" ? voiceEnergy.toFixed(3) : active ? "0.55" : "0.12",
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}

function EdgeLayout(props: LayoutBodyProps) {
  return (
    <div className="voice-dock-edge">
      <div className="voice-dock-edge-rail" aria-hidden="true" />
      <div className="voice-dock-edge-body">
        <div className="voice-dock-edge-avatar">
          <VoiceAvatarButton {...props} compactSize="sm" />
        </div>
        <DockStatus {...props} />
      </div>
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
        <p className="voice-dock-idle-copy">Tap the core to talk with NetJarvis</p>
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
