# NetJarvis enterprise UI — design spec

> Owner ask (2 Sep 2026): "Polish this app from a frontend and every page perspective … it looks
> like a skeleton rather than an enterprise application. I want the experience Cisco and other
> networking vendors build for enterprise-level applications." Process: pick up → plan → spec →
> prototype → build → ship. This document is the plan and the spec; `docs/mocks/netjarvis-enterprise-mock.html`
> is the prototype; the `src/` changes on the same branch are the build.

## 1. Diagnosis of the current UI

| Problem | Where | Effect |
|---|---|---|
| Half the screen is a decorative orb on black | `App.tsx` `.companion-window` (50vw) | Content lives in a cramped right half; the product reads as a demo toy |
| Single mint accent (`#6ef2be`) on near-black, low-contrast grays | `styles.css :root` | "Hacker terminal" look, weak hierarchy, hard to read dense data |
| No global navigation or page model | `ArtifactPanel.tsx` 4 pill tabs | No sense of place; features (investigations, sources) have no home |
| Cards without structure, lists instead of tables | `OpsDashboard`, `ArtifactsPanel` | Enterprise data (devices, links, artifacts) is rendered as text rows |
| 5,300-line stylesheet, ~650 selectors for ~300 used classes | `styles.css` | Drift, dead rules, no token discipline, no theming |
| Transparent/desktop-only chrome (drag strips) leaking into web mode | `.window-drag-*` | Odd hit-zones and gaps in the browser build |

## 2. Design direction

Model the experience on how Cisco (Catalyst Center, Meraki, ThousandEyes, Webex Control Hub) and
peers (Arista CloudVision, Juniper Mist, Splunk) build operations consoles:

1. **Application shell first.** A persistent navy top bar (product identity, environment/source
   badge, global "ask" command bar, assistant + voice state, theme), a left navigation rail with
   pages, a page header with title/subtitle/actions, and a scrolling content area. The assistant is
   a right-side drawer, not the main stage.
2. **Light, neutral, high-contrast by default; dark theme as a first-class option.** Cool-gray
   surfaces, one interactive blue, Cisco-sky highlights, semantic status colors that mean the same
   thing everywhere (green healthy, amber degraded/warning, red critical, blue informational, gray
   unknown/unconfigured).
3. **Data is shown as data.** Real tables with sticky headers, right-aligned numerics with tabular
   figures, status pills, KPI tiles with units and deltas, dense but breathable 8-px rhythm.
4. **Calm motion.** Only state changes animate (orb mood, live pulses, typing). No ambient scan
   lines, no glow.
5. **Honesty is a UI element.** Source mode (LIVE / UNREACHABLE), FIXTURE banners, and
   "unconfigured" coverage are styled deliberately and consistently — never hidden.
6. **Accessibility.** WCAG AA contrast on both themes, visible focus rings, keyboard reachable nav,
   `aria-current`, labelled icon buttons, reduced-motion respect.

## 3. Information architecture

```
Top bar      NetJarvis · Network Operations | [ Ask NetJarvis… ] | LIVE Catalyst Center | Voice ● | Assistant | Theme
Nav rail     Overview | Investigations | Agent Squad | Observability | Reports
Main         Page header (title, subtitle, actions) + content
Drawer       Assistant: orb (compact), state, transcript, composer, mic
```

| Page | Purpose | Data source (unchanged backend) |
|---|---|---|
| **Overview** | NOC landing: source status, health score, KPI tiles, device table, active issues, links, recent events, session log | `getDashboard()` (30s poll + manual refresh) |
| **Investigations** | Cross-platform investigation console: seed form (user/ip/host, window, platforms) → summary, coverage grid, observations, timeline table, pivots (click to re-investigate), gaps; history of past investigations | `executeTool({name:"investigate"})`, `listArtifacts()` |
| **Agent Squad** | Roster (org chart + live delegation), Kanban board, squad chat (Slack-style, expandable) | `getOrg()`, `getTasks()`, `sendChatMessage()` |
| **Observability** | Current output (behind-the-scenes / CLI / narrative, mermaid now rendered), recent tool activity, session audit trail | in-memory events, `listSessions()` |
| **Reports** | Artifact library as a data table with search, download | `listArtifacts()` |
| **Assistant drawer** | Voice connect/disconnect, live state, last heard / speaking, transcript, typed prompt | `JarvisRealtimeClient`, `sendChatMessage()` |

