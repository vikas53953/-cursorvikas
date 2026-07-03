# NetJarvis

NetJarvis is a local Electron desktop AI copilot for network operations, inspired by [RileyJarvis](https://github.com/rbrown101010/rileyjarvis). You talk to it like a NOC colleague — over realtime voice — while a live **network operations dashboard** sits on the right side of the window. Jarvis on the left, the network on the right.

It runs against a **real network out of the box**: the [Cisco DevNet Catalyst Center Always-On sandbox](https://sandboxdnac.cisco.com), a public four-switch Catalyst 9000v network (`sw1`–`sw4`) managed by Catalyst Center. No VPN or account is needed. When that source is unreachable, NetJarvis falls back to a built-in simulated service-provider network so nothing breaks.

Network operations here means **any layer, L1–L7** — not just routing protocols. In live mode NetJarvis can run any read-only `show` command on the actual switches through the Catalyst Center Command Runner: VLANs, MAC address tables, spanning tree, CDP neighbors, ARP, routing tables, interface counters and errors, logs, versions, CPU processes, and more.

Built with Electron, React, Vite, TypeScript, and the OpenAI Realtime API.

## What you can ask

Start of shift:

- "How is my network doing?" / "Give me the rundown."
- "Anything happen overnight?"

Inventory and health:

- "What devices do we have?"
- "How is sw1 doing?" / "Any devices unreachable?"
- "Any interfaces down?" / "Interface report for sw2."

Layer 2:

- "What VLANs are configured?"
- "Show me the MAC address table on sw1."
- "What's the spanning tree state?" / "Who are sw3's CDP neighbors?"

Layer 3:

- "Show me the routing table on sw1." / "Show the ARP table."
- "Any OSPF neighbors?" / "Is BGP running anywhere?"

Traffic, errors, logs:

- "Any drops or errors on the interfaces?"
- "Show interface counters on sw2."
- "Show me the last 20 log lines on sw1."

Security:

- "Any vulnerabilities on these switches?" — reads the devices' real software version and queries the NVD CVE database (no API key needed).

Team delegation (multi-agent):

- "Hand this to the data team: full spanning tree health check."
- "Ask the incident agent to triage the current alerts."
- Specialist agents (data, firewall, load balancer, proxy, incident ops, problem management) investigate with their own tool runs; every handoff is visible on the **Team Board** Kanban tab (queued → in progress → done), with per-step detail and copy-as-email on each card.

Pre-checks and comparisons:

- "Run a pre-check labeled pre-maintenance." → snapshots device health, all interfaces, and error counters.
- "Run a post-check and compare." → exact diff: reachability/health changes, interface status/VLAN/IP changes, error-counter increases.

Exports:

- "Put this in Excel/CSV" → the Reports panel shows the table with a **Download CSV** button; every report also has **Copy** and **Copy email** buttons.

Big picture:

- "Show me the status board." (the right-hand dashboard shows this continuously)
- "Show me the network topology."

Extras: Exa web search for vendor advisories and outage news, and local shift/handoff notes.

## The window

- **Left:** the NetJarvis network-core avatar — a status ring and topology graph that shows state at a glance (cyan pulse = listening, amber rotation = thinking, waveform = speaking, packets in flight = running tools, red = error). Below it, a HUD shows the exact state, what Jarvis heard, and which command is running right now. A floating mini-HUD keeps this visible even when the panel is fullscreen.
- **Right:** the operations panel with three tabs:
  - **Dashboard** — always-on view of the network: LIVE/SIM source badge, health score, device tiles with CPU/memory/health, link status, active issues, the live session log (who said what, which tools ran), and recent network events. Auto-refreshes every 30 seconds.
  - **Team Board** — Kanban view of every task NetJarvis delegated to its specialist agents, updating live as agents work.
  - **Reports** — artifacts produced by Jarvis: overviews, tables, raw CLI output, mermaid topology diagrams, and notes, each with Copy / Copy email / Download buttons. Opens automatically when a tool produces something.

## Architecture

- `electron/sources/catalyst-center.cjs` — Catalyst Center Intent API adapter: auth token management, inventory, device/network health, physical topology, per-device interfaces, issues, events, and the Command Runner (read-only CLI on real devices).
- `electron/network-source.cjs` — source facade. Picks live vs simulator (`NETJARVIS_SOURCE=auto|live|sim`), normalizes both into the same JSON shapes, and builds the dashboard snapshot.
- `electron/network-data.cjs` — the deterministic simulator (dual-site SP-style network with injected overnight incidents). Used as fallback and for offline demos.
- `electron/tools.cjs` — the voice model's tools (overview, inventory, device health, interfaces, `run_show_command`, topology, alerts, events, protocol/traffic/drop reports, notes, search) plus the NetJarvis persona. No Electron dependency, so it is testable with plain node.
- `electron/main.cjs` — window, IPC, Realtime session token minting.
- `src/` — React UI: face with lip-sync, live log, dashboard, and reports panel.

Only `run_show_command` touches device CLI, and it hard-rejects anything that is not a `show` command.

## Requirements

- Node.js 20+
- npm
- An OpenAI API key with Realtime access (for voice)
- Optional: an Exa API key for web search
- Internet access to `sandboxdnac.cisco.com` for live mode (falls back to the simulator otherwise)

## Quick Start

```bash
git clone <this repo>
cd netjarvis
npm install
cp .env.example .env.local
npm run dev          # Electron desktop app
```

Or run it as a plain web app in any browser (no Electron needed):

```bash
npm run build
npm run web          # serves http://localhost:8080
```

Web mode serves the same UI and exposes the same tools over an HTTP API; realtime voice audio still flows directly between the browser and OpenAI over WebRTC (the server only mints the short-lived client secret). Use HTTPS or localhost so the browser allows microphone access.

Edit `.env.local` before starting voice features:

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

The dashboard and all network tools work without any keys — only voice needs `OPENAI_API_KEY`, and only web search needs `EXA_API_KEY`.

## Debug logs (evidence trail)

Everything of interest is written as structured JSONL to `data/logs/netjarvis-YYYY-MM-DD.jsonl`:

- every tool call with arguments, duration, and result status (`tool.execute`)
- every Catalyst Center API request with status, latency, and size (`catc.http`)
- realtime voice session events forwarded from the client: connects, speech transcripts, model replies, tool calls, and errors (`client.rt.*`)
- realtime token mints and web requests

In web mode, `GET /api/logs/recent?limit=200` returns the latest entries. Secrets are redacted before anything is written.

## Pointing at other networks

- **Your own Catalyst Center:** set `CATC_BASE_URL`, `CATC_USERNAME`, `CATC_PASSWORD` in `.env.local`.
- **Cisco DevNet IOS XE always-on routers (Cat8k/Cat9k):** these now issue per-session dynamic credentials — log in at [devnetsandbox.cisco.com](https://devnetsandbox.cisco.com), launch the sandbox, and a RESTCONF adapter can be added alongside the Catalyst Center one (`electron/sources/` is built for multiple adapters).
- **Anything else (SNMP, gNMI, Prometheus, NetBox):** implement the same function contracts in a new adapter and register it in `electron/network-source.cjs`.

## Development

```bash
npm run dev        # Vite on 127.0.0.1:5173 + Electron
npm run typecheck
npm run build
npm start
```

## Runtime Data

The app creates a local `data/` directory for shift notes and acknowledged-alert state. That directory is intentionally ignored by Git.

Do not commit: `.env.local`, anything under `data/`, `dist/`, `node_modules/`.

## Security Notes

- API keys are loaded only from local environment files; `.env.*` files are git-ignored except `.env.example`.
- The DevNet sandbox uses a self-signed TLS certificate; verification is disabled only for the Catalyst Center adapter. Do not point it at untrusted hosts with real credentials.
- Device CLI access is restricted to read-only `show` commands; configuration changes are rejected before any API call.
- State-changing actions (like acknowledging alerts) require explicit voice confirmation.

## License

MIT
