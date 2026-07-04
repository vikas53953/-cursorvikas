# NetJarvis — Known Issues & Open Questions

Grounded in a full read of the code (electron/, src/, server/) as of the `main` branch,
commit `d4743fc`. Grouped by severity. Each item says **what**, **where**, **why it matters**, and
a suggested direction — but nothing here has been fixed yet; these are findings, not changes.

The "Open questions" section at the end lists things only the owner can decide — do not guess these.

---

## P1 — Correctness / user-facing breakage

### 1. `run_show_command` hard-fails in sim/offline mode → CLI skills break offline
- **Where**: `tools.cjs` `runShowCommand()` returns `ok:false` whenever `mode !== "live"`.
- **Impact**: the chat skills `cli_show` and `device_precheck` call this tool, so *any* "show me the
  MAC table on sw1" / "run a precheck on sw2" typed in chat **errors out** whenever Catalyst Center
  is unreachable (which `auto` mode falls back from silently). Voice hits the same wall.
- **Direction**: either (a) have the simulator answer common show commands (`show vlan brief`,
  `show ip route`, `show mac address-table`, …) so the demo/offline experience is coherent, or
  (b) make the failure message explicit and route the user to the sim-native tools. (a) is the
  bigger win for a layman-facing product.

### 2. Device-name parser doesn't match the actual inventory
- **Where**: `device-facts.cjs` regexes only recognize `swN` ("sw1", "switch 1"). But simulator
  devices are `CORE-R1`/`EDGE-R1`/`DIST-SW1`/`FW-1`, and live sandbox devices have Catalyst
  hostnames. `tools.cjs` `extractDeviceFromText` has the same `sw`-only assumption.
- **Impact**: in the chat fast-path, "how is CORE-R1 doing" or "uptime on the edge router" won't be
  recognized as a device_fact and falls through to the generic path; "switch 1" won't map to
  `DIST-SW1`. The parser looks written for a different inventory than the app ships.
- **Direction**: derive the device-name matcher from the live/sim snapshot's actual device list
  (fuzzy/substring match against real hostnames + roles) instead of a hardcoded `sw` regex.

### 3. SNMP adapter is a stub that reports success
- **Where**: `sources/snmp.cjs` returns `{ ok:true, sysDescr:null, sysUpTime:null, note:"Install a
  native SNMP client dependency" }` when `SNMP_HOST` is set.
- **Impact**: `multi_source_status` presents SNMP as healthy/configured while it does nothing —
  misleading in a NOC tool where trust matters.
- **Direction**: either implement real SNMP (e.g. a native/pure-JS SNMP client) or have it report
  `ok:false, configured:false` honestly until then.

### 4. Electron `listArtifacts` arity bug
- **Where**: `preload.cjs` `listArtifacts: (_event, limit) => invoke("artifacts:list", limit)` but
  callers do `window.jarvis.listArtifacts(200)`. The `200` binds to `_event`; `limit` is `undefined`
  under Electron. The web bridge and the type decl use the correct single-arg form.
- **Impact**: artifact list limit ignored in the desktop app (falls back to backend default 40).
- **Direction**: `listArtifacts: (limit) => invoke("artifacts:list", limit)`.

---

## P2 — Design divergence / maintainability

### 5. Voice and chat are two separate brains (see ARCHITECTURE §2)
- Same questions can be answered differently: voice uses the raw Realtime model + full tools; chat
  uses classify→plan→skill. This was a deliberate revert (ROLLBACK.md) for latency/HUD reasons, but
  it is the biggest ongoing maintenance tax — every tool/behavior change risks needing two fixes.
- **Direction (needs owner input)**: decide the long-term intent — keep the split and accept the
  tax, or invest in a shared core with the latency/HUD problems solved. This is an *open question*,
  not a quick fix.

### 6. ~300 lines of dead artifact-rendering code
- **Where**: `ArtifactPanel.tsx` `renderArtifact` and its helpers (`StatusBoard`,
  `TaskBoardArtifact`, `MarkdownArtifact`, mermaid machinery, `NotesGrid`, `JsonTable`, …) are
  defined but never called — superseded by `ObservabilityPanel`.
- **Impact**: confusing; and a real functional regression — **mermaid topology artifacts are no
  longer rendered anywhere**, so "show me the topology" produces an artifact nothing displays as a
  diagram.
