# Rollback guide

If a deployment looks worse after a UI or behavior change, you can return to the last known-good state.

## Voice path (reverted 2026-07-04)

Voice + HUD + orb restored to **direct Realtime** behavior (commit `9d00b7a` baseline).
The experimental **voice router** (transcribe → handleUserMessage → TTS) was reverted — it caused slowness and broke HUD/orb sync.

**Chat** still uses the unified message router (classifier → planner → skills → audit). That path is unchanged.

To roll back voice only:
```bash
git checkout 9d00b7a -- src/lib/realtime.ts src/components/Hud.tsx src/components/NetworkCore.tsx electron/realtime-token.cjs
```

## Current rollback point (before enterprise layers)

**Git tag:** `rollback-pre-enterprise-layers`  
**Commit:** `9d00b7a` — *Unified message core: router, answer policy, single entry point*

### Roll back to pre-unified-core (device fact patches only)

**Git tag:** `rollback-pre-unified-core`  
**Commit:** `bd2ae92` — *Fix chat: direct device facts, no duplicate replies*

### Roll back on the server

```bash
cd /path/to/netjarvis
git fetch origin
git checkout rollback-pre-enterprise-layers
# or: git checkout 9d00b7a
npm run build
# restart web server (Ctrl+C then npm run web)
```

### Roll back only the enterprise layer (keep unified core)

```bash
git checkout rollback-pre-enterprise-layers
npm run build
# restart web server
```

## What the enterprise layer includes

- Action planner (`planAction`) between classifier and orchestrator
- Skill registry (`electron/skills/*`) — pluggable intent handlers
- Session + audit store (`data/sessions/*.jsonl`)
- Voice ingress through `handleUserMessage` (Realtime = audio + transcription only)
- Guardrails on CLI (`run_show_command` read-only enforcement)
- Degradation when OpenAI quota fails (automation still works)
- APIs: `GET /api/sessions`, `GET /api/sessions/:id/turns`, `GET /api/skills`

## After rollback

Hard-refresh the browser: `Ctrl+Shift+R` on your Cloudflare URL.
