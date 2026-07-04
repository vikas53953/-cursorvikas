# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc live/sim network layer with the enterprise two-plane architecture — pluggable Inventory + Executor sources behind a scope-first, capped Query Layer — proven against the real Catalyst Center sandbox and a real SSH device, with the fake simulator removed.

**Architecture:** A `SourceRegistry` holds sources; each source pairs an `InventoryProvider` (Plane 1 — "which devices", backed today by Catalyst Center) with an `Executor` (Plane 2 — "run the read-only command", backed by Catalyst Center Command Runner *and* SSH). A `NetworkQueryLayer` resolves a plain-language reference to a **bounded** device set via inventory search, then dispatches read-only commands to the right executor with fan-out caps, concurrency limits, and per-platform read-only enforcement. The voice and chat pipelines both call this one layer. No fabricated data: unreachable sources return an honest status.

**Tech Stack:** Node.js 20+ (CommonJS `.cjs`, no TypeScript in the backend), built-in `node --test` runner (zero new test deps), `ssh2` for the SSH executor. Existing: `electron/sources/catalyst-center.cjs` (real Intent API client), React/Vite frontend.

## Global Constraints

- **Backend is CommonJS `.cjs` with no Electron dependency** (except `main.cjs`/`preload.cjs`). New core modules must run under plain `node` and `node --test`. Copy this rule from `CLAUDE.md`.
- **Read-only forever.** Only non-mutating commands (`show`/`list`) ever reach a device; enforced per platform. No code path may issue a config/mutating command.
- **Real data only.** No module may return fabricated device data. Unreachable = `{ reachable: false, error }`.
- **Scope is mandatory for execution.** No command runs without a resolved, bounded device set. Caps: interactive **25**, hard ceiling **500**, max concurrency **10** (all read from config with these defaults).
- **Secrets only from `.env.local`**, referenced by env var; never hardcoded, never logged. `ssh2` host-key policy and credentials come from env.
- **Device naming is inventory-driven** — never hardcode `swN`. Resolution matches real inventory (hostname, IP, role, site, platform).
- File/JSDoc style follows existing `electron/*.cjs`. New shared modules live under `electron/core/`; new source adapters under `electron/sources/providers/` and `electron/sources/executors/`.

---

## File structure

**Create:**
- `electron/core/contracts.cjs` — JSDoc typedefs (`Device`, `Source`, `InventoryProvider`, `Executor`), `DOMAINS`/`PLATFORMS` constants, `normalizeDevice()`.
- `electron/core/read-only-policy.cjs` — per-platform read-only command allowlist + `assertReadOnly()`.
- `electron/core/scope-resolver.cjs` — `resolveScope(text|filter, devices)` → bounded device set.
- `electron/core/source-registry.cjs` — register/list sources, `devicesForExecutor()`.
- `electron/core/query-layer.cjs` — `createQueryLayer({registry, config})` → `resolveScope`, `run`.
- `electron/sources/providers/catalyst-center-inventory.cjs` — `InventoryProvider` over `catalyst-center.cjs`.
- `electron/sources/executors/catalyst-center-executor.cjs` — `Executor` over Command Runner.
- `electron/sources/executors/ssh-executor.cjs` — `Executor` over `ssh2` (jump-host aware).
- `test/contracts.test.cjs`, `test/read-only-policy.test.cjs`, `test/scope-resolver.test.cjs`, `test/source-registry.test.cjs`, `test/query-layer.test.cjs`, `test/catalyst-center-inventory.test.cjs`, `test/ssh-executor.test.cjs`.

**Modify:**
- `package.json` — add `test` script + `ssh2` dependency.
- `electron/guardrails.cjs` — delegate CLI checks to `read-only-policy.cjs`.
- `electron/network-source.cjs` — remove sim path; honest-unreachable; build snapshot from registry.
- `electron/tools.cjs` — route `run_show_command`/interfaces/etc. through the Query Layer; drop `mode === "live" ? … : sim…` branches.
- `electron/message-router.cjs` + `electron/device-facts.cjs` — device extraction delegates to `scope-resolver`.
- `.env.example` — document `SSH_SANDBOX_*` vars.
- `src/components/OpsDashboard.tsx` — LIVE/SIM badge → LIVE/UNREACHABLE.

**Delete:**
- `electron/network-data.cjs` (fake simulator) — in Task 10.

---

### Task 1: Test harness

**Files:**
- Modify: `package.json`
- Test: `test/smoke.test.cjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs `node --test`; `.test.cjs` files under `test/` are discovered.

- [ ] **Step 1: Write the failing test**

Create `test/smoke.test.cjs`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");

test("test harness runs", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 2: Add the test script**

In `package.json` `"scripts"`, add:
```json
"test": "node --test"
```

- [ ] **Step 3: Run and verify it passes**

Run: `npm test`
Expected: `# pass 1` (the smoke test is discovered and passes).

- [ ] **Step 4: Commit**

```bash
git add package.json test/smoke.test.cjs
git commit -m "test: add node --test harness"
```

---

### Task 2: Core contracts

**Files:**
- Create: `electron/core/contracts.cjs`
- Test: `test/contracts.test.cjs`

**Interfaces:**
- Produces:
  - `DOMAINS = ["data","firewall","proxy","loadbalancer"]`
  - `PLATFORMS` map with read-only verbs (consumed by Task 3).
  - `normalizeDevice(raw, { sourceId, executor }) → Device` where
    `Device = { id, name, mgmtIp, domain, platform, site, role, sourceId, executor }`.
  - JSDoc typedefs `Device`, `Source`, `InventoryProvider`, `Executor`.

