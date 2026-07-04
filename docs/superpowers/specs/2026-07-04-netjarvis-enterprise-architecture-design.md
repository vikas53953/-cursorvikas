# NetJarvis — Enterprise Architecture Design

**Date:** 2026-07-04
**Status:** Draft for owner review
**Owner:** Vikas (network engineer, ~15 yrs; building this as a real enterprise product)

---

## 1. Purpose & scope

NetJarvis is a **real, enterprise-grade** network-operations copilot. An engineer asks any question
in plain language (by voice or text); the product resolves *which* real devices the question is
about, runs the **actual read-only command** on those real devices, and answers with **real output**.

This is **not** a demo, a simulator, or a toy for four switches. It is architected for
**Bank of America scale** across multiple network domains:

| Domain | Approx. device count |
|---|---|
| Data network (switches/routers) | ~70,000 |
| Firewalls | 1,000+ |
| Proxies | 800+ |
| Load balancers | 2,000+ |

The engineer does **not** have access to the live BofA network from this project today. The
**Cisco DevNet always-on sandbox** (a real, Cisco-cloud-hosted Catalyst Center managing real
Catalyst 9000v switches) is used as the **first reachable real backend** to build and validate the
architecture. The 4 sandbox switches are *what is reachable now* — the architecture must never be
*about* them. When real BofA backends become reachable, they slot into interfaces already built.

### Non-goals
- No fabricated / simulated / canned network data, ever. (The inherited fake simulator is removed.)
- No configuration changes. **Read-only is a hard product boundary.**
- Not unifying the voice and chat pipelines (kept separate by prior decision — see §9).

---

## 2. Principles

1. **Real or honest.** Every answer is real device/inventory data, or a truthful "unreachable"
   state with auto-retry. Never a fake number.
2. **Read-only, always.** Only non-mutating commands (`show`, `list`, etc.) reach any device, and it
   is enforced per device platform, not just by string prefix.
3. **Scope before action.** No operation runs against the whole estate. A question is first resolved
   to a **bounded** device set; execution is capped and concurrency-limited.
4. **Pluggable everywhere.** Inventory sources, execution transports, and domains are all behind
   interfaces. Adding a network = registering a source, not a rewrite.
5. **Prove it on what's real today.** Every interface is implemented and validated against the Cisco
   sandbox before we depend on it. Domains without a reachable backend stay as empty registered
   slots — never faked.

---

## 3. The two-plane model

The product separates **discovery** from **action**. This mirrors how the enterprise actually works:
you look a device up in the CMDB, then you SSH to it through a jump host to run commands.

```
   Plain-language question  (voice OR chat)
              │
   ┌──────────▼───────────────────────────────────────────────┐
   │  ANSWER PIPELINES  (two, kept separate)                   │
   │   • Voice : OpenAI Realtime + tools (client-driven)       │
   │   • Chat  : classify → plan → skill (server-driven)       │
   └──────────┬────────────────────────────────────────────────┘
              │  both call the SAME layer ↓
   ┌──────────▼───────────────────────────────────────────────┐
   │  NETWORK QUERY LAYER   (new, shared)                      │
   │   1. RESOLVE  question → bounded device set  (Plane 1)    │
   │   2. DISPATCH read-only exec to each device  (Plane 2)    │
   │   3. NORMALIZE + return real results                      │
   │   + enforce scope caps, concurrency, read-only, timeouts  │
   └──────────┬───────────────────────────────────────────────┘
        ┌─────┴───────────────────────────┐
        ▼                                  ▼
 ┌───────────────────────┐     ┌──────────────────────────────┐
 │ PLANE 1: INVENTORY     │     │ PLANE 2: EXECUTION            │
 │ "which devices?"       │     │ "run the read-only command"   │
 │                        │     │                               │
 │ InventoryProvider      │     │ Executor (pluggable)          │
 │  = CMDB (source of     │     │  • SshExecutor: jump host →   │
 │    truth for inventory)│     │    device CLI (real BofA model)│
 │  search / get / refresh│     │  • CatalystCenterExecutor:    │
 │                        │     │    CATC Command Runner API    │
 │ today: Catalyst Center │     │  (chosen per device/source)   │
 │  inventory API plays    │    │                               │
 │  this role             │     │ read-only enforced per platform│
 └───────────────────────┘     └──────────────────────────────┘
```

- **Plane 1 (Inventory / Scope)** — the CMDB is the authoritative catalog. We **search** it to turn a
  question into a bounded device set. We never *reach* devices through it; it is reference only.
  Each device record carries the metadata needed to act on it (mgmt IP, platform/type, domain, site,
  role, which executor + which jump host reaches it, which credential to use).
