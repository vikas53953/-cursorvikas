# NetJarvis Architecture

This is the deep-dive companion to `CLAUDE.md`. It explains how a spoken or typed question becomes
an answer, where the two execution pipelines diverge, how the backend talks to a real network, and
how state flows to the UI. Line references are approximate and will drift; treat them as pointers.

---

## 1. Big picture

```
                         ┌──────────────────────────────────────────────┐
                         │                 FRONTEND (src/)               │
                         │   React 19 + Vite. Talks to backend ONLY via  │
                         │   window.jarvis (one injected surface).       │
                         └───────────────┬──────────────────────────────┘
                                         │
         ┌───────────── window.jarvis is provided by ONE of: ───────────┐
         │                                                              │
   electron/preload.cjs (IPC)                              src/lib/webBridge.ts (HTTP)
   ipcRenderer.invoke(...)                                 fetch /api/*
         │                                                              │
         └──────────────────────────┬───────────────────────────────────┘
                                    │
                         ┌──────────▼───────────┐
                         │   BACKEND (electron/) │  plain Node .cjs, no Electron dep
                         │   tools.cjs createTools() is the composition root
                         └──────────┬───────────┘
                                    │
             ┌──────────────────────┼──────────────────────┐
             │                      │                      │
      network-source.cjs      agents.cjs             skills/ + router
      (live vs sim facade)   (specialist team,       (chat pipeline)
             │                delegate, Kanban)
     ┌───────┴────────┐
 sources/catalyst-    network-data.cjs
 center.cjs (REAL)    (simulator)
```

The backend is instantiated once via `createTools({ readDb, updateDb })` (`tools.cjs`), which wires
together the source facade, the agent team, the skill deps, background services, and returns the
surface object consumed by `main.cjs` (Electron) and `web.cjs` (HTTP). Both entry points call
`tools.startBackgroundServices()` on boot (scheduler + alert watcher).

---

## 2. The two answer pipelines (the core architectural fact)

### 2a. Voice pipeline — client-driven, direct Realtime

```
mic ──WebRTC──> OpenAI Realtime API (gpt-realtime-2)
   │  (SDP offer POSTed to api.openai.com/v1/realtime/calls with an ephemeral secret)
   │  secret minted server-side by realtime-token.cjs; raw OPENAI_API_KEY never reaches browser
   ▼
data channel "oai-events"  ── realtime.ts handleServerEvent()
   • speech start/stop            → mood (listening/thinking/speaking) → NetworkCore orb + Hud
   • audio + transcript deltas    → accumulate assistant text, drive mouth-shape
   • input_audio_transcription    → user "heard" transcript
   • response.done w/ function_call
        └─> realtime.ts executeFunctionCalls()
              for each call: window.jarvis.executeTool({name, arguments})
                             → /api/tools/execute → tools.cjs execute()
              returnToolOutput() (function_call_output on data channel)
              response.create → model speaks its answer
```

Key properties:
- Persona/instructions come from `tools.instructions` = `JARVIS_INSTRUCTIONS` +
  `routerInstructionsAppendix()`, passed into the minted session (`realtime-token.cjs`).
- Tools run **one at a time, client-side**, each round-tripping through the HTTP/IPC surface.
- The classifier/planner/skills layer is **bypassed entirely**. The Realtime model itself decides
  which tools to call, guided only by the prompt.
- `realtime.ts` deliberately does **not** speak interim "let me check…" turns — it only commits the
  spoken answer when a `response.done` has no tool calls (see comment ~line 358).
- Mouth animation: `startOutputMeter()` runs a Web Audio `AnalyserNode` RMS + 3-band loop producing
  a `MouthShape` viseme approximation for the avatar.

### 2b. Chat pipeline — server-driven, "enterprise" classify→plan→skill→audit

