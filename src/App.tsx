import { useRef, useState } from "react";
import { ArtifactsPanel } from "./components/ArtifactsPanel";
import { AssurancePage } from "./components/AssurancePage";
import { InvestigationsPage } from "./components/InvestigationsPage";
import { InventoryPage } from "./components/InventoryPage";
import { ObservabilityPanel, type ObservabilityEvent } from "./components/ObservabilityPanel";
import { SettingsPage } from "./components/SettingsPage";
import { TeamBoard } from "./components/TeamBoard";
import { VoicePage } from "./components/VoicePage";
import { AppShell, type AppPage } from "./components/shell/AppShell";
import { useDashboard } from "./hooks/useDashboard";
import { usePrefs } from "./hooks/usePrefs";
import { useTheme } from "./hooks/useTheme";
import { JarvisRealtimeClient, newEntry, type JarvisConnectionState, type JarvisMood, type MouthShape, type TranscriptEntry } from "./lib/realtime";
import { artifactTechnicalText } from "./lib/observability";
import { sanitizeSquadChatReply } from "./lib/chatReplySanitizer";
import { buildMentionPrefix } from "./lib/squadMentions";
import { commitTranscript } from "./lib/transcriptGate";
import type { JarvisArtifact } from "./vite-env";
import type { HudActivity } from "./components/Hud";

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

function parseSearchSeed(raw: string): { kind: "user" | "ip" | "host"; value: string } | null {
  const value = raw.trim();
  if (!value) return null;
  // A sentence is an assistant question. A single token (or "investigate user X") is a seed.
  if (/\s/.test(value) && !/^(?:user|host|ip|investigate)\b/i.test(value)) return null;
  const userMatch = value.match(/^(?:user|investigate(?:\s+user)?)\s+(\S+)$/i);
  if (userMatch) return { kind: "user", value: userMatch[1] };
  const hostMatch = value.match(/^(?:host|investigate\s+host)\s+(\S+)$/i);
  if (hostMatch) return { kind: "host", value: hostMatch[1] };
  const ipMatch = value.match(/^(?:ip|investigate\s+ip)\s+(\S+)$/i);
  if (ipMatch) return { kind: "ip", value: ipMatch[1] };
  if (/^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value)) return { kind: "ip", value };
  if (/[.\-]/.test(value) || /\d$/.test(value)) return { kind: "host", value };
  if (/^investigate\s+/i.test(value)) return { kind: "user", value: value.replace(/^investigate\s+/i, "").trim() };
  return { kind: "user", value };
}

