import { Fragment, type ReactNode } from "react";
import { splitMentionText } from "../lib/squadMentions";

// Lightweight, dependency-free markdown renderer tuned for chatops replies:
// headings, ordered/unordered lists, bold/italic/inline code, fenced code
// blocks, and @mention highlighting. Renders to safe React nodes (no innerHTML).

type ListItem = { text: string; depth: number };

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; lang?: string; content: string }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "divider" };

export function Markdown({ text, mentions = true }: { text: string; mentions?: boolean }) {
  const blocks = parseBlocks(text);
  return (
    <div className="md">
      {blocks.map((block, index) => (
        <MarkdownBlock key={index} block={block} mentions={mentions} />
      ))}
    </div>
  );
}

function MarkdownBlock({ block, mentions }: { block: Block; mentions: boolean }) {
  if (block.type === "code") {
    return (
      <pre className="md-code">
        <code>{block.content}</code>
      </pre>
    );
  }
  if (block.type === "divider") {
    return <hr className="md-divider" />;
  }
  if (block.type === "heading") {
    const Tag = (`h${Math.min(block.level, 4)}` as "h1" | "h2" | "h3" | "h4");
    return (
      <Tag className="md-heading">
        <Inline text={block.text} mentions={mentions} />
      </Tag>
    );
  }
  if (block.type === "list") {
    return <NestedList items={block.items} ordered={block.ordered} depth={0} mentions={mentions} />;
  }
  return (
    <p className="md-paragraph">
      <Inline text={block.text} mentions={mentions} />
    </p>
  );
}

function NestedList({
  items,
  ordered,
  depth,
  mentions,
}: {
  items: ListItem[];
  ordered: boolean;
  depth: number;
  mentions: boolean;
}) {
  const Tag = ordered ? "ol" : "ul";
  const elements: ReactNode[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    const children: ListItem[] = [];
    let j = i + 1;
    while (j < items.length && items[j].depth > item.depth) {
      children.push(items[j]);
      j += 1;
    }
    elements.push(
      <li key={i}>
        <Inline text={item.text} mentions={mentions} />
        {children.length > 0 ? (
          <NestedList items={children} ordered={ordered} depth={depth + 1} mentions={mentions} />
        ) : null}
      </li>,
    );
    i = j;
  }
  return <Tag className={`md-list${ordered ? " md-list-ordered" : ""}`}>{elements}</Tag>;
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: ListItem[] } | null = null;

  function flushParagraph() {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
  }
  function flushList() {
    if (list && list.items.length > 0) {
      blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    }
    list = null;
  }

  const indentToDepth = (indent: number) => Math.min(Math.floor(indent / 2), 4);

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    const indent = raw.length - raw.trimStart().length;

    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      const lang = line.slice(3).trim() || undefined;
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buffer.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: "code", lang, content: buffer.join("\n") });
      continue;
    }

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^(---|===|\*\*\*)$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "divider" });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    const unordered = line.match(/^[-*+]\s+(.*)$/);
    if (unordered) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push({ text: unordered[1].trim(), depth: indentToDepth(indent) });
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push({ text: ordered[1].trim(), depth: indentToDepth(indent) });
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

type Token = { type: "text" | "bold" | "italic" | "code"; value: string };

function Inline({ text, mentions }: { text: string; mentions: boolean }) {
  const tokens = tokenizeInline(text);
  return (
    <>
      {tokens.map((token, index) => {
        if (token.type === "code") {
          return (
            <code key={index} className="md-inline-code">
              {token.value}
            </code>
          );
        }
        const content = mentions ? renderMentions(token.value) : token.value;
        if (token.type === "bold") {
          return <strong key={index}>{content}</strong>;
        }
        if (token.type === "italic") {
          return <em key={index}>{content}</em>;
        }
        return <Fragment key={index}>{content}</Fragment>;
      })}
    </>
  );
}

function renderMentions(text: string): ReactNode {
  const parts = splitMentionText(text);
  if (parts.length === 1 && parts[0].type === "text") return text;
  return parts.map((part, index) =>
    part.type === "mention" ? (
      <span key={index} className={part.handle ? "squad-chat-mention" : "squad-chat-mention-invalid"}>
        {part.value}
      </span>
    ) : (
      <Fragment key={index}>{part.value}</Fragment>
    ),
  );
}

function tokenizeInline(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    const chunk = match[0];
    if (chunk.startsWith("`")) {
      tokens.push({ type: "code", value: chunk.slice(1, -1) });
    } else if (chunk.startsWith("**") || chunk.startsWith("__")) {
      tokens.push({ type: "bold", value: chunk.slice(2, -2) });
    } else {
      tokens.push({ type: "italic", value: chunk.slice(1, -1) });
    }
    lastIndex = match.index + chunk.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", value: text.slice(lastIndex) });
  }
  return tokens.length > 0 ? tokens : [{ type: "text", value: text }];
}