```
composer / keyboard ── App.deliverUserMessage() ── window.jarvis.sendChatMessage({target,message,channel})
   │                                                    → /api/chat/message → tools.sendChatMessage
   ▼
handle-user-message.cjs  handleUserMessage()
   1. classifyIntent()      (message-router.cjs — regex rules, no LLM)
        intents: device_fact | network_overview | device_precheck | interface_status
                 | cli_show | delegate | general
   2. planAction()          (action-planner.cjs — intent → {skill, mode, tool, ...})
   3. sessionStore.beginTurn()   (data/sessions/<id>.jsonl audit, phase "started")
   4. getSkill(plan.skill).run({route, plan, deps, ...})   (skills/*.cjs)
   5. sessionStore.completeTurn() (phase "completed", tools used, reply, ms, ok)
   ▼
returns {ok, text, artifacts[], activity[], intent, skill, sessionId, auditId}
   ▼
App replays activity[] into observabilityEvents, sets artifact, commits reply to transcript
```

The skills:
- `device_fact` — pure data. Reads the snapshot, matches named devices, formats via
  `answer-policy.formatDeviceFactFromSnapshot`. No LLM.
- `network_overview` — runs the `network_overview` tool, re-reads snapshot, formats deterministically.
- `interface_status` — runs `interface_report`, deterministic up/down summary.
- `cli_show` / `device_precheck` — run `run_show_command` (live-only!), then optionally summarize
  with `deps.chatCompletion` (gpt-5-mini), with graceful fallback text on quota errors.
- `llm_loop` — the general agent loop for `general` and `delegate` intents. Builds OpenAI tool
  specs from `toolSpecs`, runs up to `maxRounds` (default 8) rounds of tool calling, applies
  `answer-policy` to the final text. This is the closest chat analog to the voice model's behavior.

`answer-policy.cjs` enforces reply shape per intent (strip "let me…" preambles, cap sentence
counts, remove "next steps" sections via `chat-reply.cjs`). `degradation.cjs` detects 429/quota
errors so automation still returns CLI output when the LLM is unavailable.

### 2c. Why they're separate

`ROLLBACK.md`: a unified "voice router" (Realtime = audio+transcription only → `handleUserMessage`
→ TTS) was built (`00502f5`) and **reverted** (`32f4396`, 2026-07-04) because it was slow and broke
HUD/orb synchronization. The current design keeps voice on the low-latency direct-Realtime path and
only routes **text** through the enterprise pipeline. The cost is duplicated tool semantics and the
risk of the two paths answering the same question differently.

---

## 3. Talking to the real network

### 3a. Source facade — `network-source.cjs`

Chooses live vs sim based on `NETJARVIS_SOURCE` (`live` | `sim` | `auto`, default `auto`). In
`auto` it probes Catalyst Center reachability once, caches the result ~5 min, and falls back to sim
on any error. `getSnapshot()` has a degradation ladder: fresh-live → stale-cached-live (with
`staleError`) → sim (with `liveError`). It normalizes **both** sources into one snapshot shape
(mode, source, overall, health, devices[], links[], issues, events) so every tool is
source-agnostic.

Caveat: the sim path always sets `links: []`, so the dashboard's link view is empty in sim mode
even though the simulator has a topology diagram.

### 3b. Catalyst Center adapter — `sources/catalyst-center.cjs` (the real integration)

A genuine Cisco Catalyst Center **Intent API** client built on `node:https` (no HTTP library).

- **Auth**: HTTP Basic (`username:password` base64) POST to `/dna/system/api/v1/auth/token`, reads
  `Token`, caches ~50 min, sends as `X-Auth-Token`, re-mints once on 401.
- **Command Runner** (`runCommands`, the "run a show command on a real switch" flow): POST to
  `/network-device-poller/cli/read-request` with `{commands, deviceUuids}` → poll `/task/{taskId}`
  every ~1.2s up to ~40s → extract `fileId` from the task progress → GET `/file/{fileId}` → map
  `SUCCESS`/`FAILURE`/`BLOCKLISTED` responses per host.
- Also real: inventory, device-health, network-health, physical-topology (dedups reverse links),
  interfaces, issues, events, client-health.
- **Defaults** to the public DevNet sandbox (`sandboxdnac.cisco.com` / `devnetuser` / `Cisco123!`);
  override with `CATC_BASE_URL` / `CATC_USERNAME` / `CATC_PASSWORD`.
- **`rejectUnauthorized: false`** — TLS verification disabled for the self-signed sandbox cert,
  applied to every host. A production hardening item.

### 3c. Simulator — `network-data.cjs`

