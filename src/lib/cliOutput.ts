export type CliTable = {
  command: string;
  host: string;
  headers: string[];
  rows: string[][];
};

export type CliBlock = {
  host: string;
  command: string;
  lines: string[];
  table: CliTable | null;
};

const PROMPT_RE = /^[a-z0-9._-]+#\s*/i;
const SEPARATOR_RE = /^=+$/;

export function parseCliOutput(text: string): CliBlock[] {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const chunks = raw.includes("=".repeat(32))
    ? raw.split(/\n=+\n/).map((chunk) => chunk.trim()).filter(Boolean)
    : [raw];

  const blocks: CliBlock[] = [];
  for (const chunk of chunks) {
    const lines = chunk
      .split("\n")
      .map((line) => line.replace(/\r$/, ""))
      .filter((line, index, all) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (PROMPT_RE.test(trimmed)) return false;
        if (SEPARATOR_RE.test(trimmed)) return false;
        // Drop echoed command line immediately after prompt block.
        if (index > 0 && index < 3 && all[index - 1] && PROMPT_RE.test(all[index - 1])) {
          const cmd = all[index - 1].replace(PROMPT_RE, "").trim();
          if (trimmed === cmd) return false;
        }
        return true;
      });

    let host = "device";
    let command = "show";
    const promptLine = chunk.split("\n").find((line) => PROMPT_RE.test(line.trim()));
    if (promptLine) {
      const match = promptLine.trim().match(/^([a-z0-9._-]+)#\s*(.*)$/i);
      if (match) {
        host = match[1];
        command = match[2] || command;
      }
    } else {
      const behind = raw.match(/- Device:\s*(\S+)/i);
      if (behind) host = behind[1];
      const cmdList = raw.match(/- Commands.*?:\s*(.+)$/im);
      if (cmdList) command = cmdList[1].split(",")[0]?.trim() || command;
    }

    blocks.push({
      host,
      command,
      lines,
      table: detectCliTable(lines),
    });
  }
  return blocks;
}

function detectCliTable(lines: string[]): CliTable | null {
  if (lines.length < 2) return null;
  const headerIndex = lines.findIndex((line) => line.trim().split(/\s{2,}/).length >= 3);
  if (headerIndex < 0 || headerIndex >= lines.length - 1) return null;

  const headers = splitColumns(lines[headerIndex]);
  if (headers.length < 3) return null;

  const rows: string[][] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cols = splitColumns(line);
    if (cols.length < 2) continue;
    while (cols.length < headers.length) cols.push("");
    rows.push(cols.slice(0, headers.length));
  }

  return rows.length > 0 ? { host: "", command: "", headers, rows } : null;
}

function splitColumns(line: string): string[] {
  return line
    .trim()
    .split(/\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function cleanCliPreview(text: string, maxLines = 8): string {
  const blocks = parseCliOutput(text);
  if (blocks.length === 0) return text;
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.table) {
      lines.push(block.table.headers.join("  "));
      for (const row of block.table.rows.slice(0, maxLines)) {
        lines.push(row.join("  "));
      }
    } else {
      lines.push(...block.lines.slice(0, maxLines));
    }
  }
  return lines.join("\n");
}
