# CLAUDE.md — NetJarvis operating guide

This file orients any AI agent (or engineer) working on this codebase. Read it first.
Deeper detail lives in `docs/ARCHITECTURE.md`; the current problem list lives in `docs/KNOWN-ISSUES.md`.

## What this is

**NetJarvis** is a voice-first AI copilot for network operations (a "NetOps Jarvis"). A NOC
engineer talks to it in plain language ("how's my network doing?", "show me the MAC table on
sw1", "any interfaces down?") and it connects to a real backend network, runs read-only
commands, and answers — by voice and in a live dashboard.

It ships pointed at the **Cisco DevNet Catalyst Center always-on sandbox** (a real 4-switch
Catalyst 9000v network, `sw1`–`sw4`, no VPN/account needed). When that source is unreachable it
falls back to a **built-in deterministic simulator** so the app never fully breaks.

Runs two ways from the same code:
- **Electron desktop app** (`npm run dev` / `npm start`) — `electron/main.cjs` is the entry.
- **Plain web app** (`npm run web`) — `server/web.cjs` serves `dist/` + an HTTP API that mirrors
  the Electron IPC surface. This is the mode used for remote/Cloudflare deployment.

## The goal (owner's agenda)

Build a UI where a user asks any network question in layman's terms, the system routes it to the
right network service, connects to the backend network, and answers. Owner is a network engineer
with ~15 years of experience. Several pieces already work end-to-end (voice → Catalyst Center →
answer). The project was originally scaffolded in Cursor; it is now maintained here.

**This is a real, enterprise-grade product** — architected for Bank of America scale (tens of
thousands of devices across data/firewall/proxy/load-balancer domains), *not* a demo or a tool for
four switches. The Cisco DevNet sandbox is only the first reachable real backend. **No fabricated
data, ever; read-only forever.** The target architecture (two planes — CMDB for inventory/scope,
SSH-via-jump-host execution — pluggable sources, scale-aware) is specified in
`docs/superpowers/specs/2026-07-04-netjarvis-enterprise-architecture-design.md`. That spec is the
north star; the current code is the pre-refactor starting point.

## Commands

```bash
npm install
cp .env.example .env.local        # then set OPENAI_API_KEY for voice

npm run dev          # Vite (127.0.0.1:5173) + Electron desktop app
npm start            # Electron against an already-built dist/
npm run build        # tsc --noEmit && vite build  → dist/
npm run web          # node server/web.cjs → http://localhost:8080 (needs a prior build)
npm run typecheck    # tsc --noEmit
npm test             # node --test → test/*.test.cjs (backend unit + integration tests, no network needed)
npm run test:behavior # scripts/behavior-cycle.cjs — smoke-tests core tools + activity board
```

`npm test` (`node --test`) is the backend correctness gate — pure-function and injected-fake tests
for the core engines, sources, router, guardrails and skills. `test:behavior` exercises ~6 tools
against whatever source is live/sim and asserts they return `ok`. `npm run build`'s `tsc --noEmit`
is the correctness gate for the frontend/TS. There is no linter.

Node 20+ required. Voice needs `OPENAI_API_KEY` (Realtime access). Web search needs `EXA_API_KEY`.
Cross-platform investigations need `SPLUNK_URL` + `SPLUNK_TOKEN` (or basic creds) for the
VPN/proxy/firewall/endpoint/identity/cloud lenses; without them those platforms report
"unconfigured" and only the Catalyst Center network lens contributes evidence. For development
without Splunk, `NETJARVIS_EVIDENCE_FIXTURE=1` loads the mock lab (`fixtures/mock-lab/`) — every
result it touches is labelled FIXTURE DATA; it is never on by default.
Everything else (dashboard, all network tools, simulator) works with no keys.

## The single most important thing to understand: two answer paths

Voice and text/chat do **not** share a brain. Same questions can be answered differently.

- **Voice** (`src/lib/realtime.ts` → OpenAI Realtime API over WebRTC): the model is given the full
  tool set and calls tools **client-side** via `window.jarvis.executeTool` → `/api/tools/execute`
  → `electron/tools.cjs` `execute()`. It does **not** go through the intent classifier, planner, or
  skills. Persona = `JARVIS_INSTRUCTIONS` in `tools.cjs`.
- **Chat / squad chat** (`/api/chat/message` → `electron/handle-user-message.cjs`): goes through the
  "enterprise" pipeline — `message-router.cjs` (regex intent classifier) → `action-planner.cjs`
  (intent→skill plan) → `skills/*.cjs` → `session-store.cjs` (JSONL audit). Tool orchestration is
  **server-side**; the client gets a fully-resolved `{text, artifacts[], activity[]}`.

This split is **deliberate**. `ROLLBACK.md` records that a "voice router" experiment which unified
them (transcribe → handleUserMessage → TTS) was reverted on 2026-07-04 because it added latency and
broke HUD/orb sync. Do not re-merge these without a plan for those two problems. When you change
tool behavior, remember it may need fixing in **both** paths.

## Directory map

```
electron/                 Backend (Node, all .cjs, NO electron dependency except main.cjs/preload.cjs)
  main.cjs                Electron entry: window, IPC handlers, background services
  preload.cjs             contextBridge → window.jarvis (IPC impl of the backend surface)
  tools.cjs               ★ Heart: JARVIS_INSTRUCTIONS persona, toolSpecs, execute(), createTools()
  message-router.cjs      Chat-only regex intent classifier (device_fact, cli_show, investigate, etc.)
  action-planner.cjs      Maps classified intent → {skill, mode, tool}
  handle-user-message.cjs Chat orchestrator: classify → plan → skill → audit
  skills/                 Chat skill handlers (device-fact, network-overview, device-precheck,
                          interface-status, cli-show, investigation, llm-loop) + index.cjs registry
  core/
    investigation.cjs     ★ Cross-platform investigation engine: EvidenceEvent contract, correlation,
                          timeline / pivots / observations / gaps, markdown render (pure, no I/O)
    spl-policy.cjs        Read-only SPL guard (blocks delete/collect/outputlookup/sendemail/script/rest/…)
    grounding.cjs, command-former.cjs, answer-composer.cjs, query-layer.cjs, source-registry.cjs,
    read-only-policy.cjs, scope-resolver.cjs, contracts.cjs, fact-*.cjs  (grounded-answers engine)
  answer-policy.cjs       Reply-shape rules per intent (truncate, strip preamble/next-steps)
  chat-reply.cjs          Strips robotic "next steps" sections from replies
  guardrails.cjs          Read-only CLI enforcement (only `show ...`, blocklist)
  agents.cjs              Specialist agent team (org chart), delegate(), Kanban tasks, chatCompletion
  custom-agents.cjs       User-created agents (data/custom-agents.json)
  network-source.cjs      ★ Source facade: picks live vs sim, normalizes both to one snapshot shape
  network-data.cjs        Deterministic simulator (seeded PRNG, 10 devices, fixed overnight incidents)
  sources/
    catalyst-center.cjs   ★ Real Cisco Catalyst Center Intent API client (auth, inventory, health,
                          topology, issues, events, Command Runner for show commands)
    nvd.cjs               Real NVD CVE lookup (keyless) — powers vulnerability_check
    prometheus.cjs        Thin real adapter (only queries `up` metric); off unless PROMETHEUS_URL set
    snmp.cjs              ⚠ STUB — returns null placeholder data but reports ok:true
    evidence/             Evidence plane for `investigate` (AI-Ready SOC, Part II)
      splunk.cjs          Real Splunk REST search client (export endpoint; bearer/basic; TLS verify on)
      lenses.cjs          CIM-based SPL lens per platform: vpn, proxy, firewall, endpoint, identity, cloud, siem
      index.cjs           Provider contract, Catalyst Center network-evidence provider, collectEvidence()
      fixture.cjs         Mock-lab providers (FIXTURE DATA) — opt-in via NETJARVIS_EVIDENCE_FIXTURE only
  realtime-token.cjs      Mints OpenAI Realtime ephemeral client secret (model gpt-realtime-2)
  session-store.cjs       Per-conversation JSONL audit (data/sessions/)
  artifacts.cjs           Persists every tool artifact for download (data/artifacts/)
  alert-watcher.cjs       Background poll: emits proactive "something broke" events
  scheduler.cjs           Background scheduled shift briefings
  checks.cjs              Pre/post-check snapshot capture + diff
  tickets.cjs, problem-trends.cjs, mail.cjs, device-facts.cjs, logger.cjs, degradation.cjs, db.cjs

src/                      Frontend (React 19 + Vite + TS)
  main.tsx                Installs webBridge (browser) then renders App
  App.tsx                 ★ Top-level orchestrator: voice connect(), chat deliverUserMessage(), state
  lib/
    realtime.ts           ★ JarvisRealtimeClient: WebRTC voice, tool-call handling, mouth-shape meter
    webBridge.ts          Browser shim: window.jarvis → HTTP /api/* (no-ops under Electron)
    transcriptGate.ts     Single write path for chat history (drops interim, dedupes)
    observability.ts, tasks.ts, artifactExport.ts, squadMentions.ts, ...
  components/
    NetworkCore.tsx       SVG avatar/orb (status ring, packets-in-flight, waveform)
    Hud.tsx               Voice status readout
    OpsDashboard.tsx      NOC dashboard — self-polls getDashboard() every 30s
    TeamBoard.tsx         Kanban of agent tasks — polls /api/tasks every 1s
    SquadChatPanel.tsx    Slack/Teams-style chat (921 lines) w/ @mentions, /slash, custom agents
    ArtifactPanel.tsx     4-tab container: dashboard | team | observability | artifacts
    ObservabilityPanel.tsx Current-artifact view (behind-the-scenes / CLI / narrative) + audit
    ArtifactsPanel.tsx    Download library — polls listArtifacts() every 10s

server/web.cjs            HTTP API for web mode (mirrors IPC), serves dist/
scripts/behavior-cycle.cjs Smoke test
scripts/investigate-demo.cjs `npm run demo:investigate` — investigation against the mock lab
fixtures/mock-lab/        FIXTURE DATA: 12 mock SOC devices (devices.json) + one evidence feed per
                          platform (vpn, proxy, firewall, endpoint, identity, cloud, siem, network).
                          Loaded ONLY when NETJARVIS_EVIDENCE_FIXTURE is set; always labelled FIXTURE.
data/                     Runtime state (gitignored): db, sessions, artifacts, tasks, exports, logs
```

★ = read these first when onboarding.

## Conventions & contracts

- **Backend is plain CommonJS `.cjs`** and deliberately has **no Electron dependency** (except
  `main.cjs`/`preload.cjs`) so `tools.cjs` and friends run under plain Node for the web server and
  `test:behavior`. Keep it that way.
- **Tool contract**: a tool is a `case` in `tools.cjs` `executeInner()` returning
 `{ ok, ...data, artifact?: {title, kind, content} }`. Add the spec to `toolSpecs`, the routing to
 `TOOL_ROUTING` in `agents.cjs`, and (if it changes state) a guard in `guardrails.cjs`.
- **Evidence provider contract** (investigations): `{ id, platform, configured(), collect({entity,
 window, limit}) → { status: "ok"|"empty"|"unconfigured"|"failed", events: EvidenceEvent[], query?,
 error?, ms? } }`. Register it in `sources/evidence/index.cjs` `createEvidenceProviders`. A
 provider that is not configured must say so — never return placeholder rows.
- **Skill contract** (chat path only): a module `{ id, run({route, plan, deps, message, target,
  channel}) }` registered in `skills/index.cjs`. `deps` carries `execute`, `agents`,
  `chatCompletion`, `toolSpecs`, formatting helpers.
- **`window.jarvis`** is the one backend surface the frontend sees. Its shape is declared in
  `src/vite-env.d.ts`. If you add a method, implement it in **both** `preload.cjs` (IPC) and
  `webBridge.ts` (HTTP) or the two run modes diverge.
- **Secrets** load only from `.env.local` (gitignored). `data/`, `dist/`, `node_modules/` are
  gitignored. Never commit them.
- **LLM models in use**: voice = `gpt-realtime-2`; chat/specialist reasoning = `gpt-5-mini`
  (`agents.cjs` `chatCompletion`). CVE data = NVD; web search = Exa.

## Known gotchas (see docs/KNOWN-ISSUES.md for the full, prioritized list)

- `run_show_command` is **live-only** — it returns `ok:false` in sim/offline mode. So the
  `cli_show` and `device_precheck` chat skills hard-fail when Catalyst Center is unreachable.
- The `device-facts.cjs` device-name parser only matches `swN` names, but the **simulator** devices
  are `CORE-R1`/`EDGE-R1`/`DIST-SW1`/`FW-1` and live devices are sandbox hostnames — so the chat
  fast-path device matching is mismatched to the actual inventory.
- `sources/snmp.cjs` is a **stub that reports success** with null data (misleads multi_source_status).
- **TLS verification is globally disabled** in the Catalyst Center adapter (`rejectUnauthorized:false`)
  for the self-signed sandbox cert — a real risk if pointed at production.
- Electron `preload.cjs` `listArtifacts` has an **arity bug** (`limit` binds to `_event`).
- `ArtifactPanel.tsx` contains ~300 lines of **dead artifact-rendering code** (superseded by
  `ObservabilityPanel`); mermaid topology artifacts are no longer rendered anywhere as a result.
- The **dashboard does not react to tool activity** — it only refreshes on its 30s poll.
- README describes 3 right-hand tabs ("Reports"); the code now has **4** (Reports split into
  Observability + Artifacts). Treat README as aspirational where it drifts from code.

## Rolling back

`ROLLBACK.md` has git tags/SHAs for known-good states. Notably
`rollback-pre-enterprise-layers` (`9d00b7a`) predates the classifier/planner/skills layer, and
voice was reset to direct-Realtime behavior on 2026-07-04.
</content>
</invoke>
