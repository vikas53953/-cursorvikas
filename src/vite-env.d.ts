/// <reference types="vite/client" />

export type JarvisArtifact = {
  title: string;
  kind:
    | "text"
    | "markdown"
    | "code"
    | "table"
    | "notes"
    | "mermaid"
    | "statusBoard"
    | "taskBoard"
    | "progress";
  content: string;
  language?: string;
  fullscreen?: boolean;
  downloadUrl?: string;
  downloadName?: string;
};

export type TeamTask = {
  id: string;
  team: string;
  teamName: string;
  title: string;
  request?: string;
  status: "queued" | "in_progress" | "done" | "failed";
  createdAt: string;
  updatedAt: string;
  steps?: Array<{ ts: string; text: string }>;
  result?: string | null;
  error?: string | null;
};

export type JarvisToolSpec = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type JarvisToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export type JarvisToolResult = {
  ok: boolean;
  artifact?: JarvisArtifact;
  message?: string;
  error?: string;
  [key: string]: unknown;
};

export type DashboardDevice = {
  id?: string;
  name: string;
  role?: string;
  platform?: string;
  ip?: string;
  site?: string;
  reachability?: string;
  status: string;
  healthScore?: number | null;
  cpu?: string;
  memory?: string;
  uptime?: string;
  software?: string;
  note?: string;
};

export type DashboardLink = {
  source: string;
  sourcePort?: string;
  target: string;
  targetPort?: string;
  status?: string;
};

export type DashboardEvent = {
  time?: string;
  when?: string;
  severity?: string;
  device?: string;
  text?: string;
  event?: string;
};

export type DashboardIssue = {
  issueId?: string;
  id?: string;
  name?: string;
  priority?: string;
  status?: string;
};

export type DashboardSnapshot = {
  mode?: "live" | "sim";
  source?: string;
  updatedAt?: string;
  overall?: string;
  health?: {
    score?: number | null;
    totalDevices?: number;
    healthyDevices?: number;
    unhealthyDevices?: number;
  };
  issues?: {
    active?: number;
    items?: DashboardIssue[];
  };
  devices?: DashboardDevice[];
  links?: DashboardLink[];
  events?: DashboardEvent[];
  liveError?: string;
  staleError?: string;
  error?: string;
};

declare global {
  interface Window {
    jarvis: {
      createRealtimeToken: () => Promise<{ value: string; expiresAt: number | null }>;
      executeTool: (toolCall: JarvisToolCall) => Promise<JarvisToolResult>;
      getToolSpecs: () => Promise<JarvisToolSpec[]>;
      getDashboard: (options?: { force?: boolean }) => Promise<DashboardSnapshot>;
      getTasks: () => Promise<TeamTask[]>;
      logEvent: (event: Record<string, unknown>) => Promise<void>;
    };
  }
}
