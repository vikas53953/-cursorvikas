# NetJarvis

NetJarvis is a local Electron desktop AI copilot for network operations, inspired by [RileyJarvis](https://github.com/rbrown101010/rileyjarvis). You talk to it like a NOC colleague — over realtime voice — and it answers from live network state through tools: shift briefings, BGP and OSPF status, device health, interface errors, traffic anomalies, packet drops, alerts, and a topology view.

It is built with Electron, React, Vite, TypeScript, and the OpenAI Realtime API.

## What you can ask

Start of shift:

- "How is my network doing?"
- "Give me the overnight rundown."
- "Anything happen overnight?"

Routing protocols:

- "How is BGP doing?" / "BGP status on EDGE-R3."
- "Any BGP flaps last night?"
- "What's the OSPF status? Are all adjacencies up?"

Devices and interfaces:

- "How are my edge routers?" / "What's the health of EDGE-R2?"
- "Any interfaces with errors?"

Traffic and drops:

- "Any increase in traffic?" / "What are the busiest links?"
- "Any drops reported overnight?"

Alerts, events, and the big picture:

- "What alerts are active?" / "Show me the overnight event log."
- "Acknowledge alert ALM-2483." (NetJarvis asks for confirmation first)
- "Show me the status board." / "Show me the network topology."

Extras:

- Web search with Exa for ISP outage news and vendor advisories.
- Shift notes / handoff notes on a local notes board.

## Features

- Realtime speech-to-speech conversation with OpenAI Realtime (WebRTC), with interruption support.
- Animated companion face with listening, thinking, speaking, and working states.
- Network panel that renders shift briefings (markdown), status tables, a color-coded NOC status board, mermaid topology diagrams, alert detail, and notes.
- Voice-confirmed alert acknowledgement.
- Typed input as a fallback when you cannot talk.

## Network data: simulator now, your network later

All network state comes from one module: `electron/network-data.cjs`. Out of the box it runs a deterministic simulator that models a realistic dual-site network:

- 2 core routers (Cisco 8201), 4 edge routers (Juniper MX304), 2 distribution switches (Nexus 93180), 2 firewalls (PA-5450)
- Dual ISP transit (Lumen AS3356, Arelion AS1299), one IX peering (HE AS6939), iBGP route-reflector mesh, OSPF areas 0 and 1
- Injected "overnight" incidents so shift-start questions have real answers: a recovered BGP flap, an active CRC-error alert, a degraded PSU, and an inbound traffic anomaly

To point NetJarvis at a real network, replace the exported functions in `electron/network-data.cjs` with adapters for your actual sources — SNMP, gNMI/streaming telemetry, Prometheus, NetBox, syslog, or your alert manager. The function contracts are plain JSON, so the tools, the UI, and the voice model do not need to change.

## Requirements

- Node.js 20+
- npm
- An OpenAI API key with Realtime access
- Optional: an Exa API key for web search

## Quick Start

```bash
git clone <this repo>
cd netjarvis
npm install
cp .env.example .env.local
npm run dev
```

Edit `.env.local` before starting voice features:

```bash
OPENAI_API_KEY=your_openai_api_key_here
EXA_API_KEY=your_exa_api_key_here
```

`OPENAI_API_KEY` is required. `EXA_API_KEY` is optional; web search will show a setup message when it is missing.

## Development

```bash
npm run dev
```

This starts Vite on `127.0.0.1:5173` and launches Electron.

Other useful commands:

```bash
npm run typecheck
npm run build
npm start
```

## Runtime Data

The app creates a local `data/` directory for shift notes and acknowledged-alert state. That directory is intentionally ignored by Git.

Do not commit:

- `.env.local`
- Anything under `data/`
- `dist/`
- `node_modules/`

## Security Notes

- API keys are loaded only from local environment files.
- `.env.local` and all `.env.*` files are ignored except `.env.example`.
- State-changing actions (like acknowledging alerts) require explicit voice confirmation.

## License

MIT
