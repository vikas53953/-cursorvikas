# One Brain, Two Mouths — Implementation Plan

> Fable-5 verdict (approved by Vikas 2026-07-06): the voice model stops deciding anything. A STRONG text brain forms the exact IOS command from the user's intent and composes the answer; voice/chat are just mouths. Reuse the shipped grounded-answers engine. TDD, `node --test`, CommonJS `.cjs`. Branch `one-brain` off main (755480a).

**Decisions (locked):**
- Brain model = **gpt-5.5**, via env `NETJARVIS_BRAIN_MODEL` (default `"gpt-5.5"`); swappable to gpt-5.4 / gpt-5.5-pro with no rebuild.
- Full solution: ① command-forming brain + ② read-only verb guard (Cisco legit-reads) + ③ eval harness.
- Verified: `GET /dna/intent/api/v1/network-device-poller/cli/legit-reads` returns **28 read-only verb keywords** (show, sh, ping, traceroute, dir, more, grep, …) — a read-only ALLOW-LIST, not a full syntax grammar. So it guards read-only; command *correctness* rests on the strong brain + the device rejecting bad syntax (measured by the eval harness).
- Safe default (logged): voice keeps its action tools (delegate, export, ticket, note, precheck); ALL read/factual/command questions go through the one grounded tool. "One brain" = the brain owns facts+commands; actions stay tools.

**Global constraints:** real data only; read-only forever (per-platform policy + legit-reads verb guard); no per-case command maps; secrets from env; `.cjs`, runs under `node --test`. Conservative-and-proceed; log deviations in `implementation-notes.md`.

---

### Task E1: Command-former (strong brain: intent → exact IOS show command)
**Create** `electron/core/command-former.cjs`; **Test** `test/command-former.test.cjs`.
`createCommandFormer({ chat, model, legitVerbs })` → `async formCommand(question, device) → { ok:true, commands:[...] } | { ok:false, error }`.
- `chat(messages, opts)` is an injected chat-completion fn (real = `agents.chatCompletion`, tests inject a fake). `model` from `process.env.NETJARVIS_BRAIN_MODEL || "gpt-5.5"`.
- Prompt: "You are a Cisco IOS-XE expert. Given the engineer's INTENT and the device platform, output ONLY the exact read-only `show` command(s) that answer it — as a JSON array of strings. Never echo the user's sentence; never a non-`show` command." Force JSON output.
- Validate each returned command: first word ∈ `legitVerbs` (read-only) AND passes the existing `read-only-policy.assertReadOnly`. Drop/replace invalid; if none valid → `{ok:false}`.
**TDD:** inject a fake `chat` returning `["show mac address-table"]` for a mac question → ok, commands=["show mac address-table"]; a fake returning the raw sentence "show me the mac..." → validated out (not a real verb-only... actually starts with show → the guard must reject natural-language: require the command to match a tight `^(show|sh)\s+[\w .|/-]+$` shape AND be in legitVerbs). Test: raw-sentence input rejected; clean command accepted; a `configure`-style output rejected.

### Task E2: legit-reads verb guard
**Modify** `electron/sources/catalyst-center.cjs` — add `getLegitReads()` returning the cached array of allowed command verbs (GET the endpoint; cache ~1h; on failure fall back to `["show","sh"]`). **Test** with injected `api` fake. Export it.

### Task E3: Wire the brain into grounding.ask (no more need_command)
**Modify** `electron/core/grounding.cjs` + `electron/tools.cjs`.
- `createGrounding` gains `commandFormer` (from E1, built in tools.cjs with real `chatCompletion` + `getLegitReads` verbs).
- In `ask`: for a non-fact question (composeFact matched:false), STOP returning `need_command`. Instead call `commandFormer.formCommand(question, device)`; if ok → run those commands via `queryLayer.run(device.name, commands)` → `answerKind:'output'`; if not ok → honest `{status:'cannot_form', message}`.
- `ask_network` tool: `commands` arg becomes optional/ignored-from-caller (the engine forms them); keep accepting the model's `question`+`target_phrase` only.
**Test** (grounding + integration, injected fakes): "mac address table on sw1" now yields answerKind:'output' having run `show mac address-table` (the engine formed it), NOT need_command; the caller supplied no commands.

### Task E4: Answer composer for output (brain summarizes real output, grounded)
**Modify** `electron/core/grounding.cjs` (or a small `answer-composer.cjs`).
- After running commands, call the brain to compose a short spoken sentence from the REAL output, with a hard instruction: "state only what appears in this output; invent no number." Return `{answerKind:'output', sentence, rawOutput}`.
**Test:** injected chat returns a summary; assert the composed sentence is used and rawOutput retained. (Grounding on real output; brain only re-words.)

### Task E5: Simplify the mouths (voice + chat personas)
**Modify** `electron/tools.cjs` JARVIS_INSTRUCTIONS + `electron/answer-policy.cjs`.
- Rewrite the grounded section: for ANY question about a specific device/target, call `ask_network` with the user's VERBATIM words as target_phrase + question — **do NOT form or pass commands; the engine forms the command.** Speak only what it returns. (Voice keeps action tools; questions go to ask_network.) Remove the old "decide the right show command" instruction.
- No unit test (prompt); `npm test`+typecheck stay green; verify ask_network still in toolSpecs.

### Task E6: Eval harness (measure "strongest")
**Create** `scripts/eval-grounded.cjs` + `test/eval-set.json`.
- `eval-set.json`: replayable questions with expected shape, seeded from real tests: version/ip/uptime facts; "mac address table"→expect a `show mac address-table` run + table output; "vlans"→`show vlan brief`; "ip route"→`show ip route`; "arp"→`show ip arp`; "interfaces status"; "switch 99"→not_found; anaphora "its uptime".
- `scripts/eval-grounded.cjs`: runs each through the grounding engine with an injected/deterministic brain (or live if creds), scores: device correct? command-shape correct? not_found honest? Prints a pass/score summary. Add `npm run eval` script.
**Test:** a small `test/eval-harness.test.cjs` that the harness runs and scores a couple of seeded cases deterministically.

---
## Notes
- Latency: brain call adds ~1-2s; the two-beat hedge (voice) covers it; fact fast-lane (E-none, already shipped) skips it for simple facts.
- Keep every existing test green; `npm test` + `npm run typecheck` before each commit.
- Read-only enforced twice: legit-reads verb guard (E2) + assertReadOnly (shipped) + queryLayer.
</content>