export default function App() {
  const { theme, setTheme } = useTheme();
  const { prefs, update: updatePrefs } = usePrefs();
  const dashboard = useDashboard();
  const [page, setPage] = useState<AppPage>("voice");
  const [search, setSearch] = useState("");
  const [lookbackHours, setLookbackHours] = useState(24);
  const [pendingSeed, setPendingSeed] = useState<{ kind: "user" | "ip" | "host"; value: string } | null>(null);

  const [connectionState, setConnectionState] = useState<JarvisConnectionState>("idle");
  const [mood, setMood] = useState<JarvisMood>("idle");
  const [hudActivity, setHudActivity] = useState<HudActivity>({ kind: "idle", text: "" });
  const [lastHeard, setLastHeard] = useState("");
  const [speakingText, setSpeakingText] = useState("");
  const [hudFeed, setHudFeed] = useState<string[]>([]);
  const [artifact, setArtifact] = useState<JarvisArtifact | null>(null);
  const [showTypeInput, setShowTypeInput] = useState(true);
  const [mouthShape, setMouthShape] = useState<MouthShape>({ open: 0, width: 0.18, round: 0, teeth: 0 });
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([
    newEntry("system", `${prefs.assistantName} is ready. Connect voice, then ask how your network is doing.`),
  ]);
  const [textPrompt, setTextPrompt] = useState("");
  const [taskRefreshToken, setTaskRefreshToken] = useState(0);
  const [observabilityEvents, setObservabilityEvents] = useState<ObservabilityEvent[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const clientRef = useRef<JarvisRealtimeClient | null>(null);
  const squadChatExpandedRef = useRef(false);

  async function connect() {
    if (connectionState === "connecting") return;
    if (connectionState === "connected" && clientRef.current?.isActive()) return;

    clientRef.current?.disconnect();
    clientRef.current = null;

    const client = new JarvisRealtimeClient({
      onConnectionState: setConnectionState,
      onMood: setMood,
      onMouthShape: setMouthShape,
      onTranscript: (entry, kind = entry.role === "jarvis" ? "jarvis_final" : entry.role === "user" ? "user" : entry.role === "tool" ? "tool" : "system") => {
        setTranscript((items) => commitTranscript(items, entry, kind));
        if (entry.role === "user" || entry.role === "jarvis") {
          if (entry.role === "jarvis") {
            setSpeakingText(entry.text);
            setHudFeed((items) => [`Jarvis: ${entry.text}`, ...items].slice(0, 4));
          }
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
            technical: artifactTechnicalText(nextArtifact),
            status: "done",
          }),
        );
        if (!squadChatExpandedRef.current && page !== "voice") setPage("observability");
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
          setSpeakingText("");
          setHudFeed((items) => [`You: ${activity.text}`, ...items].slice(0, 4));
        } else if (activity.kind === "speaking") {
          setSpeakingText(activity.text);
        } else {
          setHudActivity({ kind: activity.kind, text: activity.text });
          const feedLine =
            activity.kind === "tool_start"
              ? `▶ ${activity.text}`
              : activity.kind === "tool_error"
                ? `✗ ${activity.text}`
                : `✓ ${activity.text}`;
          setHudFeed((items) => [feedLine, ...items].slice(0, 4));
          setObservabilityEvents((items) =>
            pushObservabilityEvent(items, {
              role: "tool",
              narrative: activity.text,
              technical: activity.technical,
              tool: activity.tool,
              status: activity.status || (activity.kind === "tool_start" ? "running" : activity.kind === "tool_error" ? "error" : "done"),
            }),
          );
          if (activity.kind === "tool_start" || activity.kind === "tool_done" || activity.kind === "tool_error") {
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
    setSpeakingText("");
    setHudFeed([]);
    setHudActivity({ kind: "idle", text: "" });
    setTranscript((items) => [newEntry("system", "Voice disconnected."), ...items].slice(0, 80));
  }

  function sendTextPrompt() {
    const trimmed = textPrompt.trim();
    if (!trimmed || chatBusy) return;
    setTextPrompt("");
    void deliverUserMessage({ channel: "keyboard", message: trimmed, target: { id: "jarvis", name: prefs.assistantName } });
  }

  async function deliverUserMessage({
    channel,
    message,
    target,
  }: {
    channel: "chat" | "keyboard" | "voice";
    message: string;
    target: { id: string; name: string; scope?: string };
  }) {
    const trimmed = message.trim();
    if (!trimmed || chatBusy) return;

    const mentionPrefix = channel === "chat" ? buildMentionPrefix(trimmed) : "";

    setTranscript((items) => commitTranscript(items, newEntry("user", trimmed), "user"));
    setLastHeard(trimmed);
    setObservabilityEvents((items) =>
      pushObservabilityEvent(items, {
        role: "user",
        narrative: trimmed,
        status: "done",
      }),
    );
    if (channel === "chat") setPage("squad");
    else setPage("voice");

    setChatBusy(true);
    try {
      const result = await window.jarvis.sendChatMessage({
        target: target.id,
        message: `${mentionPrefix}${trimmed}`,
        channel,
      });
      if (result.ok === false) {
        const err = result.error || "Message failed";
        setTranscript((items) => commitTranscript(items, newEntry("system", err), "system"));
        setObservabilityEvents((items) =>
          pushObservabilityEvent(items, {
            role: "system",
            narrative: err,
            status: "error",
          }),
        );
        setMood("error");
        return;
      }

      if (result.activity?.length) {
        setObservabilityEvents((items) => {
          let next = items;
          for (const step of result.activity || []) {
            next = pushObservabilityEvent(next, {
              role: "tool",
              narrative: step.narrative,
              technical: step.technical,
              tool: step.tool,
              status: step.status || "done",
            });
          }
          return next;
        });
      }

      const reply = sanitizeSquadChatReply(result.text?.trim() || "Done.");
      const artifacts = (result.artifacts || []).filter((item) => item.kind === "code" || item.kind === "table");
      const jarvisEntry: TranscriptEntry = { ...newEntry("jarvis", reply) };
      if (artifacts.length > 0) {
        jarvisEntry.artifacts = artifacts;
        const primary = artifacts.find((item) => item.kind === "code") || artifacts[0];
        jarvisEntry.artifact = primary;
        jarvisEntry.technical = artifactTechnicalText(primary);
        setArtifact(primary);
        setObservabilityEvents((items) =>
          pushObservabilityEvent(items, {
            role: "artifact",
            narrative: primary.title,
            technical: jarvisEntry.technical,
            status: "done",
          }),
        );
      }
      setTranscript((items) => commitTranscript(items, jarvisEntry, "jarvis_final"));
      setSpeakingText(reply);
      setHudFeed((items) => [`Jarvis: ${reply}`, ...items].slice(0, 4));
      setObservabilityEvents((items) =>
        pushObservabilityEvent(items, {
          role: "jarvis",
          narrative: reply,
          status: "done",
        }),
      );
      setTaskRefreshToken((value) => value + 1);
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      setTranscript((items) => commitTranscript(items, newEntry("system", err), "system"));
      setMood("error");
    } finally {
      setChatBusy(false);
      if (connectionState !== "connected") setMood("idle");
    }
  }

  async function sendSquadChat(target: { id: string; name: string; scope?: string }, message: string) {
    await deliverUserMessage({ channel: "chat", message, target });
  }

  function goInvestigate(seed: { kind: "user" | "ip" | "host"; value: string }) {
    setPendingSeed({ ...seed, value: seed.value });
    setPage("investigate");
  }

  function onSearchSubmit() {
    const trimmed = search.trim();
    if (!trimmed) return;
    const seed = parseSearchSeed(trimmed);
    if (seed) {
      setSearch("");
      goInvestigate(seed);
      return;
    }
    setSearch("");
    setPage("voice");
    setTextPrompt("");
    void deliverUserMessage({ channel: "keyboard", message: trimmed, target: { id: "jarvis", name: prefs.assistantName } });
  }

  return (
    <>
      <AppShell
        page={page}
        onPage={setPage}
        productName={prefs.productName}
        railCollapsed={prefs.railCollapsed}
        onToggleRail={() => updatePrefs({ railCollapsed: !prefs.railCollapsed })}
        search={search}
        onSearch={setSearch}
        onSearchSubmit={onSearchSubmit}
        lookbackHours={lookbackHours}
        onLookbackHours={setLookbackHours}
        connectionState={connectionState}
        mood={mood}
        mouthShape={mouthShape}
      >
        {page === "voice" ? (
          <VoicePage
            connectionState={connectionState}
            mood={mood}
            mouthShape={mouthShape}
            activity={hudActivity}
            lastHeard={lastHeard}
            speakingText={speakingText}
            feed={hudFeed}
            transcript={transcript}
            textPrompt={textPrompt}
            onTextPrompt={setTextPrompt}
            onSend={sendTextPrompt}
            onConnect={() => void connect()}
            onDisconnect={disconnect}
            chatBusy={chatBusy}
            showTypeInput={showTypeInput}
            onToggleType={() => setShowTypeInput((value) => !value)}
            assistantName={prefs.assistantName}
          />
        ) : null}
        {page === "assurance" ? (
          <AssurancePage
            snapshot={dashboard.snapshot}
            loading={dashboard.loading}
            error={dashboard.error}
            onRefresh={dashboard.reload}
            sessionLog={transcript}
            onInvestigateDevice={(name) => goInvestigate({ kind: "host", value: name })}
            assistantName={prefs.assistantName}
            onOpenSettings={() => setPage("settings")}
          />
        ) : null}
        {page === "investigate" ? (
          <InvestigationsPage lookbackHours={lookbackHours} onLookbackHours={setLookbackHours} pendingSeed={pendingSeed} />
        ) : null}
        {page === "inventory" ? (
          <InventoryPage
            snapshot={dashboard.snapshot}
            onInvestigate={(name) => goInvestigate({ kind: "host", value: name })}
            onOpenSettings={() => setPage("settings")}
          />
        ) : null}
        {page === "squad" ? (
          <div className="page page-embed">
            <TeamBoard
              mood={mood}
              active
              refreshToken={taskRefreshToken}
              sessionLog={transcript}
              connectionState={connectionState}
              chatBusy={chatBusy}
              onSendSquadChat={sendSquadChat}
              onChatExpandedChange={(expanded) => {
                squadChatExpandedRef.current = expanded;
              }}
            />
          </div>
        ) : null}
        {page === "observability" ? (
          <div className="page">
            <header className="page-toolbar">
              <div>
                <h1>Observability</h1>
                <p className="page-sub">Technical, CLI, and narrative from the last tool run</p>
              </div>
            </header>
            <ObservabilityPanel events={observabilityEvents} artifact={artifact} sessionLog={transcript} />
          </div>
        ) : null}
        {page === "reports" ? (
          <div className="page">
            <header className="page-toolbar">
              <div>
                <h1>Reports</h1>
                <p className="page-sub">Saved CLI, tables, and investigation artifacts</p>
              </div>
            </header>
            <ArtifactsPanel assistantName={prefs.assistantName} />
          </div>
        ) : null}
        {page === "settings" ? (
          <SettingsPage
            prefs={prefs}
            onPrefs={updatePrefs}
            theme={theme}
            onTheme={setTheme}
            snapshot={dashboard.snapshot}
          />
        ) : null}
      </AppShell>
    </>
  );
}
