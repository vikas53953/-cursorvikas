import type { JarvisArtifact, JarvisToolResult } from "../vite-env";

export function formatToolTechnical(name: string, args: Record<string, unknown>): string {
  if (name === "run_show_command") {
    const device = String(args.device || "all");
    const commands = Array.isArray(args.commands) ? args.commands.map(String) : [];
    return ["Tool: run_show_command", `Device: ${device}`, "Commands:", ...commands.map((command) => `  $ ${command}`)].join("\n");
  }
  if (name === "delegate_task") {
    return ["Tool: delegate_task", `Team: ${String(args.team || "")}`, `Task: ${String(args.task || "")}`].join("\n");
  }
  return `Tool: ${name}\n${JSON.stringify(args, null, 2)}`;
}

export function formatToolResultTechnical(name: string, result: JarvisToolResult): string {
  if (result.error) return `Tool: ${name}\nStatus: failed\nError: ${result.error}`;
  const lines = [`Tool: ${name}`, "Status: ok"];
  if (result.message) lines.push(`Message: ${result.message}`);
  if (result.artifact) {
    lines.push(`Artifact: ${result.artifact.kind} — ${result.artifact.title}`);
    lines.push("", technicalFromArtifact(result.artifact));
  } else {
    const { ok, artifact, message, error, ...rest } = result;
    const payload = Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : "";
    if (payload) lines.push("", payload);
  }
  return lines.join("\n").slice(0, 6000);
}

function technicalFromArtifact(artifact: JarvisArtifact): string {
  if (artifact.kind === "code") return artifact.content;
  if (artifact.kind === "table") {
    try {
      const rows = JSON.parse(artifact.content) as Array<Record<string, unknown>>;
      const list = Array.isArray(rows) ? rows : [rows];
      if (list.length === 0) return artifact.content;
      const keys = Object.keys(list[0] || {});
      return [keys.join("\t"), ...list.slice(0, 40).map((row) => keys.map((key) => String(row[key] ?? "")).join("\t"))].join("\n");
    } catch {
      return artifact.content;
    }
  }
  return artifact.content.slice(0, 4000);
}