Self-contained, deterministic (seeded `mulberry32` PRNG keyed to the day). 10 synthetic devices
(`CORE-R1`, `EDGE-R1`, `DIST-SW1`, `FW-1`, …), fixed "overnight" incidents anchored to wall-clock
so overnight questions return the same 4 alerts. Provides BGP/OSPF/health/interfaces/traffic/drops/
status-board/topology. Intentional simulation, not a stub. Used as fallback + for offline demos.

### 3d. Other adapters (`sources/`)

- `nvd.cjs` — **real**, keyless NVD CVE 2.0 API; powers `vulnerability_check`, grounded in the
  devices' actual reported software version. Note 119-day window cap and NVD rate limits.
- `prometheus.cjs` — **real but thin**; only queries the `up` metric; off unless `PROMETHEUS_URL`.
- `snmp.cjs` — **stub**; returns null placeholder but `ok:true`. No SNMP is performed.

### 3e. Evidence plane — cross-platform investigations (`sources/evidence/`, `core/investigation.cjs`)

The SOC side of the product (AI-Ready SOC, Part II). One `investigate` tool takes a seed entity
(user | ip | host) and a window and correlates evidence from pluggable **evidence providers** into
one timestamped investigation: merged/deduped/time-ordered timeline, per-platform coverage,
pivot candidates (other users/IPs/hosts that co-occur with the seed), deterministic observations,
and an explicit gap list. Two provider families ship:

- `evidence/splunk.cjs` — **real** Splunk REST client (`/services/search/jobs/export`, bearer or
  basic auth, TLS verification on by default). Every SPL passes `core/spl-policy.cjs`
  (`assertReadOnlySpl`: no `delete`/`collect`/`outputlookup`/`sendemail`/`script`/`rest`/…).
- `evidence/lenses.cjs` — one CIM-based SPL lens per platform: **vpn, proxy, firewall, endpoint,
  identity, cloud, siem** (notables). Base searches are overridable per shop via
  `SPLUNK_LENS_<PLATFORM>`. Rows map to the `EvidenceEvent` contract using CIM field names only.
- `evidence/index.cjs` — `createCatalystCenterEvidenceProvider` (network lens: issues + event
  series, real epoch timestamps) and `collectEvidence()` (parallel fan-out; a throwing provider
  becomes a `failed` result). Unconfigured providers report `status:"unconfigured"` — never
  placeholder data.

- `evidence/fixture.cjs` — **mock lab (FIXTURE DATA), opt-in only** via `NETJARVIS_EVIDENCE_FIXTURE`:
  `fixtures/mock-lab/` = 12 mock SOC devices + one feed per platform. Rows are provider `fixture`
  and the artifact/summary/chat reply are banner-labelled, so it can never pass as real data.

`core/investigation.cjs` is pure (no I/O, no LLM): `buildInvestigation()` +
`renderInvestigationMarkdown()` + `summarizeInvestigation()`. Voice calls the tool directly; chat
routes `investigate …` through `INTENTS.INVESTIGATE` → `skills/investigation.cjs`, which narrates
strictly from the tool's JSON output. Owning specialist: **Investigation Agent** (`soc`, Security Team).

---

## 4. The specialist agent team — `agents.cjs`

A hierarchical org chart of specialist "agents" (Data, Firewall/Proxy/LoadBalancer, Change/Incident/
Problem management) plus user-created custom agents. Two ways work reaches the Kanban board
(`data/tasks.json`):

1. **Direct tool run** — every `execute()` in `tools.cjs` calls `recordJarvisActivity()`, creating a
   task routed to a team via `TOOL_ROUTING` (e.g. `run_show_command`→data, `active_alerts`→incident),
   marked in_progress→done/failed. So the board shows the whole session, not just delegations.
2. **Delegation** — `delegate_task` tool → `agents.delegate(team, task)` → `runSpecialist()` runs an
   independent gpt-5-mini tool-loop (up to 10 rounds) with a specialist system prompt and the
   read-only tool subset, returns a written report. Blocks 15–60s.

Tasks persist to `data/tasks.json` (capped 500) behind a write queue. `TeamBoard.tsx` polls
`/api/tasks` every 1s to render the board live.

---

## 5. Frontend state flow

`App.tsx` holds all top-level state in one component. Three independent refresh loops run
regardless of voice:
- `OpsDashboard` → `getDashboard()` every 30s (and on mount; 5s retry on error).
- `TeamBoard` (`useTeamTasks`) → `getTasks()` every 1s; also re-fires when `taskRefreshToken` bumps
  (any tool event bumps it).
