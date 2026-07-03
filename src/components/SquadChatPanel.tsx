import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronLeft, ChevronRight, Copy, Hash, Loader2, Maximize2, Minimize2, Send, Sparkles, Users } from "lucide-react";
import type { JarvisConnectionState, TranscriptEntry } from "../lib/realtime";
import { splitArtifactOutput } from "../lib/observability";
import { buildMemberMentions, filterMemberMentions, splitMentionText, type SquadMention } from "../lib/squadMentions";
import { expandSlashCommand, filterSlashCommands, type SlashCommand } from "../lib/squadSlashCommands";
import type { AgentOrg, JarvisArtifact } from "../vite-env";

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
  artifact?: JarvisArtifact;
  artifacts?: JarvisArtifact[];
  technical?: string;
};

type PickerState = { kind: "mention" | "slash"; query: string };

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
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
  const members = useMemo(() => buildMemberMentions(targets, org), [targets, org]);
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
          artifact: entry.artifact,
          artifacts: entry.artifacts,
          technical: entry.technical,
        })),
    [sessionLog],
  );
  const busy = sending || chatBusy;
  const voiceLive = connectionState === "connected";

  const mentionSuggestions = picker?.kind === "mention" ? filterMemberMentions(members, picker.query) : [];
  const slashSuggestions = picker?.kind === "slash" ? filterSlashCommands(picker.query) : [];
  const pickerItems = picker?.kind === "mention" ? mentionSuggestions : slashSuggestions;
  const pickerOpen = picker !== null;

  useEffect(() => {
    if (pickerIndex >= pickerItems.length) setPickerIndex(0);
  }, [pickerItems.length, pickerIndex]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, sessionLog, chatBusy, expanded]);

  useEffect(() => {
    if (expanded) composerRef.current?.focus();
  }, [expanded, targetId]);

  function updatePickerState(value: string, cursor: number) {
    const before = value.slice(0, cursor);
    const slashMatch = before.match(/(?:^|\s)\/([a-z0-9_-]*)$/i);
    if (slashMatch) {
      setPicker({ kind: "slash", query: (slashMatch[1] || "").toLowerCase() });
      setPickerIndex(0);
      return;
    }
    const mentionMatch = before.match(/@([a-z0-9_-]*)$/i);
    if (mentionMatch) {
      setPicker({ kind: "mention", query: (mentionMatch[1] || "").toLowerCase() });
      setPickerIndex(0);
      return;
    }
    setPicker(null);
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
    setPicker(null);
    requestAnimationFrame(() => {
      const pos = replaced.length;
      field.focus();
      field.setSelectionRange(pos, pos);
      resizeComposer(field);
    });
  }

  function insertSlashCommand(command: SlashCommand) {
    const field = composerRef.current;
    if (!field) return;
    const cursor = field.selectionStart || draft.length;
    const before = draft.slice(0, cursor);
    const after = draft.slice(cursor);
    const replaced = before.replace(/(^|\s)\/([a-z0-9_-]*)$/i, (_match, lead: string) => `${lead}/${command.name} `);
    const next = `${replaced}${after}`;
    setDraft(next);
    setPicker(null);
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
    const payload = expandSlashCommand(trimmed);
    setDraft("");
    setPicker(null);
    if (composerRef.current) composerRef.current.style.height = "auto";
    setSending(true);
    try {
      await onSend(target, payload);
    } finally {
      setSending(false);
    }
  }

  function resizeComposer(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, expanded ? 160 : 96)}px`;
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (pickerOpen && pickerItems.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setPickerIndex((value) => (value + 1) % pickerItems.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setPickerIndex((value) => (value - 1 + pickerItems.length) % pickerItems.length);
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        if (picker?.kind === "mention") insertMention(mentionSuggestions[pickerIndex]);
        else insertSlashCommand(slashSuggestions[pickerIndex]);
        return;
      }
    }
    if (pickerOpen && event.key === "Escape") {
      event.preventDefault();
      setPicker(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  const rootClass = [
    "squad-chat",
    expanded ? "squad-chat-stage" : "squad-chat-rail",
    expanded && !sidebarOpen ? "squad-chat-sidebar-hidden" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <aside className={rootClass} aria-label="Network Agent Squad chat">
      {expanded && sidebarOpen ? <ChannelSidebar targets={targets} /> : null}
      {expanded ? (
        <div className="squad-chat-sidebar-edge">
          <button
            type="button"
            className="squad-chat-sidebar-toggle"
            onClick={() => setSidebarOpen((value) => !value)}
            aria-label={sidebarOpen ? "Hide channel sidebar" : "Show channel sidebar"}
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          >
            {sidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
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
                  <span className={`squad-chat-presence ${voiceLive ? "squad-chat-presence-live" : ""}`}>
                    {voiceLive ? "Live" : "Text"}
                  </span>
                </div>
                <span className="squad-chat-channel-sub">
                  {expanded ? `${targets.length} members` : target?.id === "jarvis" ? "# network-ops" : `DM · ${target?.id}`}
                </span>
              </div>
            </div>

            {onToggleExpand ? (
              <button
                type="button"
                className="squad-chat-expand-btn"
                onClick={onToggleExpand}
                aria-label={expanded ? "Collapse chat" : "Expand chat workspace"}
                title={expanded ? "Collapse (Esc)" : "Expand chat workspace"}
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
                  ? "Type @ to mention any squad member, or / for commands — same as Slack or Teams."
                  : `Message ${target?.name || "NetJarvis"}. Type @ or / in the composer, or expand the chat workspace.`}
              </p>
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
            {pickerOpen ? (
              <ul className="squad-chat-picker-menu" role="listbox" aria-label={picker?.kind === "mention" ? "Mention squad member" : "Slash commands"}>
                {pickerItems.length === 0 ? (
                  <li className="squad-chat-picker-empty">
                    {picker?.kind === "mention" ? "No matching members" : "No matching commands"}
                  </li>
                ) : picker?.kind === "mention" ? (
                  mentionSuggestions.map((mention, index) => (
                    <li key={mention.id}>
                      <button
                        type="button"
                        className={index === pickerIndex ? "squad-chat-picker-option-active" : ""}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          insertMention(mention);
                        }}
                      >
                        <span className={`squad-chat-picker-avatar squad-chat-avatar-${mention.id === "jarvis" ? "jarvis" : "user"}`}>
                          {mention.handle.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="squad-chat-picker-copy">
                          <strong>@{mention.handle}</strong>
                          <span>{mention.label}</span>
                        </span>
                        <em>{mention.group}</em>
                      </button>
                    </li>
                  ))
                ) : (
                  slashSuggestions.map((command, index) => (
                    <li key={command.name}>
                      <button
                        type="button"
                        className={index === pickerIndex ? "squad-chat-picker-option-active" : ""}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          insertSlashCommand(command);
                        }}
                      >
                        <span className="squad-chat-picker-slash">/</span>
                        <span className="squad-chat-picker-copy">
                          <strong>/{command.name}</strong>
                          <span>{command.description}</span>
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
            <textarea
              ref={composerRef}
              value={draft}
              rows={1}
              onChange={(event) => {
                setDraft(event.target.value);
                resizeComposer(event.target);
                updatePickerState(event.target.value, event.target.selectionStart || event.target.value.length);
              }}
              onKeyDown={handleComposerKeyDown}
              onClick={(event) => updatePickerState(event.currentTarget.value, event.currentTarget.selectionStart || 0)}
              onKeyUp={(event) => updatePickerState(event.currentTarget.value, event.currentTarget.selectionStart || 0)}
              placeholder={expanded ? "Message #network-ops" : `Message ${target?.name || "NetJarvis"}`}
              disabled={busy && !draft}
              aria-label="Message input"
            />
            <div className="squad-chat-compose-bar">
              <small className="squad-chat-hint">
                {pickerOpen
                  ? picker?.kind === "mention"
                    ? pickerItems.length > 0
                      ? `${pickerItems.length} member${pickerItems.length === 1 ? "" : "s"} · ↑↓ select · Enter insert`
                      : "No matches · keep typing or Esc"
                    : pickerItems.length > 0
                      ? `${pickerItems.length} command${pickerItems.length === 1 ? "" : "s"} · ↑↓ select · Enter insert`
                      : "No matches · keep typing or Esc"
                  : "@ mention · / command · Enter send"}
              </small>
              <button
                type="button"
                className="squad-chat-send-btn"
                onClick={() => void submit()}
                disabled={busy || !draft.trim()}
                aria-label="Send message"
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

function ChannelSidebar({ targets }: { targets: SquadChatTarget[] }) {
  return (
    <nav className="squad-chat-sidebar" aria-label="Squad channels">
      <header className="squad-chat-sidebar-header">
        <span className="squad-chat-eyebrow">Agent Squad</span>
        <strong># network-ops</strong>
        <p>{targets.length} members · type @ to mention</p>
      </header>

      <section className="squad-chat-sidebar-section">
        <h4>Channels</h4>
        <ul>
          <li>
            <div className="squad-chat-channel-btn squad-chat-channel-btn-active" aria-current="page">
              <span className="squad-chat-avatar squad-chat-avatar-jarvis">NJ</span>
              <span className="squad-chat-channel-btn-text">
                <strong># network-ops</strong>
                <small>Squad channel</small>
              </span>
            </div>
          </li>
        </ul>
      </section>
    </nav>
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
        {!isUser ? (
          <ChatOutputAttachments
            artifacts={entry.artifacts || (entry.artifact ? [entry.artifact] : [])}
            replyText={entry.text}
            technical={entry.technical}
          />
        ) : null}
      </div>
    </article>
  );
}

function ChatOutputAttachments({
  artifacts,
  replyText,
  technical,
}: {
  artifacts: JarvisArtifact[];
  replyText: string;
  technical?: string;
}) {
  if (artifacts.length === 0) return null;
  return (
    <>
      {artifacts.map((artifact, index) => (
        <ChatOutputAttachment
          key={`${artifact.title}-${index}`}
          artifact={artifact}
          technical={index === artifacts.length - 1 ? technical : undefined}
          replyText={index === 0 ? replyText : ""}
        />
      ))}
    </>
  );
}

function ChatOutputAttachment({
  artifact,
  technical,
  replyText,
}: {
  artifact: JarvisArtifact;
  technical?: string;
  replyText?: string;
}) {
  const [showTechnical, setShowTechnical] = useState(false);
  const [copied, setCopied] = useState(false);
  const split = splitArtifactOutput(artifact);
  const techText = technical || split.technical;
  const narrative =
    artifact.kind === "code"
      ? ""
      : split.narrative || (replyText ? summarizeReply(replyText) : "");

  async function copyOutput(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    await navigator.clipboard.writeText(techText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  if (!techText && !narrative) return null;

  return (
    <div className="squad-chat-attachment">
      <header className="squad-chat-attachment-head">
        <div>
          <strong>{artifact.title}</strong>
          <span>{artifact.kind === "code" ? "CLI output" : artifact.kind}</span>
        </div>
        {techText ? (
          <button type="button" className="squad-chat-attachment-copy" onClick={(event) => void copyOutput(event)} title="Copy technical output">
            <Copy size={12} />
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </header>

      {narrative ? (
        <section className="squad-chat-attachment-section">
          <small className="squad-chat-attachment-label">Summary</small>
          <p className="squad-chat-attachment-narrative">{narrative}</p>
        </section>
      ) : null}

      {techText ? (
        <section className="squad-chat-attachment-section">
          {!showTechnical ? (
            <button type="button" className="squad-chat-attachment-toggle" onClick={() => setShowTechnical(true)}>
              Show technical output
            </button>
          ) : (
            <>
              <div className="squad-chat-attachment-tech-head">
                <small className="squad-chat-attachment-label">Technical output</small>
              </div>
              <pre className="squad-chat-attachment-body">{techText}</pre>
              <button type="button" className="squad-chat-attachment-toggle" onClick={() => setShowTechnical(false)}>
                Hide technical output
              </button>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

function summarizeReply(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("```") && !line.startsWith("#"));
  return lines.slice(0, 4).join(" ");
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