- **Plane 2 (Execution)** — for the resolved devices, run the read-only command **directly on the
  device CLI**, via a pluggable Executor. The primary real-world transport is **SSH through a jump
  host**; the sandbox is additionally reachable via the Catalyst Center Command Runner.

---

## 4. Domain model

- **Domain** — a class of infrastructure: `data` | `firewall` | `proxy` | `loadbalancer`. (Matches
  the existing agent org chart in `agents.cjs`.) Extensible.
- **Device** — a normalized record resolved from inventory:
  ```
  {
    id, name, mgmtIp, domain, platform (e.g. "ios-xe", "pan-os", "f5-tmos"),
    site, role, sourceId,            // which Source/mgmt system owns it
    executor: "ssh" | "catalyst-center",
    jumpHost?: "<bastion id>",       // for ssh
    credentialRef: "<secret id>"     // never a raw secret
  }
  ```
- **Source** — a registered backend that binds a domain to an InventoryProvider and an Executor with
  a credential set. Examples: `catalyst-center-sandbox` (data), later `bofa-catc` (data),
  `bofa-panorama` (firewall), `bofa-f5` (loadbalancer).
- **Source Registry** — the list of configured sources; the Query Layer dispatches through it.

---

## 5. Core interfaces

Small, single-purpose, independently testable.

### 5.1 InventoryProvider (Plane 1)
```
search(filter): Device[]        // by name/ip/role/site/domain/platform; paginated; server-side where possible
get(deviceId): Device
refresh(): void                 // rebuild/refresh the index/cache
health(): { ok, reachable, error? }
```
- **Today:** `CatalystCenterInventoryProvider` adapts the CATC inventory API (already implemented in
  `sources/catalyst-center.cjs`).
- **Later:** `NetboxInventoryProvider` / `ServiceNowInventoryProvider` / etc. behind the same
  interface. Must support **search + pagination**, not "list all" (70k devices).

### 5.2 Executor (Plane 2)
```
runReadOnly(device, commands[]): { host, outputs, ok, error? }   // real CLI output
supports(device): boolean                                        // platform/transport match
health(): { ok, error? }
```
- `SshExecutor` — connects (optionally through a configured jump host) to `device.mgmtIp`, runs
  read-only CLI commands, returns raw output. Handles per-platform prompt/paging quirks.
- `CatalystCenterExecutor` — wraps the CATC Command Runner (already implemented). Used for the CATC
  sandbox devices today.
- The registry picks the executor named on the device record.

### 5.3 Source
```
{ id, domain, inventory: InventoryProvider, executor: Executor, credentials }
```

### 5.4 NetworkQueryLayer (shared by both pipelines)
```
resolveScope(text | filter): { devices: Device[], capped: bool, total: number }
run(scope, commands[]): NormalizedResult          // dispatch + normalize + cap/concurrency
answerFacet(scope, facet): NormalizedResult        // health/interfaces/topology/etc.
```
This is the **one** layer both voice tools and chat skills call, so behavior stays consistent even
though their orchestration differs.

---

## 6. Scale & safety (the part that makes 70k safe)

- **Scope is mandatory for execution.** A command with no resolvable scope is refused with a request
  to narrow it. Resolution is a **CMDB search**, never an estate walk.
- **Fan-out cap.** If a scope resolves to more than `MAX_INTERACTIVE_DEVICES` (proposed default
  **25**), the product summarizes the match count and requires explicit confirmation before running;
  above a hard ceiling (proposed **500**) it refuses and asks to narrow. Configurable.
- **Concurrency cap.** SSH/API fan-out runs at most `MAX_CONCURRENCY` sessions at once (proposed
  **10**), queued beyond that. Per-device **timeout** (proposed 20–40s), partial results returned on
  slow devices with per-device error status.
- **Per-platform read-only allowlist.** Read-only is enforced by device platform, not just `^show`:
  IOS-XE (`show`), PAN-OS (`show`), F5 tmsh (`show`/`list`), etc. The existing `guardrails.cjs`
  blocklist is generalized into a per-platform allowlist. Config/mutating verbs are rejected before
  any connection.
- **Inventory index/cache.** Search results and device records are cached with a TTL; the index
  refreshes in the background. No full inventory is ever held in memory for large sources.

---

## 7. Real-only & honest-unreachable

- Delete `network-data.cjs` (the fake simulator) and every `mode === "live" ? … : sim…` branch.
- The source facade returns a real snapshot **or** `{ reachable: false, error, lastAttempt }`.
- UI: the LIVE/SIM badge becomes **LIVE / UNREACHABLE**; unreachable shows a truthful banner and the
  Query Layer auto-retries with backoff. Nothing fabricated is ever shown.
