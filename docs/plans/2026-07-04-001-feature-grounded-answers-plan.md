---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
---

# Grounded Answers - Plan

## Goal Capsule
- **Objective:** Stop NetJarvis from improvising network facts. For any read/factual question — by voice or chat — the AI must get the facts from the deterministic engine and may **never state a network fact it did not receive from the engine.** One rule replaces ~100,000 per-case rules.
- **Product authority:** Vikas (owner).
- **Open blockers:** none. Reuses the Phase 1 engine already shipped (`electron/core/query-layer.cjs`, `scope-resolver.cjs`).

## Problem
The voice path (OpenAI Realtime) lets the AI decide the command AND phrase the answer with no grounding, so it improvises: answered IP→hostname→version for a single "version?" question, and silently turned "switch 99" (nonexistent) into "VLAN 99 on sw1." Root cause: it answers from assumption, substitutes a different fact/entity, silently defaults, and won't admit uncertainty. Chat's general path has the same weakness.

## Users / actor
A network operations engineer asking questions in plain language, hands-busy (voice) or typing (chat). Expert; values speed and honesty; hates being nagged or handed wrong answers.

## The contract (what it does)
A single grounded flow both channels use:

1. **Quote** — the AI passes the user's **verbatim** target words (e.g. "switch 99") plus the question to a grounding tool. It does not pre-resolve or reinterpret.
2. **Resolve** — the engine matches the phrase against the live inventory → `found` (real device) / `ambiguous` (ranked real candidates) / `not-found`.
3. **Execute** — read-only command(s) run through the Phase 1 query layer (capped, real devices only).
4. **Compose** — the engine returns the answer facts: a single value becomes an exact sentence ("The software version on sw1 is 17.12.1"); a table/list/summary becomes a **verified facts block**.
5. **Voice/write** — the AI speaks or writes it. For voice it leads with a **two-beat hedge** ("let me check sw1…") so the talking-orb never stalls, then states the fact when the engine returns. The AI may add tone/lead-ins but **no facts** beyond what the engine returned.

## Behavior rules (the general laws — no per-case rules)
- **R1 Quote, don't interpret.** The AI passes the user's actual words as the target; it never substitutes its own guess.
- **R2 Engine owns facts.** The AI may not state any network number, name, or status it didn't receive from the engine.
- **R3 Honest by construction.** `not-found` → "there's no switch 99" (offer nearest real names); the AI cannot run a command on an unconfirmed device, so silent defaulting is impossible.
- **R4 Ambiguous → read back and proceed.** State the best-guess device ("checking sw1…") and answer; the engineer barges in to correct. Ask "sw1 or sw12?" only on a genuine toss-up it can't rank.
- **R5 Anaphora is deterministic.** The engine tracks the last confirmed device; "and its uptime?" resolves to that device, not the AI's memory.
- **R6 Two-beat (voice).** The instant hedge commits to zero facts (can't be wrong) and hides the ~1s engine wait; the fact follows. Voice stays the surface, engine is a mid-turn tool — this is why it won't repeat the July-4 revert.

## In scope
- All read/"show"-type questions: device facts, VLAN/MAC/interface/route tables, status, counters, topology, alerts — voice **and** chat.
- Single-fact → engine-written sentence; multi-value → engine-verified facts block the AI may only re-word.

## Out of scope (this feature)
- Config changes — read-only remains a hard boundary.
- **O4 active auto-correct** (cancel-and-restate): built as **silent telemetry first** (log spoken facts vs engine output); activate only if logs prove residual drift.
- **O2 pre-flight fact sheet** — skipped (weaker duplicate of R1–R3).
- Non-network conversation (greetings, concept explanations) — unchanged; the rules govern network FACTS only, not all speech.

## Success criteria (measurable — tested at QA)
- **S1 No fabrication:** 100% of spoken/written network facts trace to engine output (measured via O4 telemetry over a test script).
- **S2 Honest unknowns:** a nonexistent device ("switch 99") yields an explicit "no such device" 100% of the time — never a silent default or a substituted entity.
- **S3 Right fact first try:** a single-fact question ("version on sw1") returns that exact fact on the first answer (no IP/hostname detour).
- **S4 Voice responsiveness:** first spoken word (hedge) begins **≤ 1.0s** after the user stops speaking; the orb keeps animating throughout (never a dead pause while thinking).
- **S5 Answer latency:** a single read-only command answer completes **≤ 3.5s** total on the sandbox (command runtime ~2s); longer multi-command answers hold with a "still checking" filler rather than guessing.

## Decided (stage 1, Vikas 2026-07-04)
- **Q1 scope → all read questions** (single fact = exact sentence; multi = verified block).
- **Q2 channels → voice + chat both** (grounding built once; orchestration stays split).
- **Q3 ambiguous → read back best guess and proceed** (ask only on a true toss-up).

## Assumptions (verify in planning)
- The engine can extract single-fact answers (version, IP, uptime, etc.) from existing tool/command output well enough to compose an exact sentence — assumption, confirm in planning.
- The Realtime voice path exposes the user's transcript so the AI can pass verbatim words as the target — assumption, confirm against `src/lib/realtime.ts`.

## Outstanding questions
- Exact latency filler wording and the toss-up threshold for R4 — tuning, defer to build/QA.
</content>
