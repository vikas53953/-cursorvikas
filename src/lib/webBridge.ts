import type { DashboardSnapshot, JarvisToolCall, JarvisToolResult, JarvisToolSpec } from "../vite-env";

// When the app runs in a plain browser (web mode) there is no Electron
// preload, so window.jarvis is missing. This shim provides the same surface
// over the web server's HTTP API.
export function installWebBridge(): void {
  if (typeof window === "undefined" || window.jarvis) return;

  async function postJson<T>(url: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(data?.error || `${url} failed with status ${response.status}`);
    }
    return data;
  }

  window.jarvis = {
    createRealtimeToken: () => postJson<{ value: string; expiresAt: number | null }>("/api/realtime/token", {}),
    executeTool: (toolCall: JarvisToolCall) => postJson<JarvisToolResult>("/api/tools/execute", toolCall),
    getToolSpecs: async () => {
      const response = await fetch("/api/tools/list");
      return (await response.json()) as JarvisToolSpec[];
    },
    getDashboard: async (options?: { force?: boolean }) => {
      const response = await fetch(`/api/dashboard${options?.force ? "?force=1" : ""}`);
      return (await response.json()) as DashboardSnapshot;
    },
    logEvent: async (event: Record<string, unknown>) => {
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
    },
  };
}
