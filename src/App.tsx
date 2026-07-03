import { useRef, useState } from "react";
import { Activity, History, Keyboard, Mic, MicOff, PanelRight, Send } from "lucide-react";
import { ArtifactPanel, type RightPanelTab } from "./components/ArtifactPanel";
import { FloatingConsole } from "./components/FloatingConsole";
import { Hud, type HudActivity } from "./components/Hud";
import { NetworkCore } from "./components/NetworkCore";
import type { ObservabilityEvent } from "./components/ObservabilityPanel";
import { JarvisRealtimeClient, newEntry, type JarvisConnectionState, type JarvisMood, type MouthShape, type TranscriptEntry } from "./lib/realtime";
import type { JarvisArtifact } from "./vite-env";

function pushObservabilityEvent(events: ObservabilityEvent[], event: Omit<ObservabilityEvent, "id" | "at">): ObservabilityEvent[] {
  return [
    {
      id: crypto.randomUUID(),
      at: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }),
      ...event,
    },
    ...events,
  ].slice(0, 80);
}

export default function App() {
  const [connectionState, setConnectionState] = useState<JarvisConnectionState>("idle");
  const [mood, setMood] = useState<JarvisMood>("idle");
  const [hudActivity, setHudActivity] = useState<HudActivity>({ kind: "idle", text: "" });
  const [lastHeard, setLastHeard] = useState("");
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
  const [taskRefreshToken, setTaskRefreshToken] = useState(0);
  const [observabilityEvents, setObservabilityEvents] = useState<ObservabilityEvent[]>([]);
  const clientRef = useRef<JarvisRealtimeClient | null>(null);

  const isConnected = connectionState === "connected";

  async function connect() {
    if (connectionState === "connecting") return;
    if (connectionState === "connected" && clientRef.current?.isActive()) return;

    clientRef.current?.disconnect();
    clientRef.current = null;

    const client = new JarvisRealtimeClient({
      onConnectionState: setConnectionState,
      onMood: setMood,
      onMouthShape: setMouthShape,
      onTranscript: (entry) => {
        setTranscript((items) => [entry, ...items].slice(0, 80));
        if (entry.role === "user" || entry.role === "jarvis") {
          setObservabilityEvents((items) =>
            pushObservabilityEvent(items, {
              role: entry.role === "jarvis" ? "jarvis" : "user",
              narrative: entry.text,
              status: "done",
            }),
          );
        }
      },
      onArtifact: (nextArtifact) => {
        setArtifact(nextArtifact);
        setObservabilityEvents((items) =>
          pushObservabilityEvent(items, {
            role: "artifact",
            narrative: nextArtifact.title,
            technical: nextArtifact.content.slice(0, 4000),
            status: "done",
          }),
        );
        setPanelVisible(true);
        setPanelTab("observability");
        if (nextArtifact.fullscreen) setPanelFullscreen(true);
      },
      onStatus: (message) => {
        setTranscript((items) => [newEntry("system", message), ...items].slice(0, 80));
        setObservabilityEvents((items) =>
          pushObservabilityEvent(items, {
            role: "system",
            narrative: message,
            status: "done",
          }),
        );
      },
      onActivity: (activity) => {
        if (activity.kind === "heard") {
          setLastHeard(activity.text);
        } else {
          setHudActivity({ kind: activity.kind, text: activity.text });
          setObservabilityEvents((items) =>
            pushObservabilityEvent(items, {
              role: "tool",
              narrative: activity.text,
              technical: activity.technical,
              tool: activity.tool,
              status: activity.status || (activity.kind === "tool_start" ? "running" : activity.kind === "tool_error" ? "error" : "done"),
            }),
          );
          if (activity.kind === "tool_start") {
            setTaskRefreshToken((value) => value + 1);
            setPanelVisible(true);
            setPanelTab("observability");
            if (activity.text.toLowerCase().includes("delegate_task") || activity.text.toLowerCase().includes("delegate")) {
              setPanelTab("team");
            }
          }
          if (activity.kind === "tool_done" || activity.kind === "tool_error") {
            setTaskRefreshToken((value) => value + 1);
          }
        }
      },
    });
    clientRef.current = client;
    try {
      await client.connect();
    } catch {
      clientRef.current = null;
    }
  }

  function disconnect() {
    const client = clientRef.current;
    clientRef.current = null;
    client?.disconnect();
    setConnectionState("idle");
    setMood("idle");
    setMouthShape({ open: 0, width: 0.18, round: 0, teeth: 0 });
    setLastHeard("");
    setHudActivity({ kind: "idle", text: "" });
    setTranscript((items) => [newEntry("system", "Voice disconnected."), ...items].slice(0, 80));
  }

  function sendTextPrompt() {
    const trimmed = textPrompt.trim();
    if (!trimmed) return;
    clientRef.current?.sendText(trimmed);
    setLastHeard(trimmed);
    setTextPrompt("");
    setShowTypeInput(false);
  }

  async function sendSquadChat(target: { id: string; name: string; scope?: string }, message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;

    let payload = trimmed;
    if (target.id !== "jarvis") {
      payload = `[Squad text chat — engineer is messaging ${target.name} (${target.id} team). Respond in that specialist scope; use delegate_task or tools as you would for voice.] ${trimmed}`;
    }

    if (connectionState !== "connected") {
      setTranscript((items) => [newEntry("system", "Connect voice first (hover bottom-center in fullscreen, or use the mic on the left)."), ...items].slice(0, 80));
      return;
    }
    clientRef.current?.sendText(payload);
    setLastHeard(trimmed);
    setPanelVisible(true);
    setPanelTab("team");
  }

  return (
    <main className="app-shell">
      <div className="window-drag-strip" aria-hidden="true" />
      <div className="window-drag-left-zone" aria-hidden="true" />
      <section className="companion-window">
        <section className="face-stage">
          <NetworkCore mood={mood} mouthShape={mouthShape} />
        </section>

        <footer className="bottom-console">
          <Hud connectionState={connectionState} mood={mood} activity={hudActivity} lastHeard={lastHeard} />
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
        sessionLog={transcript}
        mood={mood}
        taskRefreshToken={taskRefreshToken}
        observabilityEvents={observabilityEvents}
        connectionState={connectionState}
        onSendSquadChat={sendSquadChat}
      />

      {panelFullscreen ? (
        <FloatingConsole
          connectionState={connectionState}
          mood={mood}
          mouthShape={mouthShape}
          activity={hudActivity}
          lastHeard={lastHeard}
          isConnected={isConnected}
          onConnect={() => void connect()}
          onDisconnect={disconnect}
        />
      ) : null}
    </main>
  );
}
