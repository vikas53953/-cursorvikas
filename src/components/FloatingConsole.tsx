import { Keyboard, Mic, MicOff } from "lucide-react";
import { Hud, type HudActivity } from "./Hud";
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

// Fullscreen overlay: compact HUD always visible; Stop/Voice only on hover.
export function FloatingConsole({ connectionState, mood, activity, lastHeard, isConnected, onConnect, onDisconnect }: FloatingConsoleProps) {
  return (
    <div className="floating-console" role="toolbar" aria-label="Voice status">
      <Hud connectionState={connectionState} mood={mood} activity={activity} lastHeard={lastHeard} compact />
      <div className="floating-console-actions">
        <button
          className={isConnected ? "floating-stop floating-stop-active" : "floating-stop"}
          onClick={isConnected ? onDisconnect : onConnect}
          disabled={connectionState === "connecting"}
          title={isConnected ? "Stop voice" : "Start voice"}
          aria-label={isConnected ? "Stop voice" : "Start voice"}
        >
          {isConnected ? <MicOff size={14} /> : <Mic size={14} />}
          <span>{isConnected ? "Stop" : "Voice"}</span>
        </button>
      </div>
    </div>
  );
}