- [ ] **Step 1: Write the failing test**

Create `test/contracts.test.cjs`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeDevice, DOMAINS } = require("../electron/core/contracts.cjs");

test("normalizeDevice maps a Catalyst Center inventory row", () => {
  const d = normalizeDevice(
    { id: "uuid-1", hostname: "sw1", managementIp: "10.10.20.51", role: "ACCESS", platform: "C9KV", softwareType: "IOS-XE" },
    { sourceId: "catc-sandbox", executor: "catalyst-center" },
  );
  assert.equal(d.id, "uuid-1");
  assert.equal(d.name, "sw1");
  assert.equal(d.mgmtIp, "10.10.20.51");
  assert.equal(d.platform, "ios-xe");
  assert.equal(d.role, "access");
  assert.equal(d.sourceId, "catc-sandbox");
  assert.equal(d.executor, "catalyst-center");
  assert.equal(d.domain, "data");
});

test("DOMAINS includes the four enterprise domains", () => {
  assert.deepEqual(DOMAINS, ["data", "firewall", "proxy", "loadbalancer"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../electron/core/contracts.cjs'`.

- [ ] **Step 3: Implement**

Create `electron/core/contracts.cjs`:
```js
// Shared contracts for the two-plane network architecture.
//
// @typedef {Object} Device
// @property {string} id            Stable id (source-native, e.g. CATC uuid)
// @property {string} name          Hostname
// @property {string} mgmtIp        Management IP
// @property {string} domain        One of DOMAINS
// @property {string} platform      Normalized platform key (see PLATFORMS)
// @property {string} role          Lowercased role (access/core/distribution/...)
// @property {string} site          Site/location ("" if unknown)
// @property {string} sourceId      Owning Source id
// @property {string} executor      Executor key ("catalyst-center" | "ssh")
//
// @typedef {Object} InventoryProvider
// @property {(filter?:object)=>Promise<Device[]>} search
// @property {()=>Promise<{ok:boolean,reachable:boolean,error?:string}>} health
//
// @typedef {Object} Executor
// @property {(device:Device, commands:string[])=>Promise<{host:string, outputs:Object, ok:boolean, error?:string}>} runReadOnly
// @property {(device:Device)=>boolean} supports
//
// @typedef {Object} Source
// @property {string} id
// @property {string} domain
// @property {InventoryProvider} inventory
// @property {Executor} executor

const DOMAINS = ["data", "firewall", "proxy", "loadbalancer"];

// Platform key → the command verbs that are read-only on that platform.
const PLATFORMS = {
  "ios-xe": { readOnlyVerbs: ["show"] },
  "nx-os": { readOnlyVerbs: ["show"] },
  "pan-os": { readOnlyVerbs: ["show"] },
  "f5-tmos": { readOnlyVerbs: ["show", "list"] },
};

function normalizePlatform(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("ios") && s.includes("xe")) return "ios-xe";
  if (s.includes("nx")) return "nx-os";
  if (s.includes("pan")) return "pan-os";
  if (s.includes("f5") || s.includes("tmos") || s.includes("big-ip")) return "f5-tmos";
  return "ios-xe"; // sandbox default; real inventory carries an explicit platform
}

/** @returns {Device} */
function normalizeDevice(raw, { sourceId, executor, domain = "data" } = {}) {
  return {
    id: String(raw.id || raw.uuid || raw.hostname || ""),
    name: String(raw.hostname || raw.name || raw.id || ""),
    mgmtIp: String(raw.managementIp || raw.mgmtIp || raw.ipAddress || ""),
    domain,
    platform: normalizePlatform(raw.softwareType || raw.platform || raw.family),
    role: String(raw.role || "").toLowerCase(),
    site: String(raw.site || raw.location || ""),
    sourceId: String(sourceId || ""),
    executor: String(executor || ""),
  };
}

module.exports = { DOMAINS, PLATFORMS, normalizePlatform, normalizeDevice };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/core/contracts.cjs test/contracts.test.cjs
git commit -m "feat: core Device/Source contracts and normalizeDevice"
```

---

### Task 3: Per-platform read-only policy

**Files:**
- Create: `electron/core/read-only-policy.cjs`
- Modify: `electron/guardrails.cjs`
- Test: `test/read-only-policy.test.cjs`

**Interfaces:**
- Consumes: `PLATFORMS` from Task 2.
- Produces: `assertReadOnly(platform, command) → { ok:true } | { ok:false, error }` and `BLOCKED_PATTERNS`.

- [ ] **Step 1: Write the failing test**

Create `test/read-only-policy.test.cjs`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { assertReadOnly } = require("../electron/core/read-only-policy.cjs");

test("allows a show command on ios-xe", () => {
  assert.equal(assertReadOnly("ios-xe", "show vlan brief").ok, true);
});

test("blocks configure on ios-xe", () => {
  assert.equal(assertReadOnly("ios-xe", "configure terminal").ok, false);
});

test("blocks a mutating verb even if it starts with show-like text", () => {
  assert.equal(assertReadOnly("ios-xe", "show run | append flash:x").ok, false);
});

test("allows list on f5-tmos but not on ios-xe", () => {
  assert.equal(assertReadOnly("f5-tmos", "list ltm pool").ok, true);
  assert.equal(assertReadOnly("ios-xe", "list ltm pool").ok, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `electron/core/read-only-policy.cjs`:
```js
// Per-platform read-only enforcement. A command must (a) start with a read-only
// verb allowed on the device's platform and (b) contain no mutating/dangerous token.
const { PLATFORMS } = require("./contracts.cjs");

const BLOCKED_PATTERNS = [
  /\bconfig(?:ure)?\b/i, /\bconf\s*t\b/i, /\bwrite\b/i, /\berase\b/i, /\bcopy\b/i,
  /\bdelete\b/i, /\bremove\b/i, /\bno\s+\w/i, /\bclear\b/i, /\breload\b/i,
  /\bshutdown\b/i, /\breboot\b/i, /\bdebug\b/i, /\btelnet\b/i, /\bssh\b/i,
  /\bappend\b/i, /\btclsh\b/i, /\bset\b/i, /\bcreate\b/i, /\bmodify\b/i,
  /[>|]\s*(?:flash|bootflash|disk|tftp|scp|ftp)/i,
];

function assertReadOnly(platform, command) {
  const cmd = String(command || "").trim();
  if (!cmd) return { ok: false, error: "Empty command." };
  const verbs = PLATFORMS[platform]?.readOnlyVerbs || ["show"];
  const firstWord = cmd.split(/\s+/)[0].toLowerCase();
  if (!verbs.includes(firstWord)) {
    return { ok: false, error: `Read-only policy: "${firstWord}" is not permitted on ${platform} (allowed: ${verbs.join(", ")}). Blocked: ${cmd}` };
  }
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) return { ok: false, error: `Read-only policy: command contains a blocked token. Blocked: ${cmd}` };
  }
  return { ok: true };
}

module.exports = { assertReadOnly, BLOCKED_PATTERNS };
```

- [ ] **Step 4: Point the existing guardrail at the new policy**

In `electron/guardrails.cjs`, replace the body of `validateToolCall`'s `run_show_command` branch so each command is checked with the new policy (default platform `ios-xe` for the sandbox), keeping the existing `acknowledge_alert` confirmation check:
```js
const { assertReadOnly } = require("./core/read-only-policy.cjs");
// inside validateToolCall, for run_show_command:
if (name === "run_show_command") {
  const commands = Array.isArray(args.commands) ? args.commands.map(String) : [];
  for (const command of commands) {
    const verdict = assertReadOnly(args.platform || "ios-xe", command);
    if (!verdict.ok) return verdict;
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test`
Expected: PASS (read-only-policy tests green; existing behavior preserved).

- [ ] **Step 6: Commit**

```bash
git add electron/core/read-only-policy.cjs electron/guardrails.cjs test/read-only-policy.test.cjs
git commit -m "feat: per-platform read-only policy; guardrails delegate to it"
```

---

### Task 4: Inventory-driven scope resolver

**Files:**
- Create: `electron/core/scope-resolver.cjs`
- Test: `test/scope-resolver.test.cjs`

**Interfaces:**
- Consumes: `Device[]` (from an InventoryProvider search or a fixture).
- Produces: `resolveScope(text, devices, { cap }) → { devices, total, capped }`. Matches by exact name, name token, IP, role, and site; falls back to name substrings. Never hardcodes `swN`.

- [ ] **Step 1: Write the failing test**

Create `test/scope-resolver.test.cjs`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveScope } = require("../electron/core/scope-resolver.cjs");

const FIXTURE = [
  { id: "1", name: "sw1", mgmtIp: "10.10.20.51", role: "access", site: "dc3" },
  { id: "2", name: "sw2", mgmtIp: "10.10.20.52", role: "access", site: "dc3" },
  { id: "3", name: "CORE-R1", mgmtIp: "10.10.20.1", role: "core", site: "dc1" },
  { id: "4", name: "DIST-SW1", mgmtIp: "10.10.20.10", role: "distribution", site: "dc1" },
];

test("resolves an exact device name", () => {
  const r = resolveScope("uptime on sw1", FIXTURE);
  assert.deepEqual(r.devices.map((d) => d.name), ["sw1"]);
});

test("resolves a real non-swN name", () => {
  const r = resolveScope("how is CORE-R1 doing", FIXTURE);
  assert.deepEqual(r.devices.map((d) => d.name), ["CORE-R1"]);
});

test("resolves by role + site", () => {
  const r = resolveScope("show version on the access switches in dc3", FIXTURE);
  assert.deepEqual(r.devices.map((d) => d.name).sort(), ["sw1", "sw2"]);
});

test("resolves by management IP", () => {
  const r = resolveScope("interfaces on 10.10.20.1", FIXTURE);
  assert.deepEqual(r.devices.map((d) => d.name), ["CORE-R1"]);
});

test("applies the cap and reports total", () => {
  const r = resolveScope("show version on the access switches in dc3", FIXTURE, { cap: 1 });
  assert.equal(r.total, 2);
  assert.equal(r.capped, true);
  assert.equal(r.devices.length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `electron/core/scope-resolver.cjs`:
```js
// Turns a plain-language reference into a bounded device set, matched against
// real inventory. No hardcoded device-name schemes.
const ROLE_WORDS = { core: "core", edge: "edge", distribution: "distribution", dist: "distribution", access: "access", leaf: "leaf", spine: "spine", firewall: "firewall", fw: "firewall", proxy: "proxy", "load balancer": "loadbalancer", loadbalancer: "loadbalancer", lb: "loadbalancer" };

function resolveScope(text, devices, { cap = Infinity } = {}) {
  const lower = String(text || "").toLowerCase();
  const tokens = lower.split(/[^a-z0-9.\-]+/).filter(Boolean);
  const tokenSet = new Set(tokens);

  // 1. exact name / IP hits (highest precedence)
  let hits = devices.filter((d) => tokenSet.has(d.name.toLowerCase()) || tokenSet.has(d.mgmtIp));

  // 2. role (+ optional site) filter
  if (hits.length === 0) {
    const roles = new Set();
    for (const [word, role] of Object.entries(ROLE_WORDS)) if (lower.includes(word)) roles.add(role);
    const sites = new Set(devices.map((d) => d.site).filter(Boolean).filter((s) => tokenSet.has(s.toLowerCase())));
    if (roles.size > 0) {
      hits = devices.filter((d) => roles.has(d.role) && (sites.size === 0 || sites.has(d.site.toLowerCase())));
    }
  }

  // 3. name substring fallback (e.g. "switch 1" -> sw1 not covered by exact match)
  if (hits.length === 0) {
    hits = devices.filter((d) => tokens.some((t) => t.length >= 2 && d.name.toLowerCase().includes(t)));
  }

  const total = hits.length;
  const bounded = hits.slice(0, cap === Infinity ? hits.length : cap);
  return { devices: bounded, total, capped: total > bounded.length };
}

module.exports = { resolveScope };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/core/scope-resolver.cjs test/scope-resolver.test.cjs
git commit -m "feat: inventory-driven scope resolver (replaces swN parser)"
```

---

### Task 5: Catalyst Center InventoryProvider

**Files:**
- Create: `electron/sources/providers/catalyst-center-inventory.cjs`
- Test: `test/catalyst-center-inventory.test.cjs`

**Interfaces:**
- Consumes: `catalyst-center.cjs` `getInventory()` / `checkReachable()`; `normalizeDevice` (Task 2).
- Produces: `createCatalystCenterInventory({ catc, sourceId }) → InventoryProvider` with `search(filter?)` and `health()`. `search` returns normalized `Device[]` (executor `"catalyst-center"`).

- [ ] **Step 1: Write the failing test** (inject a fake `catc` — no network)

Create `test/catalyst-center-inventory.test.cjs`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCatalystCenterInventory } = require("../electron/sources/providers/catalyst-center-inventory.cjs");

const fakeCatc = {
  getInventory: async () => [
    { id: "u1", hostname: "sw1", managementIp: "10.10.20.51", role: "ACCESS", softwareType: "IOS-XE" },
  ],
  checkReachable: async () => true,
};

test("search returns normalized devices tagged with the source + executor", async () => {
  const inv = createCatalystCenterInventory({ catc: fakeCatc, sourceId: "catc-sandbox" });
  const devices = await inv.search();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].name, "sw1");
  assert.equal(devices[0].executor, "catalyst-center");
  assert.equal(devices[0].sourceId, "catc-sandbox");
});

test("health reflects reachability failure honestly", async () => {
  const inv = createCatalystCenterInventory({ catc: { checkReachable: async () => { throw new Error("timeout"); } }, sourceId: "x" });
  const h = await inv.health();
  assert.equal(h.reachable, false);
  assert.match(h.error, /timeout/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `electron/sources/providers/catalyst-center-inventory.cjs`:
```js
const { normalizeDevice } = require("../../core/contracts.cjs");

function createCatalystCenterInventory({ catc, sourceId }) {
  async function search() {
    const rows = await catc.getInventory();
    return rows.map((row) => normalizeDevice(row, { sourceId, executor: "catalyst-center", domain: "data" }));
  }
  async function health() {
    try {
      await catc.checkReachable();
      return { ok: true, reachable: true };
    } catch (error) {
      return { ok: false, reachable: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { search, health };
}

module.exports = { createCatalystCenterInventory };
```
*(Note: `search(filter)` is unfiltered today — the estate is 4 devices. Server-side search/pagination for large inventories is Phase 2. The scope-resolver still bounds results.)*

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/sources/providers/catalyst-center-inventory.cjs test/catalyst-center-inventory.test.cjs
git commit -m "feat: Catalyst Center InventoryProvider"
```

---

### Task 6: Catalyst Center Executor

**Files:**
- Create: `electron/sources/executors/catalyst-center-executor.cjs`
- Test: extend `test/catalyst-center-inventory.test.cjs` or new `test/catalyst-center-executor.test.cjs`

**Interfaces:**
- Consumes: `catalyst-center.cjs` `runCommands(deviceUuids, commands)` → `{ [hostname]: { [command]: output } }`; `assertReadOnly` (Task 3).
- Produces: `createCatalystCenterExecutor({ catc }) → Executor` with `supports(device)` (true when `device.executor === "catalyst-center"`) and `runReadOnly(device, commands) → { host, outputs, ok, error? }`.

- [ ] **Step 1: Write the failing test**

Create `test/catalyst-center-executor.test.cjs`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCatalystCenterExecutor } = require("../electron/sources/executors/catalyst-center-executor.cjs");

const device = { id: "u1", name: "sw1", platform: "ios-xe", executor: "catalyst-center" };

test("runReadOnly returns per-command output for the device", async () => {
  const catc = { runCommands: async (uuids, commands) => ({ sw1: { [commands[0]]: "VLAN Name ..." } }) };
  const exec = createCatalystCenterExecutor({ catc });
  const r = await exec.runReadOnly(device, ["show vlan brief"]);
  assert.equal(r.ok, true);
  assert.equal(r.host, "sw1");
  assert.match(r.outputs["show vlan brief"], /VLAN Name/);
});

test("rejects a non-read-only command before calling the device", async () => {
  let called = false;
  const catc = { runCommands: async () => { called = true; return {}; } };
  const exec = createCatalystCenterExecutor({ catc });
  const r = await exec.runReadOnly(device, ["configure terminal"]);
  assert.equal(r.ok, false);
  assert.equal(called, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `electron/sources/executors/catalyst-center-executor.cjs`:
```js
const { assertReadOnly } = require("../../core/read-only-policy.cjs");

function createCatalystCenterExecutor({ catc }) {
  function supports(device) {
    return device && device.executor === "catalyst-center";
  }
  async function runReadOnly(device, commands) {
    for (const command of commands) {
      const verdict = assertReadOnly(device.platform || "ios-xe", command);
      if (!verdict.ok) return { host: device.name, outputs: {}, ok: false, error: verdict.error };
    }
    try {
      const result = await catc.runCommands([device.id], commands);
      const outputs = result[device.name] || result[device.id] || {};
      return { host: device.name, outputs, ok: true };
    } catch (error) {
      return { host: device.name, outputs: {}, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { supports, runReadOnly };
}

module.exports = { createCatalystCenterExecutor };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/sources/executors/catalyst-center-executor.cjs test/catalyst-center-executor.test.cjs
git commit -m "feat: Catalyst Center Command Runner executor"
```

---

### Task 7: SSH Executor

**Files:**
- Modify: `package.json` (add `ssh2`), `.env.example`
- Create: `electron/sources/executors/ssh-executor.cjs`
- Test: `test/ssh-executor.test.cjs`

**Interfaces:**
- Consumes: `ssh2` `Client`; `assertReadOnly` (Task 3); env `SSH_SANDBOX_HOST/PORT/USER/PASS`, optional `SSH_JUMP_HOST/USER/PASS`.
- Produces: `createSshExecutor({ connect }) → Executor`. `connect` is injected (real `ssh2` in prod, a fake in tests). `supports(device)` true when `device.executor === "ssh"`. `runReadOnly(device, commands)` opens a session (via jump host if configured), runs each command, returns `{ host, outputs, ok, error? }`.

- [ ] **Step 1: Add the dependency**

Run: `npm install ssh2`
Expected: `ssh2` added to `package.json` dependencies.

- [ ] **Step 2: Document env in `.env.example`**

Append:
```bash
# SSH executor (Phase 1 validation target: Cisco always-on IOS-XE sandbox).
# Launch it from devnetsandbox.cisco.com to get current credentials.
#SSH_SANDBOX_HOST=sandbox-iosxe-latest-1.cisco.com
#SSH_SANDBOX_PORT=22
#SSH_SANDBOX_USER=your_dynamic_user
#SSH_SANDBOX_PASS=your_dynamic_pass
# Optional jump host / bastion in front of devices:
#SSH_JUMP_HOST=
#SSH_JUMP_USER=
#SSH_JUMP_PASS=
```

- [ ] **Step 3: Write the failing test** (inject a fake `connect` — no real SSH)

Create `test/ssh-executor.test.cjs`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSshExecutor } = require("../electron/sources/executors/ssh-executor.cjs");

const device = { id: "r1", name: "csr1", mgmtIp: "10.0.0.1", platform: "ios-xe", executor: "ssh" };

// Fake transport: returns canned CLI text per command.
const fakeConnect = async () => ({
  exec: async (command) => `output for: ${command}`,
  close: () => {},
});

test("runs read-only commands over the injected transport", async () => {
  const exec = createSshExecutor({ connect: fakeConnect });
  const r = await exec.runReadOnly(device, ["show version"]);
  assert.equal(r.ok, true);
  assert.equal(r.host, "csr1");
  assert.match(r.outputs["show version"], /output for: show version/);
});

test("blocks a mutating command before connecting", async () => {
  let connected = false;
  const exec = createSshExecutor({ connect: async () => { connected = true; return { exec: async () => "", close() {} }; } });
  const r = await exec.runReadOnly(device, ["reload"]);
  assert.equal(r.ok, false);
  assert.equal(connected, false);
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement**

Create `electron/sources/executors/ssh-executor.cjs`:
```js
// SSH executor: runs read-only CLI on a real device, optionally through a jump
// host. The transport is injected as `connect(device)` so the logic is unit-
// testable without a live device; the default transport uses ssh2.
const { assertReadOnly } = require("../../core/read-only-policy.cjs");

function defaultConnect() {
  // Lazy-require so the module loads without ssh2 present (tests inject connect).
  const { Client } = require("ssh2");
  return async function connect(device) {
    const conn = await dial({
      host: process.env.SSH_JUMP_HOST || device.mgmtIp || process.env.SSH_SANDBOX_HOST,
      port: Number(process.env.SSH_SANDBOX_PORT || 22),
      username: process.env.SSH_JUMP_USER || process.env.SSH_SANDBOX_USER,
      password: process.env.SSH_JUMP_PASS || process.env.SSH_SANDBOX_PASS,
    }, Client);
    // NOTE: a real jump-host hop would open a forwarded channel to device.mgmtIp
    // here; for the single-sandbox Phase 1 target we connect directly.
    return {
      exec: (command) => new Promise((resolve, reject) => {
        conn.exec(command, (err, stream) => {
          if (err) return reject(err);
          let out = "";
          stream.on("data", (d) => (out += d)).on("close", () => resolve(out)).stderr.on("data", (d) => (out += d));
        });
      }),
      close: () => conn.end(),
    };
  };
}

function dial(opts, Client) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on("ready", () => resolve(conn)).on("error", reject).connect({ ...opts, readyTimeout: 20000 });
  });
}

function createSshExecutor({ connect = defaultConnect() } = {}) {
  function supports(device) {
    return device && device.executor === "ssh";
  }
  async function runReadOnly(device, commands) {
    for (const command of commands) {
      const verdict = assertReadOnly(device.platform || "ios-xe", command);
      if (!verdict.ok) return { host: device.name, outputs: {}, ok: false, error: verdict.error };
    }
    let session;
    try {
      session = await connect(device);
      const outputs = {};
      for (const command of commands) outputs[command] = await session.exec(command);
      return { host: device.name, outputs, ok: true };
    } catch (error) {
      return { host: device.name, outputs: {}, ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (session) session.close();
    }
  }
  return { supports, runReadOnly };
}

module.exports = { createSshExecutor };
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test`
Expected: PASS (unit tests use the fake transport; no real SSH needed).

- [ ] **Step 7: (Optional, manual) Live-SSH smoke test**

With `SSH_SANDBOX_*` set in `.env.local`, run this one-off:
```bash
node -e "require('dotenv').config({path:'.env.local'});const {createSshExecutor}=require('./electron/sources/executors/ssh-executor.cjs');createSshExecutor().runReadOnly({name:'csr1',mgmtIp:process.env.SSH_SANDBOX_HOST,platform:'ios-xe',executor:'ssh'},['show version']).then(r=>console.log(r.ok,Object.keys(r.outputs),r.error))"
```
Expected: `true [ 'show version' ] undefined` (real IOS-XE version output). If creds are dead, relaunch the sandbox from devnetsandbox.cisco.com. This step is skipped in `npm test`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .env.example electron/sources/executors/ssh-executor.cjs test/ssh-executor.test.cjs
git commit -m "feat: SSH executor (ssh2) with injectable transport; gated live test"
```

---

### Task 8: Source Registry

**Files:**
- Create: `electron/core/source-registry.cjs`
- Test: `test/source-registry.test.cjs`

**Interfaces:**
- Consumes: `Source` objects (`{ id, domain, inventory, executor }`).
- Produces: `createRegistry() → { register(source), list(), executorFor(device), allDevices(), health() }`. `executorFor(device)` returns the executor whose `supports(device)` is true.

- [ ] **Step 1: Write the failing test**

Create `test/source-registry.test.cjs`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRegistry } = require("../electron/core/source-registry.cjs");

const src = {
  id: "catc-sandbox", domain: "data",
  inventory: { search: async () => [{ id: "1", name: "sw1", executor: "catalyst-center" }], health: async () => ({ ok: true, reachable: true }) },
  executor: { supports: (d) => d.executor === "catalyst-center", runReadOnly: async () => ({ ok: true, host: "sw1", outputs: {} }) },
};

test("aggregates devices across sources", async () => {
  const reg = createRegistry();
  reg.register(src);
  const devices = await reg.allDevices();
  assert.deepEqual(devices.map((d) => d.name), ["sw1"]);
});

test("finds the executor that supports a device", () => {
  const reg = createRegistry();
  reg.register(src);
  const exec = reg.executorFor({ executor: "catalyst-center" });
  assert.equal(typeof exec.runReadOnly, "function");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `electron/core/source-registry.cjs`:
```js
function createRegistry() {
  const sources = [];
  function register(source) { sources.push(source); return source; }
  function list() { return sources.slice(); }
  async function allDevices() {
    const lists = await Promise.all(sources.map(async (s) => {
      try { return await s.inventory.search(); } catch { return []; }
    }));
    return lists.flat();
  }
  function executorFor(device) {
    const source = sources.find((s) => s.executor.supports(device));
    return source ? source.executor : null;
  }
  async function health() {
    return Promise.all(sources.map(async (s) => ({ id: s.id, domain: s.domain, ...(await s.inventory.health()) })));
  }
  return { register, list, allDevices, executorFor, health };
}

module.exports = { createRegistry };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/core/source-registry.cjs test/source-registry.test.cjs
git commit -m "feat: source registry (device aggregation + executor routing)"
```

---

### Task 9: Network Query Layer

**Files:**
- Create: `electron/core/query-layer.cjs`
- Test: `test/query-layer.test.cjs`

**Interfaces:**
- Consumes: a registry (Task 8), `resolveScope` (Task 4).
- Produces: `createQueryLayer({ registry, config }) → { resolveScope(text), run(text, commands) }`.
  - `config = { interactiveCap: 25, hardCap: 500, concurrency: 10 }` (defaults).
  - `resolveScope(text) → { devices, total, capped, exceededHardCap }`.
  - `run(text, commands) → { ok, devices, results:[{host, outputs, ok, error?}], capped, error? }`. Refuses when scope is empty or exceeds `hardCap`; runs executors with bounded concurrency.

- [ ] **Step 1: Write the failing test**

Create `test/query-layer.test.cjs`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createQueryLayer } = require("../electron/core/query-layer.cjs");

function fixtureRegistry(devices) {
  const executor = { supports: () => true, runReadOnly: async (d, cmds) => ({ host: d.name, ok: true, outputs: { [cmds[0]]: `${d.name}:${cmds[0]}` } }) };
  return { allDevices: async () => devices, executorFor: () => executor };
}
const DEV = [
  { id: "1", name: "sw1", mgmtIp: "10.0.0.1", role: "access", site: "dc3", executor: "x" },
  { id: "2", name: "sw2", mgmtIp: "10.0.0.2", role: "access", site: "dc3", executor: "x" },
];

test("runs a read-only command against the resolved scope", async () => {
  const ql = createQueryLayer({ registry: fixtureRegistry(DEV) });
  const r = await ql.run("show version on sw1", ["show version"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.results.map((x) => x.host), ["sw1"]);
});

test("refuses when nothing resolves", async () => {
  const ql = createQueryLayer({ registry: fixtureRegistry(DEV) });
  const r = await ql.run("show version on nonexistent-device", ["show version"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /narrow|no devices|scope/i);
});

test("refuses above the hard cap", async () => {
  const many = Array.from({ length: 600 }, (_, i) => ({ id: String(i), name: `sw${i}`, role: "access", site: "dc3", executor: "x" }));
  const ql = createQueryLayer({ registry: fixtureRegistry(many), config: { hardCap: 500 } });
  const r = await ql.run("show version on the access switches in dc3", ["show version"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /500|too many|narrow/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `electron/core/query-layer.cjs`:
```js
const { resolveScope } = require("./scope-resolver.cjs");

const DEFAULTS = { interactiveCap: 25, hardCap: 500, concurrency: 10 };

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function createQueryLayer({ registry, config = {} }) {
  const cfg = { ...DEFAULTS, ...config };

  async function resolveScopeText(text) {
    const devices = await registry.allDevices();
    const scoped = resolveScope(text, devices, { cap: cfg.interactiveCap });
    return { ...scoped, exceededHardCap: scoped.total > cfg.hardCap };
  }

  async function run(text, commands) {
    const scope = await resolveScopeText(text);
    if (scope.total === 0) {
      return { ok: false, error: "No devices matched that scope. Name a device, role, or site to narrow it.", devices: [], results: [] };
    }
    if (scope.exceededHardCap) {
      return { ok: false, error: `That matches ${scope.total} devices — over the ${cfg.hardCap} safety limit. Please narrow the scope.`, devices: [], results: [] };
    }
    const results = await mapLimit(scope.devices, cfg.concurrency, async (device) => {
      const executor = registry.executorFor(device);
      if (!executor) return { host: device.name, ok: false, outputs: {}, error: `No executor for ${device.name}.` };
      return executor.runReadOnly(device, commands);
    });
    return { ok: true, devices: scope.devices, results, capped: scope.capped, total: scope.total };
  }

  return { resolveScope: resolveScopeText, run };
}

module.exports = { createQueryLayer, DEFAULTS };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/core/query-layer.cjs test/query-layer.test.cjs
git commit -m "feat: network query layer (scope-first, capped, concurrent)"
```

---

### Task 10: Remove the fake simulator; honest-unreachable

**Files:**
- Delete: `electron/network-data.cjs`
- Modify: `electron/network-source.cjs`, `electron/tools.cjs`
- Modify: `src/components/OpsDashboard.tsx`
- Test: `test/network-source.test.cjs`

**Interfaces:**
- Consumes: the registry + query layer (Tasks 8–9), `catalyst-center.cjs`.
- Produces: `network-source.getSnapshot()` returns a **real** snapshot or `{ reachable:false, mode:"unreachable", error, updatedAt }` — never sim data. `getMode()` returns `"live" | "unreachable"`.

- [ ] **Step 1: Write the failing test**

Create `test/network-source.test.cjs`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");

test("getSnapshot reports unreachable honestly when the source is down", async () => {
  process.env.NETJARVIS_SOURCE = "live";
  const source = require("../electron/network-source.cjs");
  // Force the CATC health to fail by pointing at an unroutable host.
  process.env.CATC_BASE_URL = "https://127.0.0.1:1"; // nothing listening
  const snap = await source.getSnapshot(true);
  assert.equal(snap.reachable, false);
  assert.equal(snap.mode, "unreachable");
  assert.ok(snap.error);
  // Must NOT contain fabricated device data.
  assert.ok(!Array.isArray(snap.devices) || snap.devices.length === 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — current code falls back to sim (`snap.mode === "sim"` with fake devices), so the assertions fail.

- [ ] **Step 3: Remove the simulator and the sim branch**

- Delete `electron/network-data.cjs`.
- In `electron/network-source.cjs`: remove the `require("./network-data.cjs")` and the `sim` export; in `resolveMode()`/`getSnapshot()` remove the sim fallback so that when live is unreachable it returns `{ reachable:false, mode:"unreachable", error, updatedAt:new Date().toISOString(), devices:[], links:[], issues:{active:0,items:[]}, events:[], health:{score:null} }`. `getMode()` returns `{ mode:"unreachable" }` on failure. Keep the reachable/live path intact.

- [ ] **Step 4: Remove sim branches in tools.cjs**

In `electron/tools.cjs`, delete each `if (mode === "live") { … } <sim else> …` so only the live path remains; where a tool previously had a sim-only behavior (`acknowledge_alert` sim path, `bgp_status`/`ospf_status`/`traffic_report`/`drop_report` sim branches), replace the sim branch with an honest `return { ok:false, error:"Network source is unreachable." }` when `mode !== "live"`. (These already exist as live CLI paths; only the sim `else` is removed.)

- [ ] **Step 5: Update the dashboard badge**

In `src/components/OpsDashboard.tsx`, change the LIVE/SIM badge: render `LIVE` when `snapshot.reachable !== false`, else `UNREACHABLE` (amber/red styling) with the `snapshot.error` text and a "retrying…" note. Do not render device tiles when unreachable.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. `network-data.cjs` is gone; `getSnapshot` is honest.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: remove fake simulator; honest unreachable state"
```

---

### Task 11: Route tools + device extraction through the Query Layer

**Files:**
- Modify: `electron/tools.cjs` (wire the registry + query layer into `createTools`), `electron/message-router.cjs`, `electron/device-facts.cjs`
- Test: `test/query-layer.integration.test.cjs`

**Interfaces:**
- Consumes: `createRegistry`, `createQueryLayer`, `createCatalystCenterInventory`, `createCatalystCenterExecutor`, `createSshExecutor`.
- Produces: inside `createTools`, a singleton query layer; `run_show_command` resolves scope via the layer and runs through executors. `message-router`/`device-facts` device extraction delegates to `scope-resolver` using the live inventory.

- [ ] **Step 1: Write the failing integration test**

Create `test/query-layer.integration.test.cjs`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRegistry } = require("../electron/core/source-registry.cjs");
const { createQueryLayer } = require("../electron/core/query-layer.cjs");
const { createCatalystCenterInventory } = require("../electron/sources/providers/catalyst-center-inventory.cjs");
const { createCatalystCenterExecutor } = require("../electron/sources/executors/catalyst-center-executor.cjs");

test("end-to-end: resolve a name and run a show command via the CATC source", async () => {
  const catc = {
    getInventory: async () => [{ id: "u1", hostname: "sw1", managementIp: "10.10.20.51", role: "ACCESS", softwareType: "IOS-XE" }],
    checkReachable: async () => true,
    runCommands: async (uuids, commands) => ({ sw1: { [commands[0]]: "VLAN0001 default active" } }),
  };
  const registry = createRegistry();
  registry.register({ id: "catc-sandbox", domain: "data", inventory: createCatalystCenterInventory({ catc, sourceId: "catc-sandbox" }), executor: createCatalystCenterExecutor({ catc }) });
  const ql = createQueryLayer({ registry });
  const r = await ql.run("show vlan brief on sw1", ["show vlan brief"]);
  assert.equal(r.ok, true);
  assert.match(r.results[0].outputs["show vlan brief"], /VLAN0001/);
});
```

- [ ] **Step 2: Run to verify it fails, then passes**

Run: `npm test`
Expected: initially PASS for the standalone modules — this test documents the wiring contract used in Step 3. (It exercises real modules with an injected `catc`.)

- [ ] **Step 3: Wire the registry into `createTools`**

In `electron/tools.cjs`, at the top of `createTools`, build the registry + query layer once:
```js
const { createRegistry } = require("./core/source-registry.cjs");
const { createQueryLayer } = require("./core/query-layer.cjs");
const { createCatalystCenterInventory } = require("./sources/providers/catalyst-center-inventory.cjs");
const { createCatalystCenterExecutor } = require("./sources/executors/catalyst-center-executor.cjs");
const { createSshExecutor } = require("./sources/executors/ssh-executor.cjs");
const catc = require("./sources/catalyst-center.cjs");
// ...
const registry = createRegistry();
registry.register({ id: "catc-sandbox", domain: "data", inventory: createCatalystCenterInventory({ catc, sourceId: "catc-sandbox" }), executor: createCatalystCenterExecutor({ catc }) });
if (process.env.SSH_SANDBOX_HOST) {
  registry.register({ id: "iosxe-ssh", domain: "data",
    inventory: { search: async () => [{ id: "csr1", name: "csr1", mgmtIp: process.env.SSH_SANDBOX_HOST, domain: "data", platform: "ios-xe", role: "router", site: "", sourceId: "iosxe-ssh", executor: "ssh" }], health: async () => ({ ok: true, reachable: true }) },
    executor: createSshExecutor() });
}
const queryLayer = createQueryLayer({ registry });
```

- [ ] **Step 4: Route `run_show_command` through the query layer**

In `tools.cjs` `runShowCommand(args)`, replace the direct `source.runLiveShowCommands(...)` call with:
```js
const text = `${(args.commands || []).join(" ")} on ${args.device || ""}`.trim();
const result = args.device
  ? await queryLayer.run(`on ${args.device}`, args.commands.map(String))
  : await queryLayer.run(text, args.commands.map(String));
if (!result.ok) return { ok: false, error: result.error };
const outputs = {};
for (const r of result.results) outputs[r.host] = r.outputs;
// then format `outputs` exactly as today (formatCliOutputs/trimOutputs)
```
Keep the existing artifact/formatting code below unchanged.

- [ ] **Step 5: Delegate device extraction to the scope resolver**

In `electron/device-facts.cjs`, replace the hardcoded `swN` regex in `extractDevicesFromText` with a call that matches against the live inventory: accept an optional `devices` list and use `resolveScope(text, devices).devices.map(d => d.name)`; when no inventory is passed, fall back to the old regex for safety. Update `message-router.cjs` callers to pass the current inventory where available.

- [ ] **Step 6: Run tests + typecheck + behavior cycle**

Run: `npm test && npm run typecheck && npm run test:behavior`
Expected: PASS. Behavior cycle still exercises real tools (against live CATC or an honest-unreachable error).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: route run_show_command and device extraction through the query layer"
```

---

## Self-review notes

- **Spec coverage:** interfaces (§5) → Tasks 2,5,6,7,8,9; two-plane model (§3) → Tasks 5–9; scale caps (§6) → Tasks 3,4,9; real-only (§7) → Task 10; code-mapping (§8) → Tasks 3,10,11; SSH executor (§9, Q3) → Task 7. Frontend polish beyond the reachability badge (dead-code removal, topology rendering) is **deferred to Plan 1C** — noted so it isn't assumed done here.
- **Deferred to later phases (not in this plan):** inventory search/pagination for large estates (Phase 2), real jump-host channel forwarding (Task 7 connects directly for the single sandbox; multi-hop is Phase 4), multi-domain sources (Phase 3).
- **Types:** `Device`, `runReadOnly({host,outputs,ok,error})`, `executorFor`, `resolveScope({devices,total,capped})` are consistent across Tasks 2–11.

## Execution handoff

Phase 1 backend foundation is 11 tasks, each independently testable with `npm test`. Frontend polish (1C) and real jump-host multi-hop (Phase 4) are explicitly out of scope here.
</content>
