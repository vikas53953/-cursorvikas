# Cross-platform investigation agent — AI-Ready SOC, Part II

> Brief (28 Aug 2026): *Correlate Splunk, VPN, proxy, firewall, endpoint, identity and cloud
> evidence into one timestamped investigation.*
>
> Status: implemented on branch `cursor/cross-platform-investigation-agent-f59f`. This document is
> the design record; the code is the source of truth.

## 1. What it does

An analyst (voice or chat) names one entity — a **user**, an **IP**, or a **host** — and a window.
NetJarvis fans out read-only queries to every configured evidence provider, correlates the rows
into **one time-ordered, UTC-timestamped timeline**, and returns:

| Section | Content |
|---|---|
| Summary | Factual observations only: counts, first/last seen per platform, ordered sequences (e.g. "3 failed authentications, then a success at …"), VPN-assigned address re-appearing as a source on later firewall/proxy rows, deny/block ratios, high/critical EDR detections, IAM/permission cloud calls. |
| Coverage | One row per provider/platform: `ok` / `empty` / `unconfigured` / `failed`, event count, query time. |
| Timeline | Every correlated event: time, platform, severity, event, who/where, provider (+ product). Deduped on exact `(provider, platform, time, kind, summary, entities)`; out-of-window rows dropped; capped at 500 rows with the total shown. |
| Related entities | Users / IPs / hosts that co-occur with the seed, with supporting row count, platforms, first/last seen — pivot candidates for the next hop, never asserted as conclusions. |
| Gaps | Every platform that produced nothing, and why. |
| Queries run | The exact SPL / API calls, for audit. |

The same result is (a) spoken/typed as a short summary, (b) rendered as a markdown artifact in the
Observability tab, (c) saved to the artifact library, and (d) logged (`investigation.done`).

## 2. Hard rules carried over from the product

- **Real data only.** No simulator, no synthetic rows. A provider without credentials reports
  `unconfigured`; a provider that errors reports `failed` with the error; a provider that finds
  nothing reports `empty`. All three surface in Coverage and Gaps.
- **Read-only forever.** `core/spl-policy.cjs` rejects any SPL that writes/collects/executes/sends
  (`delete`, `collect`, `mcollect`, `outputlookup`, `outputcsv`, `sendemail`, `sendalert`, `script`,
  `run`, `rest`, `map`, `makeresults`, `dbxquery`, …) *before* the HTTP request is built. The
  Splunk client refuses non-read-only SPL even when called directly. Catalyst Center evidence uses
  GET-only Intent API endpoints.
- **No inference beyond the evidence.** Observations are deterministic string templates over counts
  and ordering. The chat narration model is given only the engine's JSON output and instructed to
  add no facts, attribution, or "compromise" language.
- **Two mouths, one engine.** Voice calls `investigate` directly (tool spec + persona rule). Chat
  routes `INTENTS.INVESTIGATE` → `skills/investigation.cjs` → the same tool. Both render the same
  artifact.

## 3. Architecture

```
                 ┌──────────────────────────────────────────────────────────┐
 voice ──tool──▶ │ tools.cjs: investigate(args)                              │
 chat ──skill──▶ │  entity = normalizeEntity({user|ip|host})                 │
                 │  window = resolveWindow({lookbackHours|from,to}) (≤30d)   │
                 │  results = collectEvidence(providers, entity, window)     │──▶ parallel fan-out
                 │  inv = buildInvestigation({entity, window, results})       │
                 │  → summary, artifact(markdown), counts, coverage, gaps …   │
                 └──────────────────────────────────────────────────────────┘
                                          │
        ┌─────────────────────────────────┼──────────────────────────────────┐
        ▼                                 ▼                                  ▼
 sources/evidence/index.cjs      sources/evidence/lenses.cjs        sources/evidence/splunk.cjs
 Catalyst Center provider        vpn | proxy | firewall |            POST /services/search/jobs/export
 (issues + event-series,         endpoint | identity | cloud | siem  output_mode=json, epoch window,
 platform "network")             CIM fields → EvidenceEvent          bearer/basic, TLS verify on
```

### 3.1 Contracts

```js
// EvidenceEvent (core/investigation.cjs)
{ ts, epochMs, provider, platform, product, kind, severity, entities: {user, srcIp, destIp, host, …}, summary, raw }

// EvidenceProvider (sources/evidence/index.cjs)
{ id, platform, configured(): boolean,
  collect({ entity:{kind,value}, window:{fromMs,toMs}, limit }) →
    { status: "ok"|"empty"|"unconfigured"|"failed", events: EvidenceEvent[], query?, error?, ms? } }
```

