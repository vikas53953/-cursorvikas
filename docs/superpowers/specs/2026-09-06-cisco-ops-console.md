# NetJarvis Cisco-class ops console

Date: 2026-09-06
Status: implemented

## Why

The previous UI was a two-pane companion (orb + tabs). It did not read as a
network operations product. Abstract metaphors (journal, chart room) were
rejected. The target is the product language of **Cisco Catalyst Center
Assurance**, **Cisco ThousandEyes Views**, and a **SOC investigation
workspace** — not a copy of those products, and not a Cisco-branded skin.

## Product language we take

From **Catalyst Center / DNA Center Assurance**
- Dark navy application rail + light gray canvas + white dashlets
- Health score (0–10) as a donut, not a neon KPI
- Network snapshot: devices, issues, links, events as tables
- Topology map of real inventory + links
- Time window and source badge always in the chrome
- Severity as green / amber / red, never decorative gradients

From **ThousandEyes**
- Hop-by-hop **path visualization** as the investigation hero
- Each hop is a platform (identity → VPN → firewall → proxy → endpoint → campus → cloud → SIEM)
- Connector color = worst severity seen on that hop (or gray if unconfigured / empty)
- Views-style filter chips and a time-ordered event table under the path

From **SOC consoles (SecureX / XDR-class)**
- First-class Investigate workspace
- Coverage grid that is honest about unconfigured / failed / empty sources
- Related-entity pivots (re-run with that seed)
- Fixture data labelled, never presented as live

## Information architecture

| Rail item | Page | Data |
|---|---|---|
| Voice | Full orb; conversation hides while connected | Realtime voice + typed ask |
| Assurance | NOC home | `getDashboard()` — refreshes when a tool runs, and every 30s |
| Investigate | Views: seed + window on the path, then events | `executeTool("investigate")` |
| Inventory | Device table + L2 topology | dashboard devices + links |
| Squad | Kanban + roster + squad chat | existing TeamBoard |
| Work | Current tool output + download library | ObservabilityPanel + ArtifactsPanel |
| Settings (gear on the signed-in row) | Full page: General, Profile, Appearance, Network, Jump | local prefs; source status |

The visible product name defaults to **Vigil**. **NetJarvis** is the assistant
name and lives under Settings, not as a cheap lockup on the rail. Appearance is
a Kiro-style gallery (Auto / Light / Dark, palette intensity, named themes)
so rail and top bar share one chrome. Active nav is a filled row — no inset
accent bar. Operator can follow the console name. The rail is collapsible
from the collapse control at the top of the rail. Search is a visible row
under the brand. Settings is only the gear on the signed-in operator row;
the gear opens a full Settings page (Back, Search Settings, category list,
row controls) instead of a dump inside the ops rail.
A command palette (opened from Search, Search Settings, or Settings → Jump)
goes to a page, device, user, or IP — it is not labelled with a shortcut.
Search Settings filters real setting rows (Cursor-style), then Enter jumps to
the matching row. First session asks for a name and palette, then lands on Voice.
Density is Comfortable or Compact (compact is a 12-hour seat: tighter tables,
rail, and chrome). Rail collapse animates 150ms without snapping the canvas.
The top bar holds one status strip: source, window, operator. Voice connected is
a quiet stage (conversation column closed). Source Unreachable / Live / Fixture
is shown on Assurance, Inventory, and Settings — not duplicated in the rail footer.

When Catalyst Center is down and `NETJARVIS_SOURCE` is `auto` (default) and
`NETJARVIS_EVIDENCE_FIXTURE` is set, Assurance, Inventory, Investigate, and
`run_show_command` overlay the labelled mock lab (CLI banners say FIXTURE; no
invented health scores or topology links). Forced `NETJARVIS_SOURCE=live` stays
empty if CATC is unreachable. Device names resolve from the live/fixture inventory
(not only `swN`). SNMP reports `ok:false` until a real client exists.

**Voice is a first-class workspace**, not a drawer. The original orb
(`NetworkCore`) fills the Assistant → Voice page: talk or type, tools run,
the conversation stays on the right. A compact orb in the top bar opens Voice
from any page. The two answer paths (Realtime voice vs chat pipeline) are
unchanged.

## Honesty rules (unchanged)

- No fabricated devices, events, or health.
- Unreachable Catalyst Center renders empty + badge, not fake scores.
- Mock-lab investigations show a FIXTURE banner.
- `run_show_command` in fixture mode returns labelled mock CLI. Live-only tools
  still fail honestly when CATC is down and the mock lab is off.

## Out of scope

- Cisco wordmark, Cisco Sans, or DNA Center trademarks
- Re-merging voice into the chat router
- New backends
