# Implementation notes — Grounded Answers (autonomous build)

Conservative-option-and-proceed log (Vikas away; he reviews all in the morning).

## Deviations / decisions taken alone
- **Device enrichment (G2):** the normalized `Device` from scope-resolver lacks softwareVersion/uptime/serial/cpu/memory. Safe option: G2's grounding takes an injected `getDeviceFacts(name)` that merges the fuller Catalyst Center inventory row (getInventoryCached) + device-health, so `composeFact` can resolve. Unit tests inject a fake. Wired to real catc in G3.
- **Pronoun detection (G2):** the plan's literal wording ("bare pronoun: it/its/that/this") only covers an exact-match phrase like `"it"`. But the plan's own TDD case requires `targetPhrase:'its uptime'` to also resolve via `session.lastDevice`. Safe option taken: treat the phrase as pronoun-led (and substitute `session.lastDevice`) when its **leading word** is one of `it/its/that/this`, not just when the whole phrase is a bare pronoun. This satisfies both the rule text and the required test case without introducing per-case hacks — it's still one general rule (first-token check), no hardcoded phrases.

## Plan-vs-built audit (filled during build)
- G1 single-fact composer — DONE (431b9db, 60/60, typecheck clean)
- G2 grounding capability — DONE (see commit below; 69/69 tests, typecheck clean)
- G3 ask_network tool — pending
- G4 voice persona — pending
- G5 chat persona — pending
- G6 fact telemetry — pending
</content>