Removed: the 50/50 "companion window", the fullscreen "Full NOC" mode (Overview is already full
width), `FloatingConsole`, the dead artifact renderers in `ArtifactPanel.tsx` (mermaid rendering
moves into Observability, closing KNOWN-ISSUES #6).

## 4. Design tokens (`src/styles/tokens.css`)

```
Brand        --brand-900 #0b2340  (top bar, midnight navy)   --brand-700 #10345f
             --brand-500 #1b6ec2  (interactive)              --brand-400 #049fd9 (Cisco sky highlight)
             --brand-100 #e3f1fb  --brand-50 #f2f8fd
Neutrals     --n-0 #ffffff  --n-50 #f5f7fa  --n-100 #eef1f5  --n-200 #dfe4ea  --n-300 #c5ccd6
             --n-400 #9aa5b4  --n-500 #6b7684  --n-700 #3f4854  --n-800 #262d36  --n-900 #171c23
Status       success #1f7a3a / bg #e6f4ea   warning #9a5b00 / bg #fff4dd
             danger  #c8161d / bg #fde9ea   info #1b6ec2 / bg #e3f1fb   neutral #6b7684 / bg #eef1f5
Semantic     --bg-app, --bg-surface, --bg-surface-2, --bg-inset, --border, --border-strong,
             --text, --text-2, --text-3, --link, --focus
Type         Inter → system; 12/13/14/16/20/24; tabular-nums for KPIs; mono: ui-monospace
Space        4-px base: --s-1 4, --s-2 8, --s-3 12, --s-4 16, --s-5 20, --s-6 24, --s-8 32
Radius       --r-1 4, --r-2 6, --r-3 10 ; Shadow --sh-1 (card), --sh-2 (popover)
```

Dark theme (`[data-theme="dark"]`) re-maps the semantic layer only (surfaces #0f151d / #151c26 /
#1b2330, borders rgba(255,255,255,.08/.14), text #e6ebf2 / #a8b3c2 / #7c8796) and keeps status
hues legible (lighter foregrounds, translucent backgrounds). Theme persists in `localStorage`
(`netjarvis.theme`) and defaults to the OS preference.

## 5. Component library (CSS classes, no new dependencies)

`ui-btn` (primary / secondary / ghost / danger, sizes sm/md), `ui-input`, `ui-select`, `ui-card`
(+ `ui-card-head`, `ui-card-body`, `ui-card-foot`), `ui-badge` (status variants), `status-pill`
(healthy/ok, warning, critical, info, neutral, live, unreachable, fixture), `kpi` tile, `data-table`
(sticky head, zebra off, hover, numeric alignment, `is-selected`), `ui-tabs`, `ui-toolbar`,
`ui-empty` (empty state with icon + copy), `ui-banner` (info/warning/danger/fixture), `ui-drawer`,
`ui-popover`, `ui-modal`. Existing component class names (`noc-*`, `agent-*`, `kanban-*`,
`squad-chat-*`, `observability-*`, `artifacts-*`, `cli-output-*`, `md-*`, `netcore/nc-*`, `hud-*`)
are kept so the React components change minimally; their CSS is rewritten against the tokens.

## 6. Page specifications

### 6.1 Overview
- Page header: "Network Overview" + subtitle "Cisco Catalyst Center · sandboxdnac.cisco.com" +
  actions [Refresh] [Ask NetJarvis].
- Status strip: LIVE/UNREACHABLE pill, overall health word (healthy/watch/degraded), health score
  ring, last update, auto-refresh note.
- KPI tiles (6): Devices, Healthy, Issues (danger when >0), Links up (x/y), Events (12h), Health score.
- Two-column grid (≥1280px): **Devices** data table (Name, Role, Mgmt IP, Platform, Status pill,
  Health, CPU, Memory, Uptime) | **Active issues** card (priority pill, name, status) with green empty
  state. Below: **Links** table (A, A-port, B, B-port, status) and **Recent events** (time, severity
  dot, device, text), **Session log** collapsed by default.
- Unreachable state: red banner with the error and a retry note; tables render empty states, never
  fabricated rows.

### 6.2 Investigations
- Page header: "Investigations" + subtitle "Correlate VPN, proxy, firewall, endpoint, identity,
  cloud and network evidence for one entity" + [New investigation].
- **Seed card**: segmented control User / IP / Host, value input, window select (1h, 6h, 24h, 3d,
  7d, 30d), platform chips (all on by default), Run button (disabled while running; spinner).
- **Result**: summary banner (FIXTURE variant when `fixture:true`), coverage grid (one chip per
  provider/platform: ok=green count, empty=neutral, unconfigured=gray dashed, failed=red with error
  tooltip), observations list, **Timeline** table (Time UTC, Platform pill, Severity pill, Event,
  Who/where, Provider) with platform + severity filters and row count, **Related entities** table
  with an "Investigate" action per row (re-seeds the form and runs), **Gaps** list, link "Open full
  report" → Observability with the artifact.
- **History** card: last 20 `investigate` artifacts (title, time, download).

### 6.3 Agent Squad
- Three columns: roster card (org chart with live state dots, handoff callout, live delegation
  list), Kanban (Queued / In progress / Done with counts; cards with team badge, title, meta,
  actions), chat rail (channel header, feed, composer). Expand chat → chat takes the whole page with
  channel sidebar; Esc collapses.

### 6.4 Observability
- Current output card (kind badge, title, split: behind-the-scenes / CLI-or-technical / narrative;
  `mermaid` kind renders an SVG diagram), actions (Copy all, Copy email, Download).
- Recent tool activity list with running/done/error status; Session audit trail table (time,
  intent, skill, latency, tools).

### 6.5 Reports
- Toolbar (search, count) + data table (Title, Kind badge, Team, Tool, Created, Download). Empty
  state copy. "Load more" keeps existing paging.

### 6.6 Assistant drawer
- Header: compact orb (mood-colored ring) + state label + connection pill; [Connect voice / Stop].
- Body: live state row (You said / Jarvis), transcript list (role-tinted rows), typed composer
  (Enter to send) that goes through the same `deliverUserMessage`.
- Opening an artifact from a voice tool keeps the current page; a toast-like "New output" chip in
  the top bar links to Observability (replaces the old auto-tab-switch that yanked the user around).

## 7. Non-goals for this iteration
- No backend or `window.jarvis` surface changes (all pages use existing methods).
- No charting library; the health ring is CSS. No component framework.
- No settings/user management page (no auth exists yet).

## 8. Verification
- `npm run typecheck`, `npm run build`, `npm test` (backend unchanged).
- Browser walkthrough of every page in light and dark theme; investigation run against the mock
  lab; voice controls untouched (no key in this environment).
- Contrast spot-checks on pills/badges against both themes.