- Tools/skills that only existed for the simulator (e.g. `acknowledge_alert` sim path) are removed or
  redirected to the real system of record.

---

## 8. How this maps onto the current code

**Reused (already real, keep):**
- `sources/catalyst-center.cjs` — becomes both `CatalystCenterInventoryProvider` and
  `CatalystCenterExecutor` (split its responsibilities behind the two interfaces).
- `sources/nvd.cjs` — real CVE lookup, unchanged.
- `guardrails.cjs` — generalized into the per-platform read-only allowlist (§6).
- `tools.cjs` tool surface, `agents.cjs` org chart, both answer pipelines — kept; their tools/skills
  are rewired to call the Network Query Layer instead of the old facade.

**Refactored:**
- `network-source.cjs` (live/sim facade) → **Source Registry + Network Query Layer**.
- `device-facts.cjs` `swN` parser → **inventory-driven scope resolver** (matches real names/IPs/roles
  from the CMDB, at any scale). This is where the `swN` mismatch bug dies at the root.

**Removed:**
- `network-data.cjs` (fake simulator) and all sim branches.

**Frontend (product quality, folded in):**
- Delete the dead artifact-render code in `ArtifactPanel.tsx`; restore topology (mermaid) rendering
  in `ObservabilityPanel`; make the dashboard reflect real reachability + activity.

---

## 9. Today vs later

**Built & validated now, on the Cisco sandbox:**
- Source Registry, Domain model, InventoryProvider + Executor interfaces, Network Query Layer, scope
  caps, per-platform read-only, real-only/honest-unreachable.
- Two real sources to prove the pluggable executor:
  - `catalyst-center-sandbox` (data; CATC inventory + `CatalystCenterExecutor`).
  - `iosxe-ssh-sandbox` (data; a Cisco always-on IOS-XE sandbox that exposes SSH, proving
    `SshExecutor` with an optional jump-host hop). *(Exact sandbox to confirm — see open questions.)*

**Registered but empty until a real backend exists (never faked):**
- `firewall`, `proxy`, `loadbalancer` domains.

**Later, when reachable:**
- Real BofA CMDB as the InventoryProvider; real jump host + credentials; real per-domain devices.
- Enterprise user auth / RBAC; deployment model (see open questions).

---

## 10. Security

- **Per-source credentials**, referenced by ID from device records; never raw secrets in inventory
  or logs. Secrets loaded from environment/secret store, redacted in all logging.
- **Jump-host auth** modeled explicitly in `SshExecutor` (bastion login → device login).
- **Read-only enforcement** at the executor boundary, per platform.
- **Full audit** (already present via `session-store.cjs` / artifacts) extended to record which
  devices were touched, by which source/executor, for every command.
- TLS verification for the CATC adapter is currently globally disabled; restrict it to the known
  sandbox host (carry-over hardening item).

---

## 11. Phased build plan

Each phase is independently shippable and validated on the sandbox. Phase 1 becomes the first
implementation plan (via the writing-plans step).

- **Phase 1 — Foundation.** Source Registry + Domain model; InventoryProvider & Executor interfaces;
  CatalystCenter inventory+executor; SshExecutor proven on an SSH sandbox; Network Query Layer with
  scope resolution + fan-out/concurrency caps; per-platform read-only; remove fake simulator +
  honest-unreachable; inventory-driven scope resolver replaces the `swN` parser; both pipelines call
  the Query Layer. Frontend: reachability badge, dead-code cleanup, topology rendering.
- **Phase 2 — Scale hardening.** Search/pagination/index + caching for large inventories; concurrency
  and cap behavior validated with synthetic scale; multi-platform read-only allowlists fleshed out.
- **Phase 3 — Multi-domain readiness.** Firewall/Proxy/LB domain scaffolding + pluggable
  InventoryProvider for a real CMDB (NetBox/ServiceNow) behind the interface, ready for real sources.
- **Phase 4 — Enterprise connect (needs real backends).** Real BofA CMDB + jump host + management
  systems; RBAC/user auth; deployment.

---

## 12. Open questions (deferred; do not block Phase 1)

1. **Which concrete CMDB** does BofA use (ServiceNow CMDB / NetBox / Infoblox / other)? Shapes the
   Phase 3 InventoryProvider adapter. Interface stays generic until known.
2. **Jump-host specifics** — the "Patti" gateway: SSH proxy jump, or an agent/API in front of it?
   Shapes `SshExecutor`'s connection model for Phase 4.
3. **Exact SSH sandbox** to validate `SshExecutor` in Phase 1 (a Cisco DevNet always-on IOS-XE
   sandbox that exposes SSH).
4. **Deployment & user auth** — single-engineer desktop vs team web behind SSO; who may use it; RBAC.
</content>
