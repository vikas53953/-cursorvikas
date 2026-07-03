import { useRef, useState } from "react";
import { Activity, History, Keyboard, Mic, MicOff, PanelRight, Send } from "lucide-react";
import { ArtifactPanel, type RightPanelTab } from "./components/ArtifactPanel";
import { JarvisFace } from "./components/JarvisFace";
import { JarvisRealtimeClient, newEntry, type JarvisConnectionState, type JarvisMood, type MouthShape, type TranscriptEntry } from "./lib/realtime";
import type { JarvisArtifact } from "./vite-env";

export default function App() {
  const [connectionState, setConnectionState] = useState<JarvisConnectionState>("idle");
  const [mood, setMood] = useState<JarvisMood>("idle");
  const [artifact, setArtifact] = useState<JarvisArtifact | null>(null);
  const [panelTab, setPanelTab] = useState<RightPanelTab>("dashboard");
  const [panelVisible, setPanelVisible] = useState(true);
  const [panelFullscreen, setPanelFullscreen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showTypeInput, setShowTypeInput] = useState(false);
  const [mouthShape, setMouthShape] = useState<MouthShape>({ open: 0, width: 0.18, round: 0, teeth: 0 });
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([
    newEntry("system", "NetJarvis is ready. Connect voice, then ask how your network is doing."),
  ]);
  const [textPrompt, setTextPrompt] = useState("");
  const clientRef = useRef<JarvisRealtimeClient | null>(null);

  const isConnected = connectionState === "connected";

  async function connect() {
    const client = new JarvisRealtimeClient({
      onConnectionState: setConnectionState,
      onMood: setMood,
      onMouthShape: setMouthShape,
      onTranscript: (entry) => setTranscript((items) => [entry, ...items].slice(0, 80)),
      onArtifact: (nextArtifact) => {
        setArtifact(nextArtifact);
        setPanelVisible(true);
        setPanelTab("reports");
        if (nextArtifact.fullscreen) setPanelFullscreen(true);
      },
      onStatus: (message) => {
        setTranscript((items) => [newEntry("system", message), ...items].slice(0, 80));
      },
    });
    clientRef.current = client;
    await client.connect();
  }

  function disconnect() {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setTranscript((items) => [newEntry("system", "Disconnected."), ...items].slice(0, 80));
  }

  function sendTextPrompt() {
    const trimmed = textPrompt.trim();
    if (!trimmed) return;
    clientRef.current?.sendText(trimmed);
    setTextPrompt("");
    setShowTypeInput(false);
  }

  return (
    <main className="app-shell">
      <div className="window-drag-strip" aria-hidden="true" />
      <div className="window-drag-left-zone" aria-hidden="true" />
      <section className="companion-window">
        <section className="face-stage">
          <JarvisFace mood={mood} mouthShape={mouthShape} />
        </section>

        <footer className="bottom-console">
          {showTypeInput ? (
            <section className="prompt-box">
              <input
                value={textPrompt}
                onChange={(event) => setTextPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") sendTextPrompt();
                }}
                autoFocus
                placeholder="Type to NetJarvis... e.g. what VLANs are on sw1?"
              />
              <button onClick={sendTextPrompt} aria-label="Send typed prompt" title="Send typed prompt">
                <Send size={15} />
              </button>
            </section>
          ) : null}

          <section className="control-strip">
            <button
              className={isConnected ? "simple-button active" : "simple-button"}
              onClick={isConnected ? disconnect : connect}
              disabled={connectionState === "connecting"}
              aria-label={isConnected ? "Disconnect voice" : "Connect voice"}
              title={isConnected ? "Disconnect voice" : "Connect voice"}
            >
              {isConnected ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button
              className={showTypeInput ? "simple-button active" : "simple-button"}
              onClick={() => setShowTypeInput((value) => !value)}
              aria-label="Type to NetJarvis"
              title="Type to NetJarvis"
            >
              <Keyboard size={16} />
            </button>
            <button
              className={panelTab === "dashboard" && panelVisible ? "simple-button active" : "simple-button"}
              onClick={() => {
                setPanelVisible(true);
                setPanelTab("dashboard");
              }}
              aria-label="Show operations dashboard"
              title="Show operations dashboard"
            >
              <Activity size={16} />
            </button>
            <button
              className={panelVisible ? "simple-button active" : "simple-button"}
              onClick={() => setPanelVisible((value) => !value)}
              aria-label="Toggle right panel"
              title="Toggle right panel"
            >
              <PanelRight size={16} />
            </button>
            <button
              className={showLog ? "simple-button active" : "simple-button"}
              onClick={() => setShowLog((value) => !value)}
              aria-label="Toggle live log"
              title="Toggle live log"
            >
              <History size={16} />
            </button>
          </section>
        </footer>

        {showLog ? (
          <section className="transcript">
            <div className="section-title">
              <span>Live Log</span>
              <small>{transcript.length} events</small>
            </div>
            <div className="transcript-list">
              {transcript.map((entry) => (
                <article className={`entry entry-${entry.role}`} key={entry.id}>
                  <div>
                    <strong>{entry.role === "jarvis" ? "NetJarvis" : entry.role}</strong>
                    <time>{entry.at}</time>
                  </div>
                  <p>{entry.text}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>

      <ArtifactPanel
        artifact={artifact}
        tab={panelTab}
        onTabChange={setPanelTab}
        visible={panelVisible}
        fullscreen={panelFullscreen}
        onToggleVisible={() => setPanelVisible((value) => !value)}
        onToggleFullscreen={() => setPanelFullscreen((value) => !value)}
      />
    </main>
  );
}
