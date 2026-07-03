import type { JarvisArtifact, JarvisToolResult } from "../vite-env";

export function artifactTechnicalText(artifact: JarvisArtifact): string {
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
  if (artifact.kind === "markdown") {
    const lines = artifact.content.split("\n");
    const technical = lines.filter((line) => line.startsWith("- ") || line.startsWith("## ") || line.includes("CVE") || line.includes("sw"));
    return technical.length > 0 ? technical.join("\n") : artifact.content.slice(0, 2000);
  }
  return artifact.content.slice(0, 4000);
}

export function artifactNarrativeText(artifact: JarvisArtifact): string {
  if (artifact.kind === "markdown") {
    const headline = artifact.content.split("\n").find((line) => line.startsWith("# "));
    const summary = artifact.content
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#") && !line.startsWith("```"))
      .slice(0, 6)
      .join(" ");
    return headline ? `${headline.replace(/^#\s*/, "")}. ${summary}` : summary || artifact.title;
  }
  return `${artifact.title} — inspect the technical output for raw command data.`;
}

export function artifactPreviewText(artifact: JarvisArtifact, maxLines = 5): string {
  const full = artifactTechnicalText(artifact);
  const lines = full.split("\n");
  if (lines.length <= maxLines) return full;
  return `${lines.slice(0, maxLines).join("\n")}\n…`;
}

export function splitArtifactOutput(artifact: JarvisArtifact): { narrative: string; technical: string } {
  if (artifact.kind === "code") {
    return { narrative: "", technical: artifact.content };
  }

  if (artifact.kind === "table") {
    return {
      narrative: artifact.title,
      technical: artifactTechnicalText(artifact),
    };
  }

  if (artifact.kind === "markdown") {
    const codeBlocks: string[] = [];
    const stripped = artifact.content.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_match, body: string) => {
      if (body?.trim()) codeBlocks.push(body.trim());
      return "";
    });

    const narrativeLines: string[] = [];
    const technicalLines: string[] = [];

    for (const line of stripped.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("#")) {
        narrativeLines.push(trimmed.replace(/^#+\s*/, ""));
      } else if (trimmed.startsWith("- ") || trimmed.startsWith("|") || trimmed.startsWith("##")) {
        technicalLines.push(line);
      } else {
        narrativeLines.push(line);
      }
    }

    const technical = [...technicalLines, ...codeBlocks].filter(Boolean).join("\n").trim();
    const narrative = narrativeLines.join("\n").trim();

    return {
      narrative: narrative || artifactNarrativeText(artifact),
      technical: technical || artifact.content,
    };
  }

  return {
    narrative: artifactNarrativeText(artifact),
    technical: artifactTechnicalText(artifact),
  };
}

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
    lines.push("", artifactTechnicalText(result.artifact));
  } else {
    const { ok, artifact, message, error, ...rest } = result;
    const payload = Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : "";
    if (payload) lines.push("", payload);
  }
  return lines.join("\n").slice(0, 6000);
}
