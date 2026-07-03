# Rollback guide

If a deployment looks worse after a UI or behavior change, you can return to the last known-good state.

## Current rollback point (before UI polish pass)

**Git tag:** `rollback-pre-ui-polish`  
**Commit:** `c238b1d` — *Make voice HUD live: streaming speech, full text, tool feed*

### Roll back on the server

```bash
cd /path/to/netjarvis
git fetch origin
git checkout rollback-pre-ui-polish
# or: git checkout c238b1d
npm run build
# restart web server (Ctrl+C then npm run web)
```

### Roll back only the UI polish commit (keep later fixes)

```bash
git revert d35ad64 --no-edit
npm run build
# restart web server
```

## What the rollback point includes

- Agent Squad chat with CLI table output and pre-check fast path
- Voice HUD with live speech streaming and activity feed
- No auto-switch to Observability on squad chat
- CLI quota fallback (returns output even if AI summary fails)

## After rollback

Hard-refresh the browser: `Ctrl+Shift+R` on your Cloudflare URL.
