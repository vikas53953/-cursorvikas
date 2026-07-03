import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hash, Loader2, Maximize2, Minimize2, Send, Sparkles, Users } from "lucide-react";
import type { JarvisConnectionState, TranscriptEntry } from "../lib/realtime";
import type { AgentOrg } from "../vite-env";

export type SquadChatTarget = {
  id: string;
  name: string;
  scope?: string;
};

type SquadChatPanelProps = {
  sessionLog: TranscriptEntry[];
  connectionState: JarvisConnectionState;
  chatBusy?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onSend: (target: SquadChatTarget, message: string) => void | Promise<void>;
};

type ChatMessage = {
  id: string;
  role: "user" | "jarvis";
  text: string;
  at: string;
};

// Enterprise-style squad chat — Slack / Teams feel with rail + maximized stage.
export function SquadChatPanel({
  sessionLog,
  connectionState,
  chatBusy = false,
  expanded = false,
  onToggleExpand,
  onSend,
}: SquadChatPanelProps) {
  const [org, setOrg] = useState<AgentOrg | null>(null);
  const [targetId, setTargetId] = useState("jarvis");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      setOrg(await window.jarvis.getOrg());
    } catch {
      // Keep last good org chart.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onToggleExpand?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, onToggleExpand]);

  const targets = buildTargets(org);
  const target = targets.find((item) => item.id === targetId) || targets[0];
  const messages = useMemo(
    () =>
      sessionLog
        .filter((entry) => entry.role === "user" || entry.role === "jarvis")
        .slice(0, 80)
        .reverse()
        .map((entry) => ({
          id: entry.id,
          role: entry.role as "user" | "jarvis",
          text: entry.text,
          at: entry.at,
        })),
    [sessionLog],
  );
  const busy = sending || chatBusy;
  const voiceLive = connectionState === "connected";

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, sessionLog, chatBusy, expanded]);

  useEffect(() => {
    if (expanded) composerRef.current?.focus();
  }, [expanded, targetId]);

  async function submit() {
    const trimmed = draft.trim();
    if (!trimmed || !target || busy) return;
    setSending(true);
    try {
      await onSend(target, trimmed);
      setDraft("");
      if (composerRef.current) composerRef.current.style.height = "auto";
    } finally {
      setSending(false);
    }
  }

  function resizeComposer(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, expanded ? 160 : 96)}px`;
  }

  const rootClass = ["squad-chat", expanded ? "squad-chat-stage" : "squad-chat-rail"].filter(Boolean).join(" ");

  return (
    <aside className={rootClass} aria-label="Network Agent Squad chat">
      {expanded ? (
        <ChannelSidebar targets={targets} activeId={targetId} onSelect={setTargetId} org={org} />
      ) : null}

      <div className="squad-chat-main">
        <header className={`squad-chat-topbar ${expanded ? "" : "squad-chat-topbar-rail"}`}>
          <div className="squad-chat-topbar-primary">
            <div className="squad-chat-channel">
              <span className="squad-chat-channel-icon" aria-hidden="true">
                {target?.id === "jarvis" ? <Sparkles size={14} /> : <Hash size={14} />}
              </span>
              <div className="squad-chat-channel-meta">
                <div className="squad-chat-channel-title-row">
                  <strong>{target?.name || "NetJarvis"}</strong>
                  <span className={`squad-chat-presence ${voiceLive ? "squad-chat-presence-live" : ""}`} title={voiceLive ? "Voice connected" : "Text chat"}>
                    {voiceLive ? "Live" : "Text"}
                  </span>
                </div>
                <span className="squad-chat-channel-sub">
                  {target?.id === "jarvis" ? "# network-ops" : `DM · ${target?.id || "agent"}`}
                </span>
              </div>
            </div>

            {onToggleExpand ? (
              <button
                type="button"
                className="squad-chat-expand-btn"
                onClick={onToggleExpand}
                aria-label={expanded ? "Exit full chat" : "Open full chat"}
                title={expanded ? "Exit full chat (Esc)" : "Open full chat"}
              >
                {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
            ) : null}
          </div>

          {!expanded ? (
            <label className="squad-chat-rail-picker">
              <span>Chat with</span>
              <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                {targets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="squad-chat-topbar-actions">
              <span className="squad-chat-members">
                <Users size={13} /> {targets.length} members
              </span>
            </div>
          )}
        </header>

        {target && expanded ? (
          <p className="squad-chat-scope" title={target.scope}>
            {target.id === "jarvis" ? "Squad lead — routes to the right specialist" : target.scope || target.name}
          </p>
        ) : null}

        <div className="squad-chat-feed" ref={feedRef}>
          {messages.length === 0 ? (
            <div className={`squad-chat-welcome ${expanded ? "" : "squad-chat-welcome-rail"}`}>
              {expanded ? (
                <div className="squad-chat-welcome-icon" aria-hidden="true">
                  <Hash size={22} />
                </div>
              ) : null}
              <strong>{expanded ? "Welcome to Network Agent Squad" : "Start a conversation"}</strong>
              <p>
                {expanded
                  ? `This is your NOC operations channel. Message ${target?.name || "NetJarvis"} about the network — run show commands, delegate to specialists, or triage incidents. Voice is optional.`
                  : `Message ${target?.name || "NetJarvis"} about the network. Use the expand button above for the full chat workspace.`}
              </p>
              {!expanded ? (
                <button type="button" className="squad-chat-open-full" onClick={onToggleExpand}>
                  <Maximize2 size={14} /> Open full chat
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="squad-chat-day-divider">
                <span>Today</span>
              </div>
              {messages.map((entry, index) => (
                <ChatMessageRow
                  key={entry.id}
                  entry={entry}
                  showAvatar={index === 0 || messages[index - 1]?.role !== entry.role}
                  expanded={expanded}
                  targetName={target?.name || "NetJarvis"}
                />
              ))}
            </>
          )}
          {busy ? <TypingIndicator targetName={target?.name || "NetJarvis"} expanded={expanded} /> : null}
        </div>

        <footer className="squad-chat-compose">
          <div className="squad-chat-compose-box">
            <textarea
              ref={composerRef}
              value={draft}
              rows={1}
              onChange={(event) => {
                setDraft(event.target.value);
                resizeComposer(event.target);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder={`Message ${target?.name || "NetJarvis"}`}
              disabled={busy}
              aria-label="Message input"
            />
            <div className="squad-chat-compose-bar">
              <small className="squad-chat-hint">
                {expanded
                  ? voiceLive
                    ? "Voice live — text and speech share this session"
                    : "Shift+Enter for new line · Enter to send"
                  : "Enter to send"}
              </small>
              <button
                type="button"
                className="squad-chat-send-btn"
                onClick={() => void submit()}
                disabled={busy || !draft.trim()}
                aria-label="Send message"
                title="Send (Enter)"
              >
                {busy ? <Loader2 size={16} className="squad-chat-spinner" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </aside>
  );
}

function ChannelSidebar({
  targets,
  activeId,
  onSelect,
  org,
}: {
  targets: SquadChatTarget[];
  activeId: string;
  onSelect: (id: string) => void;
  org: AgentOrg | null;
}) {
  return (
    <nav className="squad-chat-sidebar" aria-label="Squad channels">
      <header className="squad-chat-sidebar-header">
        <span className="squad-chat-eyebrow">Agent Squad</span>
        <strong>Channels</strong>
      </header>

      <section className="squad-chat-sidebar-section">
        <h4>Lead</h4>
        <ul>
          {targets
            .filter((item) => item.id === "jarvis")
            .map((item) => (
              <ChannelItem key={item.id} item={item} active={activeId === item.id} onSelect={onSelect} />
            ))}
        </ul>
      </section>

      {org?.groups?.map((group) => {
        const agents = targets.filter((item) => group.agents.some((agent) => agent.id === item.id));
        if (agents.length === 0) return null;
        return (
          <section className="squad-chat-sidebar-section" key={group.id}>
            <h4>{group.name}</h4>
            <ul>
              {agents.map((item) => (
                <ChannelItem key={item.id} item={item} active={activeId === item.id} onSelect={onSelect} />
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}

function ChannelItem({
  item,
  active,
  onSelect,
}: {
  item: SquadChatTarget;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const initials = avatarInitials(item.name, item.id === "jarvis" ? "jarvis" : "user");
  return (
    <li>
      <button type="button" className={`squad-chat-channel-btn ${active ? "squad-chat-channel-btn-active" : ""}`} onClick={() => onSelect(item.id)}>
        <span className={`squad-chat-avatar squad-chat-avatar-${initials.tone}`}>{initials.label}</span>
        <span className="squad-chat-channel-btn-text">
          <strong>{item.name}</strong>
          <small>{item.id === "jarvis" ? "Squad lead" : "Specialist"}</small>
        </span>
      </button>
    </li>
  );
}

function ChatMessageRow({
  entry,
  showAvatar,
  expanded,
  targetName,
}: {
  entry: ChatMessage;
  showAvatar: boolean;
  expanded: boolean;
  targetName: string;
}) {
  const isUser = entry.role === "user";
  const initials = avatarInitials(isUser ? "You" : targetName, isUser ? "user" : "jarvis");

  return (
    <article className={`squad-chat-row ${isUser ? "squad-chat-row-user" : "squad-chat-row-agent"} ${expanded ? "squad-chat-row-expanded" : ""}`}>
      {showAvatar ? (
        <span className={`squad-chat-avatar squad-chat-avatar-${initials.tone}`} aria-hidden="true">
          {initials.label}
        </span>
      ) : (
        <span className="squad-chat-avatar-spacer" aria-hidden="true" />
      )}
      <div className="squad-chat-row-body">
        {showAvatar ? (
          <header className="squad-chat-row-meta">
            <strong>{isUser ? "You" : targetName}</strong>
            <time>{entry.at}</time>
          </header>
        ) : (
          <time className="squad-chat-row-time-hover">{entry.at}</time>
        )}
        <div className={`squad-chat-bubble ${isUser ? "squad-chat-bubble-user" : "squad-chat-bubble-agent"}`}>
          <p>{entry.text}</p>
        </div>
      </div>
    </article>
  );
}

function TypingIndicator({ targetName, expanded }: { targetName: string; expanded: boolean }) {
  const initials = avatarInitials(targetName, "jarvis");
  return (
    <article className={`squad-chat-row squad-chat-row-agent squad-chat-row-typing ${expanded ? "squad-chat-row-expanded" : ""}`}>
      <span className={`squad-chat-avatar squad-chat-avatar-${initials.tone}`}>{initials.label}</span>
      <div className="squad-chat-row-body">
        <header className="squad-chat-row-meta">
          <strong>{targetName}</strong>
          <Loader2 size={12} className="squad-chat-spinner" />
        </header>
        <div className="squad-chat-bubble squad-chat-bubble-agent squad-chat-bubble-typing">
          <span className="squad-chat-typing-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Working on your request…</span>
        </div>
      </div>
    </article>
  );
}

function avatarInitials(name: string, tone: "user" | "jarvis") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const label =
    tone === "user"
      ? "ME"
      : parts.length >= 2
        ? `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase()
        : (parts[0]?.slice(0, 2) || "NJ").toUpperCase();
  return { label, tone };
}

function buildTargets(org: AgentOrg | null): SquadChatTarget[] {
  const jarvis: SquadChatTarget = {
    id: "jarvis",
    name: org?.jarvis?.name || "NetJarvis",
    scope: "Squad lead — coordinates and delegates to specialists",
  };
  const agents =
    org?.groups?.flatMap((group) =>
      group.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        scope: agent.scope,
      })),
    ) || [];
  return [jarvis, ...agents];
}
