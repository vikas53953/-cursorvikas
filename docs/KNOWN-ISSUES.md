# NetJarvis — Known Issues & Open Questions

Grounded in a full read of the code (electron/, src/, server/) as of the `main` branch,
commit `d4743fc`. Grouped by severity. Each item says **what**, **where**, **why it matters**, and
a suggested direction — but nothing here has been fixed yet; these are findings, not changes.

The "Open questions" section at the end lists things only the owner can decide — do not guess these.

---

## P1 — Correctness / user-facing breakage

### 1. `run_show_command` hard-fails in sim/offline mode → CLI skills break offline
- **Where**: `tools.cjs` `runShowCommand()`.
- **Status (2026-09-07)**: **mitigated for the mock lab.** When
  `NETJARVIS_EVIDENCE_FIXTURE` is on, show commands return labelled FIXTURE CLI
  (`electron/sources/fixture-cli.cjs`). Unknown commands stay honest ("no mock
  output"). Still `ok:false` when CATC is down and the mock lab is off.
- **Remaining**: no unlabelled simulator for `NETJARVIS_SOURCE=sim`.

### 2. Device-name parser doesn't match the actual inventory
- **Where**: `device-facts.cjs`, `tools.cjs` `extractDeviceFromText`.
- **Status (2026-09-07)**: **mitigated.** Extraction uses `source.peekInventory()`
  / the registry list via `resolveScope`. Fallback also matches hyphenated names
  (`CORE-R1`, `vpn-asa-1`, `LT-4421`), not only `swN`.

### 3. SNMP adapter is a stub that reports success
- **Where**: `sources/snmp.cjs`.
- **Status (2026-09-07)**: **fixed honesty.** Returns `ok:false` whether or not
  `SNMP_HOST` is set (`configured: true` + "not implemented" when a host is set).
  No native SNMP client yet.

### 4. Electron `listArtifacts` arity bug
- **Where**: `preload.cjs`.
- **Status (2026-09-07)**: **fixed.** `listArtifacts: (limit) => invoke(...)`.

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
- **Where**: `App.tsx` tool/chat completion.
- **Status (2026-09-07)**: **mitigated.** `dashboard.reload(false)` runs on tool start/done/error
  and after chat replies. The 30s poll remains as a backstop.

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
