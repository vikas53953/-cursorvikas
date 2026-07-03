import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AtSign, Hash, Loader2, Maximize2, Minimize2, Send, Sparkles, Users } from "lucide-react";
import type { JarvisConnectionState, TranscriptEntry } from "../lib/realtime";
import { filterMentionSuggestions, splitMentionText, type SquadMention } from "../lib/squadMentions";
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

// Enterprise-style squad chat — Slack / Teams feel with @mentions and full-chat stage.
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
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
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
    function onKeyDown(event: globalThis.KeyboardEvent) {
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
  const mentionSuggestions = mentionQuery !== null ? filterMentionSuggestions(mentionQuery) : [];

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, sessionLog, chatBusy, expanded]);

  useEffect(() => {
    if (expanded) composerRef.current?.focus();
  }, [expanded, targetId]);

  function updateMentionState(value: string, cursor: number) {
    const before = value.slice(0, cursor);
    const match = before.match(/@([a-z0-9_-]*)$/i);
    if (match) {
      setMentionQuery(match[1].toLowerCase());
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  function insertMention(mention: SquadMention) {
    const field = composerRef.current;
    if (!field) return;
    const cursor = field.selectionStart || draft.length;
    const before = draft.slice(0, cursor);
    const after = draft.slice(cursor);
    const replaced = before.replace(/@([a-z0-9_-]*)$/i, `@${mention.handle} `);
    const next = `${replaced}${after}`;
    setDraft(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const pos = replaced.length;
      field.focus();
      field.setSelectionRange(pos, pos);
      resizeComposer(field);
    });
  }

  async function submit() {
    const trimmed = draft.trim();
    if (!trimmed || !target || busy) return;
    setSending(true);
    setMentionQuery(null);
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

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionSuggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((value) => (value + 1) % mentionSuggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((value) => (value - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && mentionQuery !== null)) {
        event.preventDefault();
        insertMention(mentionSuggestions[mentionIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
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
                  <strong>{expanded ? "# network-ops" : target?.name || "NetJarvis"}</strong>
                  <span className={`squad-chat-presence ${voiceLive ? "squad-chat-presence-live" : ""}`} title={voiceLive ? "Voice connected" : "Text chat"}>
                    {voiceLive ? "Live" : "Text"}
                  </span>
                </div>
                <span className="squad-chat-channel-sub">
                  {expanded ? `${targets.length} members · use @data @security @jarvis` : target?.id === "jarvis" ? "# network-ops" : `DM · ${target?.id || "agent"}`}
                </span>
              </div>
            </div>

            {onToggleExpand ? (
              <button
                type="button"
                className={`squad-chat-expand-btn ${expanded ? "" : "squad-chat-expand-btn-labeled"}`}
                onClick={onToggleExpand}
                aria-label={expanded ? "Exit full chat" : "Open full chat"}
                title={expanded ? "Exit full chat (Esc)" : "Open full chat workspace"}
              >
                {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                {!expanded ? <span>Full chat</span> : null}
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
            Squad channel — mention specialists with @data, @firewall, @security, @incident, etc. Jarvis routes and delegates automatically.
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
              <strong>{expanded ? "Welcome to #network-ops" : "Start a conversation"}</strong>
              <p>
                {expanded
                  ? "Your NOC chatops channel. Run show commands, triage incidents, or hand off with @mentions — e.g. @data check spanning tree on sw2."
                  : `Message ${target?.name || "NetJarvis"} here, or open Full chat for the workspace with @mentions and all ${targets.length} squad members.`}
              </p>
              {expanded ? (
                <div className="squad-chat-mention-guide">
                  <span>@jarvis</span>
                  <span>@data</span>
                  <span>@security</span>
                  <span>@incident</span>
                  <span>@change</span>
                </div>
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
          <div className="squad-chat-compose-toolbar">
            <button
              type="button"
              className="squad-chat-tool-btn"
              onClick={() => {
                setDraft((value) => `${value}${value.endsWith(" ") || value.length === 0 ? "" : " "}@`);
                composerRef.current?.focus();
              }}
              title="Mention a squad member (@data, @security, …)"
            >
              <AtSign size={14} />
            </button>
            <small className="squad-chat-mention-hint">@data · @security · @incident · @jarvis</small>
          </div>
          <div className="squad-chat-compose-box">
            <textarea
              ref={composerRef}
              value={draft}
              rows={1}
              onChange={(event) => {
                setDraft(event.target.value);
                resizeComposer(event.target);
                updateMentionState(event.target.value, event.target.selectionStart || event.target.value.length);
              }}
              onKeyDown={handleComposerKeyDown}
              onClick={(event) => updateMentionState(event.currentTarget.value, event.currentTarget.selectionStart || 0)}
              placeholder={expanded ? "Message #network-ops — use @data, @security, @jarvis…" : `Message ${target?.name || "NetJarvis"}…`}
              disabled={busy}
              aria-label="Message input"
            />
            {mentionSuggestions.length > 0 ? (
              <ul className="squad-chat-mention-menu" role="listbox">
                {mentionSuggestions.map((mention, index) => (
                  <li key={`${mention.id}-${mention.handle}`}>
                    <button
                      type="button"
                      className={index === mentionIndex ? "squad-chat-mention-option-active" : ""}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        insertMention(mention);
                      }}
                    >
                      <strong>@{mention.handle}</strong>
                      <span>{mention.label}</span>
                      <em>{mention.group}</em>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="squad-chat-compose-bar">
              <small className="squad-chat-hint">
                {expanded
                  ? voiceLive
                    ? "Voice live — @mention routes to specialists"
                    : "Shift+Enter new line · @mention to delegate"
                  : "Enter to send · Full chat button above"}
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
        <strong># network-ops</strong>
        <p>{targets.length} members · type @ in chat</p>
      </header>

      <section className="squad-chat-sidebar-section">
        <h4>Channel</h4>
        <ul>
          <li>
            <button type="button" className={`squad-chat-channel-btn ${activeId === "jarvis" ? "squad-chat-channel-btn-active" : ""}`} onClick={() => onSelect("jarvis")}>
              <span className="squad-chat-avatar squad-chat-avatar-jarvis">NJ</span>
              <span className="squad-chat-channel-btn-text">
                <strong># network-ops</strong>
                <small>@jarvis · squad channel</small>
              </span>
            </button>
          </li>
        </ul>
      </section>

      <section className="squad-chat-sidebar-section">
        <h4>Direct messages</h4>
        <ul>
          {targets
            .filter((item) => item.id !== "jarvis")
            .map((item) => (
              <ChannelItem key={item.id} item={item} active={activeId === item.id} onSelect={onSelect} />
            ))}
        </ul>
      </section>

      {org?.groups?.map((group) => (
        <section className="squad-chat-sidebar-section" key={group.id}>
          <h4>{group.name}</h4>
          <ul className="squad-chat-handle-list">
            {group.agents.map((agent) => (
              <li key={agent.id}>
                <code>@{agent.id}</code>
              </li>
            ))}
          </ul>
        </section>
      ))}
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
          <small>@{item.id}</small>
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
          <MessageText text={entry.text} />
        </div>
      </div>
    </article>
  );
}

function MessageText({ text }: { text: string }) {
  const parts = splitMentionText(text);
  return (
    <p>
      {parts.map((part, index) =>
        part.type === "mention" ? (
          <span key={index} className={part.handle ? "squad-chat-mention" : "squad-chat-mention-invalid"}>
            {part.value}
          </span>
        ) : (
          <span key={index}>{part.value}</span>
        ),
      )}
    </p>
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
