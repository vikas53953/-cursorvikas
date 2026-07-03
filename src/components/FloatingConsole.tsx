import { Keyboard, Mic, MicOff, Minimize2, Send } from "lucide-react";
import { Hud, type HudActivity } from "./Hud";
import type { JarvisConnectionState, JarvisMood } from "../lib/realtime";

type FloatingConsoleProps = {
  connectionState: JarvisConnectionState;
  mood: JarvisMood;
  activity: HudActivity;
  lastHeard: string;
  isConnected: boolean;
  showTypeInput: boolean;
  textPrompt: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleTypeInput: () => void;
  onTextPromptChange: (value: string) => void;
  onSendText: () => void;
  onExitFullscreen: () => void;
};

// Fullscreen-only overlay: HUD always visible bottom-left; voice controls appear on hover.
export function FloatingConsole({
  connectionState,
  mood,
  activity,
  lastHeard,
  isConnected,
  showTypeInput,
  textPrompt,
  onConnect,
  onDisconnect,
  onToggleTypeInput,
  onTextPromptChange,
  onSendText,
  onExitFullscreen,
}: FloatingConsoleProps) {
  return (
    <div
      className={`floating-console ${showTypeInput ? "floating-console-expanded" : ""}`}
      role="toolbar"
      aria-label="Voice controls"
    >
      <Hud connectionState={connectionState} mood={mood} activity={activity} lastHeard={lastHeard} compact />
      <div className="floating-console-actions">
        {showTypeInput ? (
          <section className="floating-prompt">
            <input
              value={textPrompt}
              onChange={(event) => onTextPromptChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSendText();
              }}
              autoFocus
              placeholder="Type to NetJarvis..."
            />
            <button onClick={onSendText} aria-label="Send typed prompt">
              <Send size={15} />
            </button>
          </section>
        ) : null}
        <section className="floating-controls">
          <button
            className={isConnected ? "floating-btn floating-btn-active" : "floating-btn"}
            onClick={isConnected ? onDisconnect : onConnect}
            disabled={connectionState === "connecting"}
            title={isConnected ? "Stop voice" : "Connect voice"}
          >
            {isConnected ? <MicOff size={16} /> : <Mic size={16} />}
            <span>{isConnected ? "Stop" : "Voice"}</span>
          </button>
          <button
            className={showTypeInput ? "floating-btn floating-btn-active" : "floating-btn"}
            onClick={onToggleTypeInput}
            title="Type to NetJarvis"
          >
            <Keyboard size={16} />
            <span>Type</span>
          </button>
          <button className="floating-btn" onClick={onExitFullscreen} title="Exit fullscreen">
            <Minimize2 size={16} />
            <span>Window</span>
          </button>
        </section>
      </div>
    </div>
  );
}