- `ArtifactsPanel` → `listArtifacts(200)` every 10s.

Chat history has a single source of truth: `App.transcript`, written only through
`transcriptGate.commitTranscript` (drops `jarvis_interim`, dedupes consecutive identical finals).
`SquadChatPanel` and `OpsDashboard`'s session log both **derive** from it.

Artifacts: a tool returns `{artifact:{title,kind,content}}`; `execute()` persists it via
`artifacts.saveArtifact` (→ `data/artifacts/`, downloadable at `/api/artifacts/:id/download`) and
attaches a `downloadUrl`. The UI renders the **current** artifact in `ObservabilityPanel` (split by
the literal markers `## Behind the scenes` / `## CLI output`) and the **history** in `ArtifactsPanel`.

Note: the older single-artifact renderer in `ArtifactPanel.tsx` (`renderArtifact` + `StatusBoard`,
`MarkdownArtifact`, mermaid, etc., ~300 lines) is **dead code** — superseded by `ObservabilityPanel`.
A side effect is that **mermaid topology artifacts are no longer displayed anywhere**.

---

## 6. Background services & persistence

- `scheduler.cjs` — periodic shift briefings (`SHIFT_BRIEFING_INTERVAL_MINUTES`, default 480).
- `alert-watcher.cjs` — polls the snapshot every ~1 min; when new Catalyst Center issues appear it
  writes a proactive event (`data/proactive-events.json`). The voice client polls
  `getProactiveEvents()` every 30s and injects `[SYSTEM ALERT …]` into the live session, then marks
  it spoken. (Chat has no equivalent proactive surface.)
- `session-store.cjs` — per-conversation JSONL audit under `data/sessions/`, plus an index.
- `db.cjs` — shift notes + acknowledged sim alerts (`data/netjarvis-db.json`), write-queued.
- `checks.cjs` — pre/post snapshot capture + diff (device health, interfaces, error counters).
- All persistence is **local files under `data/`** (gitignored). There is no database.

---

## 7. Security & guardrails

- Read-only CLI: `guardrails.validateToolCall` + `network-source.runLiveShowCommands` both reject
  anything not matching `^show\s`, plus a blocklist (config/write/copy/delete/no/clear/reload/
  shutdown/reboot/debug/telnet/ssh). Config changes are refused before any API call.
- Read-only SPL: `core/spl-policy.cjs` rejects any Splunk search that writes, collects, executes or
  sends (`delete`, `collect`, `outputlookup`, `sendemail`, `script`, `rest`, `map`, …) before the
  request leaves the box; `guardrails.validateToolCall("investigate")` requires exactly one seed.
- State-changing actions (`acknowledge_alert`) require explicit `confirmed:true`.
- Secrets only from `.env.local`; redacted in logs. Realtime key never reaches the browser (only a
  short-lived minted secret does).
- Open item: TLS verification disabled in the Catalyst adapter (§3b).

---

## 8. What's real vs simulated vs stubbed (quick reference)

| Area | Status |
|---|---|
| Voice (OpenAI Realtime, WebRTC) | Real, working |
| Catalyst Center live integration (auth, inventory, health, topology, Command Runner) | Real |
| Simulator fallback | Real (deterministic) |
| NVD CVE lookup (`vulnerability_check`) | Real, keyless |
| Chat classify→plan→skill→audit pipeline | Real |
| Specialist agent delegation + Kanban | Real (gpt-5-mini loops) |
| CSV export, artifacts, pre/post checks, tickets, trends, notes, email (SMTP) | Real |
| Cross-platform `investigate` (Splunk lenses + Catalyst Center network evidence) | Real; Splunk lenses need `SPLUNK_URL` + token, otherwise reported as unconfigured |
| Prometheus adapter | Real but thin (`up` metric only) |
| SNMP adapter | ⚠ Stub (null data, false ok) |
| `run_show_command` in sim/offline mode | ✗ Hard-fails (live-only) |
| Mermaid topology artifact rendering | ✗ Dead (renderer removed) |

See `docs/KNOWN-ISSUES.md` for the prioritized fix list.
</content>
