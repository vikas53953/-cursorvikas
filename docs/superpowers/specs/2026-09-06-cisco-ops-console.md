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
| Voice | Full orb + conversation | Realtime voice + typed ask (same tools as before) |
| Assurance | NOC home | `getDashboard()` |
| Investigate | Path + timeline | `executeTool("investigate")` |
| Inventory | Device table + L2 topology | dashboard devices + links |
| Squad | Kanban + roster + squad chat | existing TeamBoard |
| Observability | Current tool output + audit | existing ObservabilityPanel |
| Reports | Artifact library | existing ArtifactsPanel |
| Settings (rail footer) | Identity + theme + source | local prefs; source status once |

The visible product name defaults to **Vigil**. **NetJarvis** is the assistant
name and lives under Settings, not as a cheap lockup on the rail. Appearance is
a Kiro-style gallery (Auto / Light / Dark, palette intensity, named themes)
so rail and top bar share one chrome. Active nav is a filled row — no inset
accent bar. Operator can follow the console name. The rail is collapsible
from the brand row. Source Unreachable / Live / Fixture is shown on Assurance,
Inventory, and Settings — not duplicated in the rail footer.

When Catalyst Center is down and `NETJARVIS_SOURCE` is `auto` (default) and
`NETJARVIS_EVIDENCE_FIXTURE` is set, Assurance and Inventory overlay the
labelled mock lab (no invented health scores or topology links). Forced
`NETJARVIS_SOURCE=live` stays empty if CATC is unreachable.

**Voice is a first-class workspace**, not a drawer. The original orb
(`NetworkCore`) fills the Assistant → Voice page: talk or type, tools run,
the conversation stays on the right. A compact orb in the top bar opens Voice
from any page. The two answer paths (Realtime voice vs chat pipeline) are
unchanged.

## Honesty rules (unchanged)

- No fabricated devices, events, or health.
- Unreachable Catalyst Center renders empty + badge, not fake scores.
- Mock-lab investigations show a FIXTURE banner.
- `run_show_command` / live-only tools still fail honestly offline.

## Out of scope

- Cisco wordmark, Cisco Sans, or DNA Center trademarks
- Re-merging voice into the chat router
- New backends
