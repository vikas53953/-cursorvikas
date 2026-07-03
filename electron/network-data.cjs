// NetJarvis network data layer.
//
// This module is the single source of network state for every NetJarvis tool.
// It ships with a deterministic simulator that models a realistic dual-site
// service-provider style network (2 cores, 4 edges, 2 distribution switches,
// 2 firewalls, dual ISP transit + one IX peering) and injects a handful of
// "overnight" incidents so shift-start questions have meaningful answers.
//
// To connect a real network, replace the exported functions with adapters that
// pull from your actual sources (SNMP, gNMI/streaming telemetry, Prometheus,
// NetBox, syslog, your alert manager). The function contracts are plain JSON,
// so the Electron main process and the voice model never need to change.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Deterministic PRNG so numbers stay stable during a shift (same day = same data).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function daySeed() {
  const now = new Date();
  return now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
}

function rng(stream) {
  return mulberry32(daySeed() * 977 + stream * 7919);
}

// Returns a Date for the most recent occurrence of hh:mm local time.
function lastClock(hh, mm) {
  const at = new Date();
  at.setHours(hh, mm, 0, 0);
  if (at.getTime() > Date.now()) at.setTime(at.getTime() - 24 * HOUR);
  return at;
}

function hhmm(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function agoLabel(date) {
  const ms = Date.now() - date.getTime();
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m ago`;
  if (ms < 24 * HOUR) return `${(ms / HOUR).toFixed(1)}h ago`;
  return `${Math.round(ms / (24 * HOUR))}d ago`;
}

function uptimeLabel(sinceMs) {
  const ms = Date.now() - sinceMs;
  const days = Math.floor(ms / (24 * HOUR));
  const hours = Math.floor((ms % (24 * HOUR)) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

const DEVICES = [
  { id: "core-r1", name: "CORE-R1", role: "core", platform: "Cisco 8201-32FH", os: "IOS XR 24.4", site: "DC-EAST", loopback: "10.255.0.1", uptimeDays: 214 },
  { id: "core-r2", name: "CORE-R2", role: "core", platform: "Cisco 8201-32FH", os: "IOS XR 24.4", site: "DC-WEST", loopback: "10.255.0.2", uptimeDays: 187 },
  { id: "edge-r1", name: "EDGE-R1", role: "edge", platform: "Juniper MX304", os: "Junos 23.4R2", site: "DC-EAST", loopback: "10.255.1.1", uptimeDays: 133 },
  { id: "edge-r2", name: "EDGE-R2", role: "edge", platform: "Juniper MX304", os: "Junos 23.4R2", site: "DC-EAST", loopback: "10.255.1.2", uptimeDays: 121 },
  { id: "edge-r3", name: "EDGE-R3", role: "edge", platform: "Juniper MX304", os: "Junos 23.4R2", site: "DC-WEST", loopback: "10.255.1.3", uptimeDays: 89 },
  { id: "edge-r4", name: "EDGE-R4", role: "edge", platform: "Juniper MX304", os: "Junos 23.4R2", site: "DC-WEST", loopback: "10.255.1.4", uptimeDays: 89 },
  { id: "dist-sw1", name: "DIST-SW1", role: "distribution", platform: "Cisco Nexus 93180YC-FX3", os: "NX-OS 10.4", site: "DC-EAST", loopback: "10.255.2.1", uptimeDays: 240 },
  { id: "dist-sw2", name: "DIST-SW2", role: "distribution", platform: "Cisco Nexus 93180YC-FX3", os: "NX-OS 10.4", site: "DC-WEST", loopback: "10.255.2.2", uptimeDays: 238 },
  { id: "fw-1", name: "FW-1", role: "firewall", platform: "Palo Alto PA-5450", os: "PAN-OS 11.2", site: "DC-EAST", loopback: "10.255.3.1", uptimeDays: 96 },
  { id: "fw-2", name: "FW-2", role: "firewall", platform: "Palo Alto PA-5450", os: "PAN-OS 11.2", site: "DC-WEST", loopback: "10.255.3.2", uptimeDays: 96 },
];

function findDevice(query) {
  const normalized = String(query || "").trim().toLowerCase().replace(/\s+/g, "-");
  if (!normalized) return null;
  return (
    DEVICES.find((device) => device.id === normalized || device.name.toLowerCase() === normalized) ||
    DEVICES.find((device) => device.id.includes(normalized) || device.name.toLowerCase().includes(normalized)) ||
    null
  );
}

// ---------------------------------------------------------------------------
// Overnight incident anchors (stable clock times, so "overnight" always works)
// ---------------------------------------------------------------------------

function incidents() {
  const bgpFlapStart = lastClock(2, 13);
  const bgpFlapEnd = lastClock(2, 31);
  const crcStart = lastClock(3, 40);
  const psuStart = lastClock(23, 5);
  const anomalyStart = new Date(Date.now() - 70 * MINUTE);
  return { bgpFlapStart, bgpFlapEnd, crcStart, psuStart, anomalyStart };
}

function crcErrorCount() {
  const { crcStart } = incidents();
  const minutes = Math.max(0, (Date.now() - crcStart.getTime()) / MINUTE);
  return Math.round(minutes * 43);
}

// ---------------------------------------------------------------------------
// Alerts and events
// ---------------------------------------------------------------------------

function buildAlerts() {
  const { bgpFlapStart, bgpFlapEnd, crcStart, psuStart, anomalyStart } = incidents();
  return [
    {
      id: "ALM-2481",
      severity: "major",
      state: "cleared",
      device: "EDGE-R3",
      title: "BGP session flap to Arelion AS1299",
      detail: `eBGP session to Arelion (AS1299) flapped twice between ${hhmm(bgpFlapStart)} and ${hhmm(bgpFlapEnd)}. Session re-established at ${hhmm(bgpFlapEnd)} and has been stable since. 348k prefixes relearned. Traffic failed over to EDGE-R4 during the event with no customer impact detected.`,
      raisedAt: bgpFlapStart.toISOString(),
      clearedAt: bgpFlapEnd.toISOString(),
    },
    {
      id: "ALM-2483",
      severity: "warning",
      state: "active",
      device: "EDGE-R2",
      title: "CRC errors incrementing on xe-0/1/3",
      detail: `Input CRC errors on EDGE-R2 xe-0/1/3 (100G link to CORE-R1) started at ${hhmm(crcStart)} and are still incrementing at roughly 40-45/min (${crcErrorCount().toLocaleString()} total). Pattern suggests a degrading optic or dirty fiber. Recommend cleaning/reseating the optic or moving traffic and replacing it.`,
      raisedAt: crcStart.toISOString(),
      clearedAt: null,
    },
    {
      id: "ALM-2479",
      severity: "warning",
      state: "active",
      device: "DIST-SW2",
      title: "Power supply PSU-2 degraded",
      detail: `PSU-2 on DIST-SW2 reported degraded output at ${hhmm(psuStart)}. The switch is running on PSU-1 without redundancy. A replacement should be scheduled; no traffic impact.`,
      raisedAt: psuStart.toISOString(),
      clearedAt: null,
    },
    {
      id: "ALM-2486",
      severity: "notice",
      state: "active",
      device: "EDGE-R1",
      title: "Inbound traffic anomaly on transit uplink",
      detail: `Inbound traffic on EDGE-R1 xe-0/0/0 (Lumen transit) is running about 38% above the same-hour baseline since ${hhmm(anomalyStart)}. Flow data points at a large CDN content pull toward the DC-EAST server ranges. Utilization is at a safe level; worth watching, not acting.`,
      raisedAt: anomalyStart.toISOString(),
      clearedAt: null,
    },
  ];
}

function buildEvents() {
  const { bgpFlapStart, bgpFlapEnd, crcStart, psuStart, anomalyStart } = incidents();
  const backup = lastClock(1, 0);
  const ntp = lastClock(0, 15);
  const events = [
    { at: psuStart, severity: "warning", device: "DIST-SW2", text: "PSU-2 output degraded; running non-redundant on PSU-1 (ALM-2479)." },
    { at: ntp, severity: "info", device: "ALL", text: "NTP health check passed on all 10 devices; max offset 3.1 ms." },
    { at: backup, severity: "info", device: "ALL", text: "Nightly config backups completed: 10/10 devices archived to the config repo." },
    { at: bgpFlapStart, severity: "major", device: "EDGE-R3", text: "BGP session to Arelion AS1299 went Idle; hold timer expired (ALM-2481)." },
    { at: new Date(bgpFlapStart.getTime() + 6 * MINUTE), severity: "major", device: "EDGE-R3", text: "BGP session to Arelion AS1299 flapped again after brief re-establish." },
    { at: bgpFlapEnd, severity: "info", device: "EDGE-R3", text: "BGP session to Arelion AS1299 re-established; 348k prefixes relearned, stable since." },
    { at: crcStart, severity: "warning", device: "EDGE-R2", text: "Input CRC errors started incrementing on xe-0/1/3 toward CORE-R1 (ALM-2483)." },
    { at: anomalyStart, severity: "notice", device: "EDGE-R1", text: "Traffic anomaly: inbound on Lumen transit ~38% above same-hour baseline (ALM-2486)." },
  ];
  return events.sort((a, b) => b.at.getTime() - a.at.getTime());
}

function getEvents(windowHours) {
  const hours = clampHours(windowHours, 12);
  const cutoff = Date.now() - hours * HOUR;
  return buildEvents()
    .filter((event) => event.at.getTime() >= cutoff)
    .map((event) => ({
      time: hhmm(event.at),
      when: agoLabel(event.at),
      severity: event.severity,
      device: event.device,
      event: event.text,
    }));
}

function getAlerts(includeCleared, ackedIds) {
  const acked = new Set(ackedIds || []);
  return buildAlerts()
    .filter((alert) => includeCleared || alert.state === "active")
    .map((alert) => ({
      ...alert,
      acknowledged: acked.has(alert.id),
      raised: `${hhmm(new Date(alert.raisedAt))} (${agoLabel(new Date(alert.raisedAt))})`,
    }));
}

function findAlert(id) {
  const normalized = String(id || "").trim().toUpperCase();
  return buildAlerts().find((alert) => alert.id === normalized) || null;
}

function clampHours(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(24, Math.max(1, num));
}

// ---------------------------------------------------------------------------
// BGP
// ---------------------------------------------------------------------------

function bgpSessions() {
  const { bgpFlapEnd } = incidents();
  const random = rng(11);
  const jitter = (base, spread) => Math.round(base + (random() - 0.5) * spread);

  const ebgp = [
    { device: "EDGE-R1", peer: "Lumen", peerAs: 3356, type: "eBGP transit", sinceMs: Date.now() - 43 * 24 * HOUR, prefixes: jitter(998400, 3000) },
    { device: "EDGE-R2", peer: "Lumen", peerAs: 3356, type: "eBGP transit", sinceMs: Date.now() - 43 * 24 * HOUR, prefixes: jitter(998100, 3000) },
    { device: "EDGE-R3", peer: "Arelion", peerAs: 1299, type: "eBGP transit", sinceMs: bgpFlapEnd.getTime(), prefixes: jitter(348200, 1500), flaps24h: 2 },
    { device: "EDGE-R4", peer: "Arelion", peerAs: 1299, type: "eBGP transit", sinceMs: Date.now() - 61 * 24 * HOUR, prefixes: jitter(348500, 1500) },
    { device: "EDGE-R1", peer: "Hurricane Electric (IX)", peerAs: 6939, type: "eBGP peering", sinceMs: Date.now() - 112 * 24 * HOUR, prefixes: jitter(171900, 900) },
  ];

  const ibgp = [];
  for (const edge of ["EDGE-R1", "EDGE-R2", "EDGE-R3", "EDGE-R4"]) {
    for (const core of ["CORE-R1", "CORE-R2"]) {
      ibgp.push({
        device: edge,
        peer: `${core} (RR)`,
        peerAs: 64512,
        type: "iBGP",
        sinceMs: Date.now() - 80 * 24 * HOUR,
        prefixes: jitter(1240, 30),
      });
    }
  }

  return [...ebgp, ...ibgp].map((session) => ({
    device: session.device,
    peer: session.peer,
    asn: `AS${session.peerAs}`,
    type: session.type,
    state: "Established",
    uptime: uptimeLabel(session.sinceMs),
    prefixesReceived: session.prefixes,
    flaps24h: session.flaps24h || 0,
  }));
}

function getBgpStatus(deviceQuery) {
  let sessions = bgpSessions();
  let scope = "all routers";
  if (deviceQuery) {
    const device = findDevice(deviceQuery);
    if (device) {
      sessions = sessions.filter((session) => session.device === device.name);
      scope = device.name;
    }
  }
  const flapped = sessions.filter((session) => session.flaps24h > 0);
  return {
    scope,
    totalSessions: sessions.length,
    established: sessions.filter((session) => session.state === "Established").length,
    down: sessions.filter((session) => session.state !== "Established").length,
    flapsLast24h: flapped.reduce((sum, session) => sum + session.flaps24h, 0),
    flappedSessions: flapped.map((session) => `${session.device} to ${session.peer} ${session.asn} (${session.flaps24h} flaps, up ${session.uptime})`),
    sessions,
  };
}

// ---------------------------------------------------------------------------
// OSPF
// ---------------------------------------------------------------------------

function getOspfStatus() {
  const pairs = [
    ["CORE-R1", "CORE-R2", 0],
    ["CORE-R1", "EDGE-R1", 0],
    ["CORE-R1", "EDGE-R2", 0],
    ["CORE-R1", "EDGE-R3", 0],
    ["CORE-R1", "EDGE-R4", 0],
    ["CORE-R2", "EDGE-R1", 0],
    ["CORE-R2", "EDGE-R2", 0],
    ["CORE-R2", "EDGE-R3", 0],
    ["CORE-R2", "EDGE-R4", 0],
    ["CORE-R1", "DIST-SW1", 1],
    ["CORE-R2", "DIST-SW2", 1],
    ["DIST-SW1", "DIST-SW2", 1],
  ];
  const random = rng(23);
  const neighbors = pairs.map(([a, b, area]) => ({
    device: a,
    neighbor: b,
    area: String(area),
    state: "FULL",
    lastChange: `${Math.round(20 + random() * 60)}d ago`,
    events24h: 0,
  }));
  return {
    totalAdjacencies: neighbors.length,
    full: neighbors.length,
    down: 0,
    adjacencyChanges24h: 0,
    areas: { "0": neighbors.filter((n) => n.area === "0").length, "1": neighbors.filter((n) => n.area === "1").length },
    neighbors,
  };
}

// ---------------------------------------------------------------------------
// Device health
// ---------------------------------------------------------------------------

function deviceAlertMap(ackedIds) {
  const map = new Map();
  for (const alert of getAlerts(false, ackedIds)) {
    const list = map.get(alert.device) || [];
    list.push(alert);
    map.set(alert.device, list);
  }
  return map;
}

function getDeviceHealth(roleOrDevice, ackedIds) {
  const random = rng(31);
  const alerts = deviceAlertMap(ackedIds);
  let devices = DEVICES;
  let scope = "all devices";

  const filter = String(roleOrDevice || "").trim().toLowerCase();
  if (filter) {
    if (["core", "edge", "distribution", "firewall"].includes(filter)) {
      devices = DEVICES.filter((device) => device.role === filter);
      scope = `${filter} devices`;
    } else {
      const device = findDevice(filter);
      if (device) {
        devices = [device];
        scope = device.name;
      }
    }
  }

  const rows = devices.map((device) => {
    const deviceAlerts = alerts.get(device.name) || [];
    const worst = deviceAlerts.some((alert) => alert.severity === "major" || alert.severity === "critical")
      ? "critical"
      : deviceAlerts.some((alert) => alert.severity === "warning")
        ? "warning"
        : deviceAlerts.length > 0
          ? "watch"
          : "ok";
    return {
      device: device.name,
      role: device.role,
      site: device.site,
      platform: device.platform,
      status: worst,
      cpu: `${Math.round(8 + random() * 22)}%`,
      memory: `${Math.round(34 + random() * 26)}%`,
      temperature: `${Math.round(38 + random() * 14)}C`,
      uptime: `${device.uptimeDays}d`,
      activeAlerts: deviceAlerts.map((alert) => `${alert.id} ${alert.title}`).join("; ") || "none",
    };
  });

  return { scope, devices: rows };
}

// ---------------------------------------------------------------------------
// Interfaces, traffic, drops
// ---------------------------------------------------------------------------

function hourLoadFactor(date) {
  // Simple diurnal curve: trough ~04:00, peak ~20:00.
  const hour = date.getHours() + date.getMinutes() / 60;
  return 0.55 + 0.45 * Math.sin(((hour - 10) / 24) * 2 * Math.PI);
}

function interfaceTable() {
  const { anomalyStart } = incidents();
  const random = rng(47);
  const load = hourLoadFactor(new Date());
  const anomalyActive = Date.now() >= anomalyStart.getTime();

  const defs = [
    { device: "EDGE-R1", name: "xe-0/0/0", desc: "Transit: Lumen AS3356", speedG: 100, base: 0.42, anomaly: anomalyActive ? 1.38 : 1 },
    { device: "EDGE-R1", name: "xe-0/0/1", desc: "Peering: HE IX AS6939", speedG: 100, base: 0.3 },
    { device: "EDGE-R2", name: "xe-0/0/0", desc: "Transit: Lumen AS3356", speedG: 100, base: 0.38 },
    { device: "EDGE-R2", name: "xe-0/1/3", desc: "Core link: CORE-R1", speedG: 100, base: 0.33, crc: true },
    { device: "EDGE-R3", name: "xe-0/0/0", desc: "Transit: Arelion AS1299", speedG: 100, base: 0.36 },
    { device: "EDGE-R4", name: "xe-0/0/0", desc: "Transit: Arelion AS1299", speedG: 100, base: 0.34 },
    { device: "CORE-R1", name: "FourHundredGigE0/0/0/0", desc: "Core link: CORE-R2", speedG: 400, base: 0.31 },
    { device: "CORE-R1", name: "HundredGigE0/0/0/4", desc: "Down link: DIST-SW1", speedG: 100, base: 0.28 },
    { device: "CORE-R2", name: "HundredGigE0/0/0/4", desc: "Down link: DIST-SW2", speedG: 100, base: 0.27, microburst: true },
    { device: "FW-1", name: "ethernet1/1", desc: "Inside: DIST-SW1", speedG: 40, base: 0.24 },
    { device: "FW-2", name: "ethernet1/1", desc: "Inside: DIST-SW2", speedG: 40, base: 0.22 },
  ];

  return defs.map((def) => {
    const utilization = Math.min(0.94, def.base * load * (def.anomaly || 1) * (0.94 + random() * 0.12));
    const inGbps = utilization * def.speedG;
    const outGbps = utilization * def.speedG * (0.55 + random() * 0.3);
    return {
      device: def.device,
      interface: def.name,
      description: def.desc,
      status: "up",
      speed: `${def.speedG}G`,
      utilization: `${Math.round(utilization * 100)}%`,
      inGbps: Number(inGbps.toFixed(1)),
      outGbps: Number(outGbps.toFixed(1)),
      inErrors24h: def.crc ? crcErrorCount() : 0,
      outDiscards24h: def.microburst ? 2340 : 0,
      note: def.crc
        ? "CRC errors incrementing (ALM-2483)"
        : def.anomaly && def.anomaly > 1
          ? "Inbound ~38% above baseline (ALM-2486)"
          : def.microburst
            ? "Minor microburst output discards"
            : "",
    };
  });
}

function getInterfaceReport(deviceQuery, problemsOnly) {
  let rows = interfaceTable();
  let scope = "key links on all devices";
  if (deviceQuery) {
    const device = findDevice(deviceQuery);
    if (device) {
      rows = rows.filter((row) => row.device === device.name);
      scope = device.name;
    }
  }
  if (problemsOnly) {
    rows = rows.filter((row) => row.inErrors24h > 0 || row.outDiscards24h > 0 || row.status !== "up" || row.note);
    scope += " (problems only)";
  }
  return { scope, interfaces: rows };
}

function getTrafficReport() {
  const rows = interfaceTable();
  const random = rng(59);
  const totalIn = rows.reduce((sum, row) => sum + row.inGbps, 0);
  const totalOut = rows.reduce((sum, row) => sum + row.outGbps, 0);
  const top = [...rows].sort((a, b) => parseInt(b.utilization) - parseInt(a.utilization)).slice(0, 5);
  const anomaly = getAlerts(false, []).find((alert) => alert.id === "ALM-2486") || null;

  return {
    measuredAt: hhmm(new Date()),
    aggregateInGbps: Number(totalIn.toFixed(1)),
    aggregateOutGbps: Number(totalOut.toFixed(1)),
    vsSameHourYesterday: anomaly ? "+11% overall (skewed by the EDGE-R1 transit anomaly)" : `${(random() * 6 - 3).toFixed(1)}% overall`,
    anomalies: anomaly ? [{ alert: anomaly.id, device: anomaly.device, summary: anomaly.detail }] : [],
    busiestLinks: top.map((row) => ({
      device: row.device,
      interface: row.interface,
      description: row.description,
      utilization: row.utilization,
      inGbps: row.inGbps,
      outGbps: row.outGbps,
    })),
  };
}

function getDropReport(windowHours) {
  const hours = clampHours(windowHours, 12);
  const { crcStart } = incidents();
  const rows = [];

  if (Date.now() - crcStart.getTime() <= hours * HOUR + 12 * HOUR) {
    rows.push({
      device: "EDGE-R2",
      interface: "xe-0/1/3",
      kind: "Input CRC errors",
      count: crcErrorCount(),
      startedAt: `${hhmm(crcStart)} (${agoLabel(crcStart)})`,
      assessment: "Active and incrementing. Likely a degrading optic or dirty fiber on the CORE-R1 link. Alert ALM-2483.",
    });
  }
  rows.push({
    device: "CORE-R2",
    interface: "HundredGigE0/0/0/4",
    kind: "Output discards (microbursts)",
    count: 2340,
    startedAt: "spread across the window",
    assessment: "Low-rate microburst discards toward DIST-SW2. Within normal range; no action needed.",
  });
  rows.push({
    device: "FW-1 / FW-2",
    interface: "policy engine",
    kind: "Security policy denies",
    count: 118240,
    startedAt: "continuous",
    assessment: "Expected policy drops (blocked scans and denied flows). Normal volume for this window.",
  });

  return { windowHours: hours, drops: rows };
}

// ---------------------------------------------------------------------------
// Status board, briefing, topology
// ---------------------------------------------------------------------------

function getStatusBoard(ackedIds) {
  const health = getDeviceHealth("", ackedIds);
  const bgp = getBgpStatus("");
  const ospf = getOspfStatus();
  const alerts = getAlerts(false, ackedIds);
  const worst = alerts.some((alert) => alert.severity === "critical" || alert.severity === "major")
    ? "degraded"
    : alerts.length > 0
      ? "watch"
      : "healthy";

  return {
    updatedAt: hhmm(new Date()),
    overall: worst,
    summary: {
      devices: health.devices.length,
      activeAlerts: alerts.length,
      bgpEstablished: `${bgp.established}/${bgp.totalSessions}`,
      ospfFull: `${ospf.full}/${ospf.totalAdjacencies}`,
    },
    tiles: health.devices.map((device) => ({
      id: device.device,
      name: device.device,
      role: device.role,
      site: device.site,
      status: device.status,
      cpu: device.cpu,
      uptime: device.uptime,
      note: device.activeAlerts === "none" ? "" : device.activeAlerts,
    })),
  };
}

function buildShiftBriefing(ackedIds) {
  const now = new Date();
  const alerts = getAlerts(false, ackedIds);
  const events = getEvents(12);
  const bgp = getBgpStatus("");
  const ospf = getOspfStatus();
  const traffic = getTrafficReport();
  const drops = getDropReport(12);
  const activeWarnings = alerts.filter((alert) => alert.severity !== "notice");

  const lines = [];
  lines.push(`# Shift Briefing - ${hhmm(now)}`);
  lines.push("");
  lines.push(`Overall the network is stable. No customer-impacting incidents are open. ${alerts.length} active alert${alerts.length === 1 ? "" : "s"} to be aware of.`);
  lines.push("");
  lines.push("## Overnight headlines");
  lines.push("- EDGE-R3 to Arelion AS1299 flapped twice around 02:13-02:31, re-established and stable since. Traffic failed over to EDGE-R4 cleanly. (cleared, ALM-2481)");
  lines.push(`- EDGE-R2 xe-0/1/3 toward CORE-R1 is taking CRC errors since 03:40, about ${crcErrorCount().toLocaleString()} so far and still incrementing. Suspect optic/fiber. (active, ALM-2483)`);
  lines.push("- DIST-SW2 is running non-redundant: PSU-2 degraded since 23:05. Replacement should be scheduled. (active, ALM-2479)");
  lines.push("- Inbound traffic on EDGE-R1 Lumen transit is ~38% above the same-hour baseline; looks like a CDN content pull, utilization still safe. (watch, ALM-2486)");
  lines.push("");
  lines.push("## Protocol state");
  lines.push(`- BGP: ${bgp.established}/${bgp.totalSessions} sessions Established, ${bgp.flapsLast24h} flap${bgp.flapsLast24h === 1 ? "" : "s"} in the last 24h (all on EDGE-R3/Arelion, recovered).`);
  lines.push(`- OSPF: ${ospf.full}/${ospf.totalAdjacencies} adjacencies FULL, ${ospf.adjacencyChanges24h} changes in the last 24h. Areas 0 and 1 clean.`);
  lines.push("");
  lines.push("## Traffic and drops");
  lines.push(`- Aggregate right now: ${traffic.aggregateInGbps} Gbps in / ${traffic.aggregateOutGbps} Gbps out (${traffic.vsSameHourYesterday}).`);
  lines.push(`- Drops overnight: CRC errors on EDGE-R2 (see above), minor microburst discards on CORE-R2 toward DIST-SW2, and normal firewall policy denies. Nothing customer-facing.`);
  lines.push("");
  lines.push("## Suggested actions");
  lines.push("1. Open a fiber/optic ticket for EDGE-R2 xe-0/1/3 before errors get worse.");
  lines.push("2. Schedule the DIST-SW2 PSU-2 replacement with facilities.");
  lines.push("3. Keep an eye on the EDGE-R1 transit anomaly; escalate only if utilization passes 75%.");
  lines.push("4. No action needed on the Arelion flap, but check the provider maintenance calendar for a root cause.");

  return {
    markdown: lines.join("\n"),
    activeAlerts: alerts.length,
    warnings: activeWarnings.length,
    eventsOvernight: events.length,
    dropSources: drops.drops.length,
  };
}

function topologyMermaid() {
  return [
    "flowchart TD",
    '  ISP1["Lumen AS3356"] --- ER1["EDGE-R1"]',
    '  ISP1 --- ER2["EDGE-R2"]',
    '  IX["HE IX AS6939"] --- ER1',
    '  ISP2["Arelion AS1299"] --- ER3["EDGE-R3"]',
    '  ISP2 --- ER4["EDGE-R4"]',
    '  ER1 --- C1["CORE-R1"]',
    '  ER1 --- C2["CORE-R2"]',
    '  ER2 --- C1',
    '  ER2 --- C2',
    '  ER3 --- C1',
    '  ER3 --- C2',
    '  ER4 --- C1',
    '  ER4 --- C2',
    "  C1 --- C2",
    '  C1 --- D1["DIST-SW1"]',
    '  C2 --- D2["DIST-SW2"]',
    "  D1 --- D2",
    '  D1 --- F1["FW-1"]',
    '  D2 --- F2["FW-2"]',
  ].join("\n");
}

module.exports = {
  DEVICES,
  findDevice,
  findAlert,
  getAlerts,
  getEvents,
  getBgpStatus,
  getOspfStatus,
  getDeviceHealth,
  getInterfaceReport,
  getTrafficReport,
  getDropReport,
  getStatusBoard,
  buildShiftBriefing,
  topologyMermaid,
};
