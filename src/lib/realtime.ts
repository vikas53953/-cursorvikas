import type { JarvisArtifact, JarvisToolCall, JarvisToolResult, JarvisToolSpec } from "../vite-env";
import { formatToolResultTechnical, formatToolTechnical } from "./observability";
import type { TranscriptCommitKind } from "./transcriptGate";

export type JarvisConnectionState = "idle" | "connecting" | "connected" | "error";
export type JarvisMood = "idle" | "listening" | "thinking" | "speaking" | "working" | "error";

export type MouthShape = {
  open: number;
  width: number;
  round: number;
  teeth: number;
};

export type TranscriptEntry = {
  id: string;
  role: "user" | "jarvis" | "system" | "tool";
  text: string;
  at: string;
  artifact?: JarvisArtifact;
  artifacts?: JarvisArtifact[];
  technical?: string;
};

export type JarvisActivity = {
  kind: "tool_start" | "tool_done" | "tool_error" | "heard" | "speaking";
  text: string;
  tool?: string;
  technical?: string;
  status?: "running" | "done" | "error";
};

export type RealtimeCallbacks = {
  onConnectionState: (state: JarvisConnectionState) => void;
  onMood: (mood: JarvisMood) => void;
  onMouthShape: (shape: MouthShape) => void;
  onTranscript: (entry: TranscriptEntry, kind?: TranscriptCommitKind) => void;
  onArtifact: (artifact: JarvisArtifact) => void;
  onStatus: (message: string) => void;
  onActivity?: (activity: JarvisActivity) => void;
  /** Router mode: transcribed speech is handled by handleUserMessage; return reply text to speak. */
  onRoutedSpeech?: (text: string) => Promise<string | void>;
};

type ServerEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  response?: {
    output?: ResponseOutputItem[];
  };
  item?: {
    type?: string;
    role?: string;
    content?: Array<{ transcript?: string; text?: string }>;
  };
  error?: {
    message?: string;
  };
};

type ResponseOutputItem = {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  content?: Array<{ transcript?: string; text?: string }>;
};

const realtimeUrl = "https://api.openai.com/v1/realtime/calls";

// Fire-and-forget structured logging to the debug log (data/logs/*.jsonl).
function logEvent(type: string, data: Record<string, unknown> = {}): void {
  try {
    void window.jarvis.logEvent({ type, ...data });
  } catch {
    // Logging must never break the app.
  }
}

