import { useRef, useState } from "react";
import { MessageSquare, RefreshCw } from "lucide-react";
import { AppShell, PageHeader, type PageKey } from "./components/shell/AppShell";
import { CopilotDrawer, type HudActivity } from "./components/CopilotDrawer";
import { OpsDashboard } from "./components/OpsDashboard";
import { InvestigationsPage } from "./components/InvestigationsPage";
import { TeamBoard } from "./components/TeamBoard";
import { ArtifactsPanel } from "./components/ArtifactsPanel";
import { ObservabilityPanel, type ObservabilityEvent } from "./components/ObservabilityPanel";
import { useDashboard } from "./hooks/useDashboard";
import { useTheme } from "./hooks/useTheme";
import { useTeamTasks } from "./hooks/useTeamTasks";
import { JarvisRealtimeClient, newEntry, type JarvisConnectionState, type JarvisMood, type MouthShape, type TranscriptEntry } from "./lib/realtime";
import { artifactTechnicalText } from "./lib/observability";
import { sanitizeSquadChatReply } from "./lib/chatReplySanitizer";
import { buildMentionPrefix } from "./lib/squadMentions";
import { commitTranscript } from "./lib/transcriptGate";
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
  const { theme, toggle: toggleTheme } = useTheme();
  const dashboard = useDashboard();
  const [page, setPage] = useState<PageKey>("overview");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [connectionState, setConnectionState] = useState<JarvisConnectionState>("idle");
  const [mood, setMood] = useState<JarvisMood>("idle");
  const [hudActivity, setHudActivity] = useState<HudActivity>({ kind: "idle", text: "" });
  const [lastHeard, setLastHeard] = useState("");
  const [speakingText, setSpeakingText] = useState("");
  const [artifact, setArtifact] = useState<JarvisArtifact | null>(null);
  const [newOutput, setNewOutput] = useState<string | null>(null);
  const [mouthShape, setMouthShape] = useState<MouthShape>({ open: 0, width: 0.18, round: 0, teeth: 0 });
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([newEntry("system", "NetJarvis is ready. Connect voice or type a question.")]);
  const [taskRefreshToken, setTaskRefreshToken] = useState(0);
  const [observabilityEvents, setObservabilityEvents] = useState<ObservabilityEvent[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const clientRef = useRef<JarvisRealtimeClient | null>(null);
  const pageRef = useRef<PageKey>("overview");
  pageRef.current = page;
  const squadTasks = useTeamTasks(true, taskRefreshToken);
  const activeTasks = squadTasks.tasks.filter((task) => task.status === "queued" || task.status === "in_progress").length;

  const isConnected = connectionState === "connected";

  function showArtifact(next: JarvisArtifact, { navigate }: { navigate: boolean }) {
    setArtifact(next);
    if (navigate) {
      setPage("observability");
      setNewOutput(null);
    } else if (pageRef.current !== "observability") {
      setNewOutput(next.title);
    }
  }

  async function connect() {
    if (connectionState === "connecting") return;
    if (connectionState === "connected" && clientRef.current?.isActive()) return;

    clientRef.current?.disconnect();
    clientRef.current = null;
    setDrawerOpen(true);

    const client = new JarvisRealtimeClient({
      onConnectionState: setConnectionState,
      onMood: setMood,
      onMouthShape: setMouthShape,
      onTranscript: (entry, kind = entry.role === "jarvis" ? "jarvis_final" : entry.role === "user" ? "user" : entry.role === "tool" ? "tool" : "system") => {
        setTranscript((items) => commitTranscript(items, entry, kind));
        if (entry.role === "user" || entry.role === "jarvis") {
          if (entry.role === "jarvis") setSpeakingText(entry.text);
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
        showArtifact(nextArtifact, { navigate: false });
        setObservabilityEvents((items) =>
          pushObservabilityEvent(items, {
            role: "artifact",
            narrative: nextArtifact.title,
            technical: artifactTechnicalText(nextArtifact),
            status: "done",
          }),
        );
      },
      onStatus: (message) => {
        setTranscript((items) => [newEntry("system", message), ...items].slice(0, 80));
        setObservabilityEvents((items) => pushObservabilityEvent(items, { role: "system", narrative: message, status: "done" }));
      },
      onActivity: (activity) => {
        if (activity.kind === "heard") {
          setLastHeard(activity.text);
          setSpeakingText("");
        } else if (activity.kind === "speaking") {
          setSpeakingText(activity.text);
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
          setTaskRefreshToken((value) => value + 1);
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
    setHudActivity({ kind: "idle", text: "" });
    setTranscript((items) => [newEntry("system", "Voice disconnected."), ...items].slice(0, 80));
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
    setObservabilityEvents((items) => pushObservabilityEvent(items, { role: "user", narrative: trimmed, status: "done" }));

    setChatBusy(true);
    if (!isConnected) setMood("working");
    try {
      const result = await window.jarvis.sendChatMessage({
        target: target.id,
        message: `${mentionPrefix}${trimmed}`,
        channel,
      });
      if (result.ok === false) {
        const err = result.error || "Message failed";
        setTranscript((items) => commitTranscript(items, newEntry("system", err), "system"));
        setObservabilityEvents((items) => pushObservabilityEvent(items, { role: "system", narrative: err, status: "error" }));
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
      const artifacts = (result.artifacts || []).filter((item) => item.kind === "code" || item.kind === "table" || item.kind === "markdown" || item.kind === "mermaid");
      const jarvisEntry: TranscriptEntry = { ...newEntry("jarvis", reply) };
      if (artifacts.length > 0) {
        const technical = artifacts.filter((item) => item.kind === "code" || item.kind === "table");
        const primary = technical.find((item) => item.kind === "code") || artifacts[0];
        jarvisEntry.artifacts = technical;
        jarvisEntry.artifact = technical[0];
        jarvisEntry.technical = technical[0] ? artifactTechnicalText(technical[0]) : undefined;
        showArtifact(primary, { navigate: false });
        setObservabilityEvents((items) =>
          pushObservabilityEvent(items, {
            role: "artifact",
            narrative: primary.title,
            technical: artifactTechnicalText(primary),
            status: "done",
          }),
        );
      }
      setTranscript((items) => commitTranscript(items, jarvisEntry, "jarvis_final"));
      setSpeakingText(reply);
      setObservabilityEvents((items) => pushObservabilityEvent(items, { role: "jarvis", narrative: reply, status: "done" }));
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

  async function askFromTopBar(message: string) {
    setDrawerOpen(true);
    await deliverUserMessage({ channel: "keyboard", message, target: { id: "jarvis", name: "NetJarvis" } });
  }

  return (
    <AppShell
      page={page}
      onNavigate={(next) => {
        setPage(next);
        if (next === "observability") setNewOutput(null);
      }}
      counts={{ squad: activeTasks }}
      snapshot={dashboard.snapshot}
      connectionState={connectionState}
      mood={mood}
      theme={theme}
      onToggleTheme={toggleTheme}
      drawerOpen={drawerOpen}
      onToggleDrawer={() => setDrawerOpen((value) => !value)}
      onAsk={askFromTopBar}
      askBusy={chatBusy}
      onConnectVoice={() => void connect()}
      onDisconnectVoice={disconnect}
      newOutput={
        newOutput
          ? {
              title: newOutput,
              onOpen: () => {
                setPage("observability");
                setNewOutput(null);
              },
              onDismiss: () => setNewOutput(null),
            }
          : null
      }
      drawer={
        <CopilotDrawer
          connectionState={connectionState}
          mood={mood}
          mouthShape={mouthShape}
          activity={hudActivity}
          lastHeard={lastHeard}
          speakingText={speakingText}
          transcript={transcript}
          busy={chatBusy}
          onConnect={() => void connect()}
          onDisconnect={disconnect}
          onSend={(message) => deliverUserMessage({ channel: "keyboard", message, target: { id: "jarvis", name: "NetJarvis" } })}
          onClose={() => setDrawerOpen(false)}
        />
      }
    >
      <div className="page">
        {page === "overview" ? (
          <>
            <PageHeader
              page="overview"
              actions={
                <>
                  <button type="button" className="ui-btn ui-btn-secondary" onClick={() => void dashboard.refresh()} disabled={dashboard.loading}>
                    <RefreshCw size={14} className={dashboard.loading ? "spin" : ""} /> Refresh
                  </button>
                  <button type="button" className="ui-btn ui-btn-primary" onClick={() => void askFromTopBar("How is my network doing?")} disabled={chatBusy}>
                    <MessageSquare size={14} /> Ask for the rundown
                  </button>
                </>
              }
            />
            <OpsDashboard snapshot={dashboard.snapshot} loading={dashboard.loading} error={dashboard.error} onRefresh={() => void dashboard.refresh()} sessionLog={transcript} />
          </>
        ) : null}

        {page === "investigations" ? (
          <>
            <PageHeader page="investigations" />
            <InvestigationsPage onOpenArtifact={(next) => showArtifact(next, { navigate: true })} onActivity={() => setTaskRefreshToken((value) => value + 1)} />
          </>
        ) : null}

        {page === "squad" ? (
          <>
            <PageHeader page="squad" />
            <TeamBoard mood={mood} active refreshToken={taskRefreshToken} sessionLog={transcript} connectionState={connectionState} chatBusy={chatBusy} onSendSquadChat={sendSquadChat} />
          </>
        ) : null}

        {page === "observability" ? (
          <>
            <PageHeader page="observability" />
            <ObservabilityPanel events={observabilityEvents} artifact={artifact} sessionLog={transcript} theme={theme} />
          </>
        ) : null}

        {page === "reports" ? (
          <>
            <PageHeader page="reports" />
            <ArtifactsPanel />
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
