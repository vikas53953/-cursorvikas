# Grounded Answers — Implementation Plan

> Executes `docs/plans/2026-07-04-001-feature-grounded-answers-plan.md`. TDD, `node --test`, CommonJS `.cjs`. Reuses the Phase 1 engine (`electron/core/scope-resolver.cjs`, `query-layer.cjs`, `source-registry.cjs`, providers/executors).

**Goal:** For any read question (voice + chat), the AI passes the user's verbatim words to one grounding capability; the engine resolves → runs read-only → composes the answer; the AI states only engine facts. Honest "no such device"; read-back on ambiguous; two-beat hedge for voice.

**Global constraints:** real data only; read-only forever (per-platform policy already built); no hardcoded device names; secrets from env; `.cjs`, runs under `node --test`. Conservative-option-and-proceed on any fork; log each in `implementation-notes.md`.

---

### Task G1: Single-fact composer (attribute vocabulary → exact sentence)
**Files:** Create `electron/core/fact-compose.cjs`; Test `test/fact-compose.test.cjs`.
**Produces:** `composeFact(question, device) → { matched:true, attribute, sentence } | { matched:false }`. A general synonym map (attribute class → device field): version/software/ios/code→software+softwareVersion, ip/address/management→mgmtIp, uptime/up/running→uptime, model/platform/hardware→platform, serial→serialNumber, role→role, reachability/reachable→reachability, cpu→cpu, memory/mem→memory. No per-device rules — one attribute vocabulary over the device record.
**TDD:** test "what version is sw1 running" + device{name:'sw1',softwareVersion:'17.12.1',software:'IOS-XE'} → matched, sentence "sw1 is running IOS-XE 17.12.1." ; "ip of sw1" → mgmtIp sentence; "what's on sw1" (no attribute) → matched:false (routes to CLI path). Then implement, pass, commit.

### Task G2: Grounding capability (`ask_network`)
**Files:** Create `electron/core/grounding.cjs`; Test `test/grounding.test.cjs`.
**Consumes:** `resolveScope` (Task4 P1), a registry/queryLayer (injected), `composeFact` (G1).
**Produces:** `createGrounding({ registry, queryLayer, session })` → `ask({ targetPhrase, question }) → result`:
- Resolve `targetPhrase` (or, if empty/pronoun like "it"/"that"/"its", use `session.lastDevice`) against `registry.allDevices()` via resolveScope.
- `total===0` → `{ status:'not_found', phrase, nearest: <up to 3 real names> }`.
- `>=1` → pick top as `device` (R4: read-back), keep `others` for the model to mention; set `session.lastDevice = device`.
- Single-fact: `composeFact(question, device)` → if matched, `{ status:'answered', device:device.name, answerKind:'fact', sentence, others }`.
- Else CLI: derive the show command from the question is the MODEL's job on the way in — so `ask` accepts an optional `commands[]`; if absent for a non-fact question, return `{ status:'need_command', device:device.name }` so the model supplies a read-only show command, which then runs via queryLayer and returns `{ status:'answered', answerKind:'output', device, output, note:'summarize only; state no number not present here' }`.
- Always read-only (queryLayer + policy enforce).
**TDD:** injected registry with sw1(softwareVersion) + fake queryLayer. Tests: fact question → answered/fact/sentence; "switch 99" → not_found + nearest; pronoun follow-up uses session.lastDevice; non-fact with commands → runs, returns output block. Implement, pass, commit.

### Task G3: Wire `ask_network` as a tool
**Files:** Modify `electron/tools.cjs` (toolSpec + execute case using the createGrounding instance built in createTools; session object per tools instance); Test `test/ask-network.integration.test.cjs`.
**Spec:** tool `ask_network` params `{ target_phrase (string, the user's verbatim words), question (string), commands (array, optional read-only show commands) }`. Execute → grounding.ask(...); shape result into `{ ok, ...result, artifact }`. Read-only guardrail applies to commands. Integration test with injected catc (like Phase 1 Task 11). Commit.

### Task G4: Voice persona — quote-and-ground + two-beat
**Files:** Modify `electron/tools.cjs` `JARVIS_INSTRUCTIONS` (add a "Grounded answers (MANDATORY)" section) and confirm `realtime-token.cjs` passes it. No unit test (prompt text); verify the minted token/toolSpecs include `ask_network`.
**Rules text (R1–R6):** For ANY question about the network/devices, call `ask_network` with the user's EXACT words as `target_phrase` — never your paraphrase, never a device you assumed. State only facts `ask_network` returns. If status not_found → say "there's no <phrase>" and offer the nearest real names; never run a command on it. If it returns a fact sentence, say that sentence (add tone, no new facts). For tables/output, summarize ONLY what's in the returned output; state no number that isn't there. Voice: the instant you receive a question, say a short non-committal line ("let me check that on <device>…") BEFORE the tool returns, then state the fact when it does. Follow-ups like "its uptime" carry the last device automatically.

### Task G5: Chat persona — same grounding
**Files:** Modify `electron/answer-policy.cjs` `generalChatSystemAppendix` (+ ensure chat's llm_loop has `ask_network`) so chat uses `ask_network` with verbatim words and states only its facts. Test that a chat turn for "version on sw1" routes through ask_network (integration, injected catc).

### Task G6: Fact telemetry (O4 silent)
**Files:** Create `electron/core/fact-telemetry.cjs`; Test `test/fact-telemetry.test.cjs`.
**Spec:** `logAnswer({ channel, question, grounded, reply })` appends a JSONL line to `data/logs/fact-audit-*.jsonl` recording the engine's grounded facts vs the final reply text (for later drift analysis). Silent — never blocks or corrects. Wire a call where ask_network results are finalized. Test it writes a line. Commit.

---
## Notes for the builder
- Anaphora `session.lastDevice` lives on the grounding instance (per tools instance / per conversation). Conservative: reset is not required for the sandbox.
- If G1's attribute map can't cleanly answer a fact from inventory (field missing), fall through to the CLI/output path — never guess.
- Keep every existing test green. Run `npm test` + `npm run typecheck` before each commit.
</content>