Adding a direct-API provider (Okta System Log, CrowdStrike Falcon, AWS CloudTrail Lookup, Zscaler
NSS API, …) means implementing that shape and registering it in `createEvidenceProviders`. Nothing
else changes: the engine, tool, skill, artifact and tests are provider-agnostic.

### 3.2 Splunk lenses

Each lens is `{ id, platform, title, defaultBase }`. `buildSpl(lens, entity)` emits

```
search <base> (<entity filter>) | fields <CIM fields> | head <limit>
```

The entity filter is kind-specific (`user`/`src_user`/`user_name`/`Account_Name`/…, or
`src`/`src_ip`/`dest`/`dest_ip`/`assigned_ip`/`clientip`/…, or `host`/`dest_host`/`dvc`/
`ComputerName`/…). Default bases use CIM tags plus common sourcetypes over `index=*`; shops set
`SPLUNK_LENS_<PLATFORM>` to their real index/sourcetype for speed and precision.

`mapRow` derives `kind` (e.g. `vpn.session`, `proxy.blocked`, `fw.deny`, `edr.detection`,
`auth.failure`, `cloud.api`, `siem.notable`) and a one-line `summary` from fields present on the row
only.

### 3.3 Catalyst Center network lens

Uses the raw event-series (`/dna/intent/api/v1/event/event-series`, real epoch timestamps) and
`/issues`, filtered by the seed: hostname / management IP for hosts and IPs, quoted account name
in audit-log descriptions for users (the DevNet sandbox emits `LOGIN_USER_EVENT: 'devnetuser'
logged in successfully.` with the client IP in `source`, which becomes `srcIp`).

## 4. Surfaces

- **Tool** `investigate` — `{ user | ip | host, lookbackHours?, from?, to?, platforms? }`.
  Guardrail: exactly one seed; positive lookback. Routed to team **soc**.
- **Specialist** `soc` — "Investigation Agent" on the Security Team (org chart, Kanban, delegation).
- **Chat intent** `investigate` — verbs `investigate | correlate | timeline | trace | what did X do |
  activity for | evidence for`, plus a seed (`user X`, IPv4, `host X`, email, or a known device
  name), optional lookback ("last 6 hours", "past 3 days", "yesterday") and platform hints
  ("across vpn, proxy and firewall").
- **`multi_source_status`** now reports Splunk reachability/version alongside Catalyst Center,
  Prometheus and SNMP.

## 5. Configuration

```
SPLUNK_URL=https://splunk.example.com:8089
SPLUNK_TOKEN=…                      # or SPLUNK_USERNAME / SPLUNK_PASSWORD
SPLUNK_VERIFY_TLS=true              # default; false only for a self-signed lab box
SPLUNK_TIMEOUT_MS=45000  SPLUNK_MAX_COUNT=500
SPLUNK_LENS_VPN|PROXY|FIREWALL|ENDPOINT|IDENTITY|CLOUD|SIEM=<base search override>
```

## 6. Tests (`npm test`)

- `test/investigation.test.cjs` — entity/window normalization, merge/dedupe/window, coverage &
  gaps, pivots, observations, markdown render, unconfigured summary.
- `test/spl-policy.test.cjs` — allowed generating commands, blocked write/exec/outbound commands
  anywhere in the pipeline, false-positive guard for field names like `deleted_user`.
- `test/splunk-evidence.test.cjs` — client config/auth/export parsing/HTTP+transport failures/
  read-only refusal (injected transport), lens SPL + overrides, CIM row mapping per platform,
  provider statuses, Catalyst Center lens, parallel collection with contained failures.
- `test/investigation-chat.test.cjs` — router extraction (user/ip/host/email/device, lookback,
  platforms), non-hijack cases, planner, guardrails, org chart/routing, skill narration grounded on
  tool JSON, degraded (quota) path, tool-failure path.

Live check performed against the DevNet sandbox: `investigate user devnetuser` returned 190 real
audit-log events (187 after exact-duplicate removal) with client-IP pivots; Splunk lenses reported
`unconfigured` because no Splunk credentials exist in this environment.

## 7. Not in this change (candidates for Part III)

- Direct-API providers for shops that do not route a feed through Splunk (Okta, CrowdStrike,
  CloudTrail, Zscaler).
- Multi-hop auto-pivot (seed → discovered IP → second investigation) — the pivot table is
  produced; chaining is a manual "investigate 203.0.113.9" today.
- Case management export (ticket attach) and a dedicated timeline UI beyond the markdown artifact.
- Sigma/ATT&CK tagging of observations.
