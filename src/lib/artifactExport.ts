import type { JarvisArtifact } from "../vite-env";

export function artifactPlainText(artifact: JarvisArtifact): string {
  if (artifact.kind === "table") {
    const rows = parseRows(artifact.content);
    if (rows) return tableToCsv(Array.isArray(rows) ? rows : [rows]);
  }
  return artifact.content;
}

export function artifactEmailBody(artifact: JarvisArtifact): string {
  const plain = artifactPlainText(artifact);
  return [
    `Subject: [NOC] ${artifact.title}`,
    "",
    `Hi team,`,
    "",
    `Sharing the latest from NetJarvis - ${artifact.title} (generated ${new Date().toLocaleString()}):`,
    "",
    plain,
    "",
    "Regards,",
    "Network Operations",
    "-- Sent from NetJarvis",
  ].join("\n");
}

export function downloadArtifact(artifact: JarvisArtifact): void {
  if (artifact.downloadUrl) {
    const anchor = document.createElement("a");
    anchor.href = artifact.downloadUrl;
    anchor.download = artifact.downloadName || "";
    anchor.click();
    return;
  }
  const isTable = artifact.kind === "table";
  const content = isTable ? artifactPlainText(artifact) : artifact.content;
  const name =
    artifact.downloadName ||
    `${artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.${isTable ? "csv" : artifact.kind === "code" ? "txt" : "md"}`;
  const blob = new Blob([content], { type: isTable ? "text/csv" : "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function tableToCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const keys = Array.from(
    rows.reduce<Set<string>>((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set()),
  );
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [keys.map(escape).join(","), ...rows.map((row) => keys.map((key) => escape(row[key])).join(","))].join("\r\n");
}

function parseRows(content: string): Array<Record<string, unknown>> | Record<string, unknown> | null {
  try {
    const value = JSON.parse(content) as unknown;
    if (Array.isArray(value) && value.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      return value as Array<Record<string, unknown>>;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
