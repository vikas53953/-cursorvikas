import { Keyboard, Mic, MicOff, Send } from "lucide-react";
import { NetworkCore } from "./NetworkCore";
import { Hud, type HudActivity } from "./Hud";
import { Markdown } from "./Markdown";
import type { JarvisConnectionState, JarvisMood, MouthShape, TranscriptEntry } from "../lib/realtime";

type VoicePageProps = {
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
  assistantName?: string;
};

export function VoicePage({
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
  assistantName = "NetJarvis",
}: VoicePageProps) {
  const isConnected = connectionState === "connected";

  return (
    <div className="voice-page">
      <section className="voice-stage">
        <p className="voice-stage-kicker">Voice</p>
        <NetworkCore mood={mood} mouthShape={mouthShape} />
        <Hud
          connectionState={connectionState}
          mood={mood}
          activity={activity}
          lastHeard={lastHeard}
          speakingText={speakingText}
          feed={feed}
        />
        <div className="voice-controls">
          {showTypeInput ? (
            <div className="prompt-box">
              <input
                name="voice-prompt"
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
              {isConnected ? <MicOff size={18} /> : <Mic size={18} />}
              <span>{isConnected ? "End" : connectionState === "connecting" ? "Connecting" : "Talk"}</span>
            </button>
            <button
              className={showTypeInput ? "simple-button active" : "simple-button"}
              onClick={onToggleType}
              aria-label={`Type to ${assistantName}`}
              type="button"
            >
              <Keyboard size={16} />
              <span>Type</span>
            </button>
          </div>
        </div>
      </section>

      <aside className="voice-log" aria-label="Conversation">
        <header className="voice-log-head">
          <strong>Conversation</strong>
          <span>{transcript.length} turns</span>
        </header>
        <div className="copilot-transcript" aria-live="polite">
          {transcript
            .slice()
            .reverse()
            .map((entry) => (
              <article className={`entry entry-${entry.role}`} key={entry.id}>
                <div>
                  <strong>{entry.role === "jarvis" ? assistantName : entry.role}</strong>
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
      </aside>
    </div>
  );
}