- **Direction**: delete the dead code; if topology diagrams should render, wire mermaid into
  `ObservabilityPanel`.

### 7. Dashboard doesn't react to tool activity
- **Where**: `taskRefreshToken` only drives `TeamBoard`; `OpsDashboard` only refreshes on its 30s
  poll. A tool that changes state (e.g. acknowledge_alert) won't reflect on the dashboard until the
  next poll.
- **Direction**: bump a dashboard refresh on relevant tool events, or shorten the poll.

### 8. Sim topology links are empty
- **Where**: `network-source.cjs` `simSnapshot()` always sets `links: []`, though the simulator has
  a topology. Dashboard link view is blank in sim mode.

### 9. Fragile artifact parsing by magic strings
- **Where**: `observability.ts`, `ObservabilityPanel.tsx`, `SquadChatPanel.tsx` split narrative vs
  CLI output on the literal strings `## Behind the scenes` / `## CLI output`. If the backend
  formatting changes, the split silently breaks.
- **Direction**: return structured fields (`{narrative, cliOutput}`) instead of parsing markdown.

### 10. Dead / duplicated exports
- `catalyst-center.getClientHealth` (defined, exported, never consumed).
- `device-facts.formatDeviceFactReply` (superseded by `answer-policy.formatDeviceFactFromSnapshot`).
- `realtime.ts silentMouthShape()` duplicated as an inline literal in `App.tsx` (2×).

---

## P3 — Hardening / hygiene

### 11. TLS verification globally disabled in the Catalyst adapter
- `rejectUnauthorized:false` (`catalyst-center.cjs`) — necessary for the self-signed sandbox cert,
  but applied to every host. If pointed at a real Catalyst Center with real credentials, this is a
  MITM risk. **Direction**: only disable for the known sandbox host, or make it an explicit opt-in
  env flag.

### 12. No test suite, no linter, no CI
- Only `scripts/behavior-cycle.cjs` (a 6-tool smoke test) and `tsc --noEmit`. No unit tests for the
  regex classifier, guardrails, source normalization, or answer-policy — all high-value,
  pure-function targets. **Direction**: add focused unit tests for `message-router`, `guardrails`,
  `answer-policy`, `network-source` normalization; wire a lint + typecheck + behavior-cycle CI.

### 13. README drift
- README says 3 right-hand tabs ("Reports"); code has 4 (Observability + Artifacts). README's
  "Architecture" section predates the enterprise/skills layer. **Direction**: refresh README, or
  point it at `docs/ARCHITECTURE.md`.

### 14. Single-file frontend state
- `App.tsx` holds ~18 `useState` fields and both pipelines. Fine for now; will get harder as
  features grow. **Direction**: consider extracting a voice-session hook and a chat hook when it
  next needs surgery.

---

## Owner decisions (recorded 2026-07-04)

Clarified through brainstorming. **These supersede an earlier, wrong framing of this as a
"demo/learning platform"** — it is a **real enterprise product**. Full design in
`docs/superpowers/specs/2026-07-04-netjarvis-enterprise-architecture-design.md`.

1. **Positioning: real, enterprise-grade product** — architected for Bank of America scale (~70k
   data devices, 1k+ firewalls, 800+ proxies, 2k+ load balancers), across multiple domains. The
   Cisco sandbox is only the *first reachable real backend*, never the point. The eventual "demo" is
   just showing the finished real product.
2. **Real data only.** Delete the inherited fake simulator; unreachable = honest "unreachable" +
   auto-retry. Never fabricate a number.
3. **Two-plane architecture.** Plane 1 = CMDB (inventory/scope only, "which devices"). Plane 2 =
   execution = SSH via jump host to the real device CLI (pluggable Executor; Catalyst Center Command
   Runner is a second executor for the sandbox). Scope-first, hard fan-out caps.
4. **Scope: read-only forever — a hard boundary.** No config-change / remediation path.
5. **Voice vs chat: keep the split**, but both call one shared Network Query Layer beneath.

The P1/P2/P3 items above are now folded into the enterprise architecture's Phase 1 (device-name
parser → inventory-driven resolver; simulator removal; run_show_command → pluggable executor; dead
UI code + topology rendering + dashboard reachability).

Still genuinely open (deferred, don't block Phase 1): which concrete CMDB BofA uses; jump-host
("Patti") connection specifics; exact SSH sandbox for validating SshExecutor; deployment + user auth.
</content>
