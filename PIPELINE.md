# PIPELINE — NetJarvis Grounded Answers (voice + chat)   updated: 2026-07-04

| # | Stage         | Status                          | Artifact |
|---|---------------|---------------------------------|----------|
| 1 | Unknowns      | done (3 answers locked)         | PIPELINE.md |
| 2 | Requirements  | APPROVED by Vikas 2026-07-04 (autonomous build authorized) | docs/plans/2026-07-04-001-feature-grounded-answers-plan.md |
| 3 | UX mock       | skipped (behavior change; minimal UI) | — |
| 4 | Architecture & plan | done                      | docs/superpowers/plans/2026-07-04-grounded-answers-impl.md |
| 5 | Build         | DONE — G1–G6, 93/93 tests, typecheck clean | branch grounded-answers |
| 6 | Code review   | DONE — SME (opus) found 1 Critical + 2 Important; all fixed + regression-tested | a11ade6 |
| 7 | Browser QA    | PARTIAL — unit/integration + composeFact spot-check verified; live chat browser-QA + voice = Vikas AM | — |
| 8 | Ship          | DONE — merged to main (447af07) + pushed to GitHub; morning page + deploy command prepared | main |
| 9 | Learn         | pending (ce-compound after Vikas confirms)      | — |

## AUTONOMOUS BUILD MODE (Vikas away — sleep + travel, authorized 2026-07-04 ~22:50 IST)
- Gate 1 (requirements) + Gate 3 (green light) collapsed into one approval — Vikas authorized full autonomous build.
- Speed: don't fixate on exact numbers — correct + honest first, keep responsive; report actual latency.
- Forks: take the SAFE/conservative option and proceed on everything; log each in implementation-notes.md; Vikas reviews all in the morning.
- Handoff: build + unit-test + code-review + browser-QA the CHAT path + push to GitHub; prepare a visual "what I built & how to test" page + a one-paste Cursor deploy command. Voice spoken-UX (hedge timing, orb) = Vikas confirms in the morning (can't mic-test overnight).
- Honesty law: morning page uses a plan-vs-built audit (DONE / PARTIAL / NOT DONE / UNVERIFIABLE) with real evidence — no completion claims without fresh test output.
- **Expert-team directive (Vikas, ~23:15 IST):** build via expert agents (each a specialist), a senior SME agent reviews all code, then **merge grounded-answers → main and git push** (push AUTHORIZED). Vikas reviews + tests in the morning.
- **HUD track:** mock built + published (https://claude.ai/code/artifact/68317326-17bd-4944-bbd6-0a3436e167c4). Wiring into the live app is GATED on Vikas approving the look in the morning (mock-before-wire; do not re-skin the live app blind). Camera/gesture slot → network-native fabric panel (his choice).

## Decision so far (panel + Fable-5, APPROVED by Vikas 2026-07-04)
Adopt the **"AI quotes you, the engine owns every fact"** contract:
- One grounded tool, e.g. `ask_network(target_phrase, question)`.
- The AI passes the user's **verbatim** words (never its own paraphrase); the engine resolves the phrase → real device (found / ambiguous / not-found), runs the read-only command, and **composes the exact answer sentence**; the AI only voices it.
- Wrapped in a **two-beat** hedge ("let me check sw1…") so the talking-orb never stalls (this is why it won't repeat the July-4 revert — voice stays the surface, engine is a mid-turn tool).
- One rule replaces 100k: *the AI may never state a network fact it didn't get from the engine.*
- O5 (honest no / confidence ladder) = the engine's return types, not a separate build. O4 (second-checker) = telemetry-first, activate only if logs show drift. O2 (pre-flight sheet) = skipped.
- Reuses the Phase 1 engine (`electron/core/query-layer.cjs`, `scope-resolver.cjs`) already shipped.

## Stage 1 answers (Vikas)
- Q1 SCOPE → **B: all read questions.** Single facts → exact engine-written sentence; tables/lists/summaries → engine hands a verified facts block the AI may only re-word, never add/alter a number. (Fix the class, not the case.)

- Q2 CHANNELS → **B: voice + chat both.** Grounding built once, both consume it; orchestration stays split.

- Q3 AMBIGUOUS → **B: read back best guess and proceed** (always says which device; barge-in to correct). Ask only on a true toss-up it can't rank.

Stage 1 complete — no open architecture questions remain. Latency/measurable bars to be proposed in requirements and confirmed at Gate 1.

## Deviations
—
</content>