export class JarvisRealtimeClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private micStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private disposed = false;
  private callbacks: RealtimeCallbacks;
  private currentAssistantText = "";
  private toolSpecs: JarvisToolSpec[] = [];
  private toolRunning = false;
  private proactiveTimer = 0;
  private spokenProactive = new Set<string>();
  private audioContext: AudioContext | null = null;
  private outputMeterFrame = 0;
  private smoothedMouthShape: MouthShape = silentMouthShape();
  private routerMode = true;
  private pendingVoiceReply: string | null = null;
  private routingSpeech = false;

  constructor(callbacks: RealtimeCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(): Promise<void> {
    if (this.pc) return;
    this.disposed = false;
    this.callbacks.onConnectionState("connecting");
    this.callbacks.onMood("thinking");
    this.callbacks.onStatus("Minting a Realtime client secret.");
    logEvent("rt.connect.start");

    let pc: RTCPeerConnection | null = null;
    let dc: RTCDataChannel | null = null;
    let micStream: MediaStream | null = null;
    let remoteAudio: HTMLAudioElement | null = null;

    const abortIfDisposed = (): boolean => {
      if (!this.disposed) return false;
      micStream?.getTracks().forEach((track) => {
        track.enabled = false;
        track.stop();
      });
      pc?.getSenders().forEach((sender) => {
        if (sender.track) {
          sender.track.enabled = false;
          sender.track.stop();
        }
      });
      remoteAudio?.pause();
      dc?.close();
      pc?.close();
      return true;
    };

    try {
      if (!this.routerMode) {
        this.toolSpecs = await window.jarvis.getToolSpecs();
        if (abortIfDisposed()) return;
      }

      const token = await window.jarvis.createRealtimeToken({ routerMode: this.routerMode });
      if (abortIfDisposed()) return;
      logEvent("rt.connect.token_ok", { expiresAt: token.expiresAt });

      pc = new RTCPeerConnection();
      remoteAudio = document.createElement("audio");
      remoteAudio.autoplay = true;
      remoteAudio.setAttribute("playsinline", "true");
      document.body.appendChild(remoteAudio);
      this.remoteAudio = remoteAudio;

      pc.ontrack = (event) => {
        if (this.disposed || !remoteAudio) return;
        remoteAudio.srcObject = event.streams[0];
        void remoteAudio.play().catch(() => {
          // Autoplay may require a prior user gesture; connect() counts as one.
        });
        this.startOutputMeter(event.streams[0]);
      };

      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (abortIfDisposed()) return;

      this.micStream = micStream;
      pc.addTrack(micStream.getAudioTracks()[0], micStream);

      dc = pc.createDataChannel("oai-events");
      const onMessage = (event: MessageEvent) => {
        void this.handleServerEvent(event.data);
      };
      const onOpen = () => {
        if (this.disposed) return;
        this.callbacks.onConnectionState("connected");
        this.callbacks.onMood("idle");
        this.callbacks.onStatus("NetJarvis is live. Ask how your network is doing.");
        logEvent("rt.connect.data_channel_open");
        this.startProactiveWatcher();
      };
      dc.addEventListener("open", onOpen);
      dc.addEventListener("message", onMessage);

      const offer = await pc.createOffer();
      if (abortIfDisposed()) return;
      await pc.setLocalDescription(offer);
      if (abortIfDisposed()) return;

      const sdpResponse = await fetch(realtimeUrl, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${token.value}`,
          "Content-Type": "application/sdp",
        },
      });
      if (abortIfDisposed()) return;

      if (!sdpResponse.ok) {
        throw new Error(`Realtime WebRTC call failed: ${sdpResponse.status} ${await sdpResponse.text()}`);
      }

      await pc.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text(),
      });
      if (abortIfDisposed()) return;

      this.pc = pc;
      this.dc = dc;
      logEvent("rt.connect.webrtc_ok");
    } catch (error) {
      if (this.disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      logEvent("rt.connect.error", { error: message });
      this.callbacks.onConnectionState("error");
      this.callbacks.onMood("error");
      this.callbacks.onStatus(message);
      this.disconnect();
    }
  }

  disconnect(): void {
    this.disposed = true;
    logEvent("rt.disconnect");
    this.stopProactiveWatcher();
    this.stopOutputMeter();

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => {
        track.enabled = false;
        track.stop();
      });
    }

    if (this.pc) {
      this.pc.getSenders().forEach((sender) => {
        if (sender.track) {
          sender.track.enabled = false;
          sender.track.stop();
        }
      });
    }

    if (this.remoteAudio) {
      this.remoteAudio.pause();
      this.remoteAudio.srcObject = null;
      if (this.remoteAudio.parentNode) {
        this.remoteAudio.parentNode.removeChild(this.remoteAudio);
      }
      this.remoteAudio = null;
    }

    if (this.dc) {
      this.dc.onopen = null;
      this.dc.onmessage = null;
      this.dc.close();
    }
    this.pc?.close();
    this.dc = null;
    this.pc = null;
    this.micStream = null;
    this.currentAssistantText = "";
    this.toolRunning = false;
    this.pendingVoiceReply = null;
    this.routingSpeech = false;
    this.callbacks.onConnectionState("idle");
    this.callbacks.onMood("idle");
    this.callbacks.onMouthShape(silentMouthShape());
  }

  isActive(): boolean {
    return !this.disposed && this.pc !== null && this.dc?.readyState === "open";
  }

  sendText(text: string): void {
    if (this.disposed || !this.dc || this.dc.readyState !== "open") {
      this.callbacks.onStatus("Connect NetJarvis before sending a text prompt.");
      return;
    }
    logEvent("rt.user.text", { text });
    if (this.routerMode && this.callbacks.onRoutedSpeech) {
      void this.routeSpeech(text);
      return;
    }
    this.callbacks.onTranscript(newEntry("user", text));
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.sendEvent({ type: "response.create" });
  }

  /** Speak a router reply through Realtime TTS (router mode). */
  async speakReply(text: string): Promise<void> {
    if (this.disposed || !text.trim() || !this.dc || this.dc.readyState !== "open") return;
    this.pendingVoiceReply = text.trim();
    this.currentAssistantText = "";
    this.callbacks.onMood("speaking");
    // gpt-realtime-2 rejects response.modalities — session already has output_modalities: ["audio"].
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `[VOICE OUTPUT — read the following verbatim in clear English, do not add tools or commentary]:\n\n${this.pendingVoiceReply}`,
          },
        ],
      },
    });
    this.sendEvent({ type: "response.create" });
  }

  private async routeSpeech(transcript: string): Promise<void> {
    if (!this.callbacks.onRoutedSpeech || this.routingSpeech) return;
    const trimmed = transcript.trim();
    if (!trimmed) return;
    this.routingSpeech = true;
    this.callbacks.onMood("thinking");
    try {
      const reply = await this.callbacks.onRoutedSpeech(trimmed);
      if (typeof reply === "string" && reply.trim()) {
        await this.speakReply(reply);
      } else if (!this.toolRunning) {
        this.callbacks.onMood("idle");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onMood("error");
      this.callbacks.onStatus(message);
    } finally {
      this.routingSpeech = false;
    }
  }

  private async handleServerEvent(raw: string): Promise<void> {
    if (this.disposed) return;
    const event = safeParseEvent(raw);
    if (!event.type) return;

    // Capture the realtime event stream (skip high-frequency audio deltas).
    if (!event.type.includes("delta") && !event.type.startsWith("output_audio_buffer")) {
      logEvent("rt.event", { eventType: event.type });
    }

    if (event.type === "error") {
      logEvent("rt.error", { error: event.error?.message || "unknown", raw: raw.slice(0, 500) });
      this.callbacks.onMood("error");
      this.callbacks.onStatus(event.error?.message || "Realtime API returned an error.");
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      this.currentAssistantText = "";
      this.callbacks.onActivity?.({ kind: "speaking", text: "" });
      this.callbacks.onMood("listening");
      return;
    }

    if (event.type === "input_audio_buffer.speech_stopped") {
      this.callbacks.onMood("thinking");
      return;
    }

    if (event.type === "response.audio.delta" || event.type === "response.output_audio.delta") {
      this.callbacks.onMood("speaking");
      return;
    }

    if (event.type === "response.output_audio.done" || event.type === "response.audio.done") {
      if (!this.toolRunning) this.callbacks.onMood("idle");
      return;
    }

    if (
      event.type === "response.audio_transcript.delta" ||
      event.type === "response.output_audio_transcript.delta" ||
      event.type === "response.output_text.delta"
    ) {
      this.currentAssistantText += event.delta || "";
      if (this.currentAssistantText.trim()) {
        this.callbacks.onActivity?.({ kind: "speaking", text: this.currentAssistantText });
      }
      return;
    }

    if (event.type === "response.output_audio_transcript.done" || event.type === "response.audio_transcript.done") {
      const transcript = String(event.transcript || this.currentAssistantText || "").trim();
      if (transcript) {
        this.currentAssistantText = transcript;
        this.callbacks.onActivity?.({ kind: "speaking", text: transcript });
      }
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const transcript = event.transcript || collectItemText(event.item);
      if (transcript) {
        logEvent("rt.user.speech", { transcript, routerMode: this.routerMode });
        this.callbacks.onActivity?.({ kind: "heard", text: transcript.trim() });
        if (this.routerMode && this.callbacks.onRoutedSpeech) {
          void this.routeSpeech(transcript);
        } else {
          this.callbacks.onTranscript(newEntry("user", transcript));
        }
      }
      return;
    }

    if (event.type === "response.done") {
      const output = event.response?.output || [];
      const functionCalls = output.filter((item) => item.type === "function_call" && item.name && item.call_id);
      const spoken = this.currentAssistantText || output.map(collectOutputText).filter(Boolean).join("\n");

      if (this.routerMode) {
        if (spoken && this.pendingVoiceReply) {
          this.callbacks.onActivity?.({ kind: "speaking", text: spoken });
        }
        this.currentAssistantText = "";
        this.pendingVoiceReply = null;
        if (!this.toolRunning && !this.routingSpeech) this.callbacks.onMood("idle");
        return;
      }

      // Only commit to chat history on the final spoken answer — skip interim "let me check…" lines before tools run.
      if (spoken && functionCalls.length === 0) {
        logEvent("rt.jarvis.speech", { text: spoken });
        this.callbacks.onTranscript(newEntry("jarvis", spoken));
      }
      this.currentAssistantText = "";

      if (functionCalls.length > 0) {
        await this.executeFunctionCalls(functionCalls);
      } else if (!this.toolRunning) {
        this.callbacks.onMood("idle");
      }
      return;
    }
  }

  private async executeFunctionCalls(items: ResponseOutputItem[]): Promise<void> {
    this.toolRunning = true;
    this.callbacks.onMood("working");
    let shouldCreateResponse = false;

    for (const item of items) {
      const callId = item.call_id;
      const name = item.name;
      if (!callId || !name) continue;

      const parsedArgs = parseToolArguments(item.arguments || "{}");
      const knownTool = this.toolSpecs.some((tool) => tool.name === name);
      if (!knownTool) {
        await this.returnToolOutput(callId, {
          ok: false,
          error: `Tool is not available: ${name}`,
        });
        shouldCreateResponse = true;
        continue;
      }

      const description = describeToolCall(name, parsedArgs);
      const technical = formatToolTechnical(name, parsedArgs);
      this.callbacks.onTranscript(newEntry("tool", `Running ${description}`));
      this.callbacks.onActivity?.({ kind: "tool_start", text: description, tool: name, technical, status: "running" });
      logEvent("rt.tool.call", { tool: name, args: parsedArgs });
      const startedAt = Date.now();
      const result = await window.jarvis.executeTool({ name, arguments: parsedArgs } satisfies JarvisToolCall);
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      logEvent("rt.tool.result", { tool: name, ok: result.ok !== false, error: result.error });
      const resultTechnical = formatToolResultTechnical(name, result);
      if (result.ok === false) {
        this.callbacks.onActivity?.({
          kind: "tool_error",
          text: `${name} failed: ${result.error || result.message || "unknown error"}`,
          tool: name,
          technical: resultTechnical,
          status: "error",
        });
      } else {
        this.callbacks.onActivity?.({
          kind: "tool_done",
          text: `${description} done in ${seconds}s`,
          tool: name,
          technical: resultTechnical,
          status: "done",
        });
      }
      if (result.artifacts?.length) {
        for (const artifact of result.artifacts) {
          if (artifact?.kind === "code" || artifact?.kind === "table") {
            this.callbacks.onArtifact(artifact);
          }
        }
      } else if (result.artifact) {
        this.callbacks.onArtifact(result.artifact);
      }
      shouldCreateResponse = true;
      await this.returnToolOutput(callId, result);
    }

    if (shouldCreateResponse) this.sendEvent({ type: "response.create" });
    this.toolRunning = false;
  }

  private async returnToolOutput(callId: string, result: JarvisToolResult): Promise<void> {
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(sanitizeToolResult(result)),
      },
    });
  }

  private startProactiveWatcher(): void {
    this.stopProactiveWatcher();
    const poll = async () => {
      if (!this.dc || this.dc.readyState !== "open" || this.toolRunning) return;
      try {
        const events = await window.jarvis.getProactiveEvents();
        for (const event of events) {
          if (!event?.id || this.spokenProactive.has(event.id)) continue;
          this.spokenProactive.add(event.id);
          this.callbacks.onStatus(`Proactive alert: ${event.headline}`);
          if (this.routerMode) {
            void this.speakReply(event.message);
          } else {
            this.sendText(`[SYSTEM ALERT - speak immediately, 2 sentences max] ${event.message}`);
          }
          void window.jarvis.markProactiveSpoken(event.id);
        }
      } catch {
        // Proactive polling must never break voice.
      }
    };
    void poll();
    this.proactiveTimer = window.setInterval(() => void poll(), 30000);
  }

  private stopProactiveWatcher(): void {
    if (this.proactiveTimer) window.clearInterval(this.proactiveTimer);
    this.proactiveTimer = 0;
  }

  private sendEvent(event: Record<string, unknown>): void {
    if (this.dc?.readyState === "open") {
      this.dc.send(JSON.stringify(event));
    }
  }

  private startOutputMeter(stream: MediaStream): void {
    this.stopOutputMeter();

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);

    this.audioContext = audioContext;

    const samples = new Uint8Array(analyser.fftSize);
    const frequencies = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      analyser.getByteFrequencyData(frequencies);
      let total = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        total += centered * centered;
      }
      const rms = Math.sqrt(total / samples.length);
      const energy = clamp01(rms * 10.5);
      const bands = getSpeechBands(frequencies);

      // Simple realtime viseme approximation: low energy rounds the mouth,
      // mid energy opens it, high energy stretches it for consonants/ee sounds.
      const target: MouthShape = {
        open: clamp01(energy * 0.75 + bands.mid * 0.45 - bands.high * 0.16),
        width: clamp01(0.28 + bands.mid * 0.55 + bands.high * 0.74 - bands.low * 0.28),
        round: clamp01(0.08 + bands.low * 0.95 + energy * 0.1 - bands.high * 0.42),
        teeth: clamp01(bands.high * 1.4 + bands.mid * 0.25 - bands.low * 0.35),
      };

      this.smoothedMouthShape = smoothMouthShape(this.smoothedMouthShape, target, 0.36);
      this.callbacks.onMouthShape(this.smoothedMouthShape);
      this.outputMeterFrame = window.requestAnimationFrame(tick);
    };
    tick();
  }

  private stopOutputMeter(): void {
    if (this.outputMeterFrame) {
      window.cancelAnimationFrame(this.outputMeterFrame);
      this.outputMeterFrame = 0;
    }
    void this.audioContext?.close();
    this.audioContext = null;
    this.smoothedMouthShape = silentMouthShape();
  }
}

function silentMouthShape(): MouthShape {
  return { open: 0, width: 0.18, round: 0, teeth: 0 };
}

function smoothMouthShape(current: MouthShape, target: MouthShape, amount: number): MouthShape {
  return {
    open: lerp(current.open, target.open, amount),
    width: lerp(current.width, target.width, amount),
    round: lerp(current.round, target.round, amount),
    teeth: lerp(current.teeth, target.teeth, amount),
  };
}

function getSpeechBands(frequencies: Uint8Array): { low: number; mid: number; high: number } {
  const low = averageRange(frequencies, 2, 14) / 255;
  const mid = averageRange(frequencies, 14, 48) / 255;
  const high = averageRange(frequencies, 48, 110) / 255;
  return { low: clamp01(low * 2.2), mid: clamp01(mid * 2.1), high: clamp01(high * 2.8) };
}

function averageRange(values: Uint8Array, start: number, end: number): number {
  const cappedEnd = Math.min(end, values.length);
  if (start >= cappedEnd) return 0;
  let total = 0;
  for (let index = start; index < cappedEnd; index += 1) {
    total += values[index];
  }
  return total / (cappedEnd - start);
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function describeToolCall(name: string, args: Record<string, unknown>): string {
  if (name === "run_show_command") {
    const commands = Array.isArray(args.commands) ? args.commands.join(", ") : "";
    const device = typeof args.device === "string" && args.device ? args.device : "all devices";
    return `"${commands}" on ${device}`;
  }
  const summary = Object.entries(args)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
  return summary ? `${name} (${summary.slice(0, 60)})` : name;
}

export function newEntry(role: TranscriptEntry["role"], text: string): TranscriptEntry {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    at: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  };
}

function safeParseEvent(raw: string): ServerEvent {
  try {
    return JSON.parse(raw) as ServerEvent;
  } catch {
    return {};
  }
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function sanitizeToolResult(result: JarvisToolResult): JarvisToolResult {
  if (!result.artifact) return result;

  const { artifact, ...rest } = result;
  return {
    ...rest,
    artifact: {
      title: artifact.title,
      kind: artifact.kind,
      content:
        artifact.kind === "statusBoard"
          ? "Status board rendered in the UI. Use the summary fields in this result for exact numbers."
          : artifact.content.length > 1600
            ? `${artifact.content.slice(0, 1600)}...`
            : artifact.content,
      language: artifact.language,
      fullscreen: artifact.fullscreen,
    },
  };
}

function collectItemText(item: ServerEvent["item"]): string {
  return item?.content?.map((part) => part.transcript || part.text || "").filter(Boolean).join("\n") || "";
}

function collectOutputText(item: ResponseOutputItem): string {
  return item.content?.map((part) => part.transcript || part.text || "").filter(Boolean).join("\n") || "";
}
