import { Keyboard, Mic, MicOff, Send, X } from "lucide-react";
import { NetworkCore } from "./NetworkCore";
import { Hud, type HudActivity } from "./Hud";
import { Markdown } from "./Markdown";
import type { JarvisConnectionState, JarvisMood, MouthShape, TranscriptEntry } from "../lib/realtime";

type CopilotDrawerProps = {
  open: boolean;
  onClose: () => void;
  connectionState: JarvisConnectionState;
  mood: JarvisMood;
  mouthShape: MouthShape;
  activity: HudActivity;
  lastHeard: string;
  speakingText: string;
  feed: string[];
  transcript: TranscriptEntry[];
  textPrompt: string;
  onTextPrompt: (value: string) => void;
  onSend: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  chatBusy: boolean;
  showTypeInput: boolean;
  onToggleType: () => void;
};

export function CopilotDrawer({
  open,
  onClose,
  connectionState,
  mood,
  mouthShape,
  activity,
  lastHeard,
  speakingText,
  feed,
  transcript,
  textPrompt,
  onTextPrompt,
  onSend,
  onConnect,
  onDisconnect,
  chatBusy,
  showTypeInput,
  onToggleType,
}: CopilotDrawerProps) {
  const isConnected = connectionState === "connected";

  return (
    <aside className={`copilot-drawer ${open ? "open" : ""}`} aria-hidden={!open} aria-label="NetJarvis assistant">
      <header className="copilot-head">
        <div>
          <p className="page-kicker">Assistant</p>
          <strong>Ask NetJarvis</strong>
        </div>
        <button type="button" className="ui-btn ui-btn-ghost" onClick={onClose} aria-label="Close assistant">
          <X size={16} />
        </button>
      </header>

      <div className="copilot-orb">
        <NetworkCore mood={mood} mouthShape={mouthShape} compact compactSize="sm" />
      </div>

      <Hud
        connectionState={connectionState}
        mood={mood}
        activity={activity}
        lastHeard={lastHeard}
        speakingText={speakingText}
        feed={feed}
      />

      <div className="copilot-transcript" aria-live="polite">
        {transcript
          .slice()
          .reverse()
          .map((entry) => (
            <article className={`entry entry-${entry.role}`} key={entry.id}>
              <div>
                <strong>{entry.role === "jarvis" ? "NetJarvis" : entry.role}</strong>
                <time>{entry.at}</time>
              </div>
              {entry.role === "jarvis" ? <Markdown text={entry.text} /> : <p>{entry.text}</p>}
            </article>
          ))}
        {chatBusy ? (
          <p className="copilot-busy">
            <span className="ui-spinner" /> Working on it…
          </p>
        ) : null}
      </div>

      <footer className="copilot-compose">
        {showTypeInput ? (
          <div className="prompt-box">
            <input
              value={textPrompt}
              onChange={(event) => onTextPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSend();
              }}
              placeholder="how's my network? · MAC table on sw1 · investigate user jdoe"
            />
            <button type="button" onClick={onSend} aria-label="Send" disabled={chatBusy}>
              <Send size={15} />
            </button>
          </div>
        ) : null}
        <div className="control-strip">
          <button
            className={isConnected ? "simple-button active" : "simple-button"}
            onClick={isConnected ? onDisconnect : onConnect}
            disabled={connectionState === "connecting"}
            aria-label={isConnected ? "Disconnect voice" : "Connect voice"}
            title={isConnected ? "Disconnect voice" : "Connect voice"}
            type="button"
          >
            {isConnected ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <button
            className={showTypeInput ? "simple-button active" : "simple-button"}
            onClick={onToggleType}
            aria-label="Type to NetJarvis"
            type="button"
          >
            <Keyboard size={16} />
          </button>
        </div>
      </footer>
    </aside>
  );
}
