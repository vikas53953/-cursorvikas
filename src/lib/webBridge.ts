import type { AgentOrg, ArtifactRecord, DashboardSnapshot, JarvisToolCall, JarvisToolResult, JarvisToolSpec, ProactiveEvent, TeamTask } from "../vite-env";

// When the app runs in a plain browser (web mode) there is no Electron
// preload, so window.jarvis is missing. This shim provides the same surface
// over the web server's HTTP API.
export function installWebBridge(): void {
  if (typeof window === "undefined" || window.jarvis) return;

  // Tunnels/proxies occasionally return HTML error pages; parse defensively
  // so a bad response surfaces as a readable error instead of a JSON crash.
  async function parseJson<T>(url: string, response: Response): Promise<T> {
    const raw = await response.text();
    try {
      const data = JSON.parse(raw) as T & { error?: string };
      if (!response.ok) {
        throw new Error((data as { error?: string })?.error || `${url} failed with status ${response.status}`);
      }
      return data;
    } catch (error) {
      if (error instanceof SyntaxError) {
        void logSafe({ type: "web.parse_error", url, status: response.status, body: raw.slice(0, 200) });
        throw new Error(`The server (or tunnel) returned a non-JSON response for ${url} (status ${response.status}). Retrying usually fixes this.`);
      }
      throw error;
    }
  }

  async function postJson<T>(url: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return parseJson<T>(url, response);
  }

  async function getJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    return parseJson<T>(url, response);
  }

  async function logSafe(event: Record<string, unknown>): Promise<void> {
    try {
      await fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        keepalive: true,
      });
    } catch {
      // Logging must never break the app.
    }
  }

  window.jarvis = {
    createRealtimeToken: () => postJson<{ value: string; expiresAt: number | null }>("/api/realtime/token", {}),
    executeTool: (toolCall: JarvisToolCall) => postJson<JarvisToolResult>("/api/tools/execute", toolCall),
    getToolSpecs: () => getJson<JarvisToolSpec[]>("/api/tools/list"),
    getDashboard: (options?: { force?: boolean }) => getJson<DashboardSnapshot>(`/api/dashboard${options?.force ? "?force=1" : ""}`),
    getTasks: () => getJson<TeamTask[]>("/api/tasks"),
    getOrg: () => getJson<AgentOrg>("/api/org"),
    listArtifacts: () => getJson<ArtifactRecord[]>("/api/artifacts"),
    getProactiveEvents: () => getJson<ProactiveEvent[]>("/api/proactive/pending"),
    markProactiveSpoken: (id: string) => postJson<{ ok: boolean }>(`/api/proactive/${encodeURIComponent(id)}/spoken`, {}),
    logEvent: logSafe,
  };
}
