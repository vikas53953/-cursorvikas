// Labelled mock-lab CLI for when Catalyst Center is down and
// NETJARVIS_EVIDENCE_FIXTURE is on. Never presented as live.

function banner(device) {
  return `! FIXTURE — mock lab (${device.name}), not Catalyst Center\n`;
}

function renderCommand(device, command) {
  const cmd = String(command || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const name = device.name || "device";
  const ip = device.ip || device.mgmtIp || "unnumbered";
  const role = device.role || "unknown";
  const platform = device.platform || "ios-xe";
  const head = banner(device);

  if (cmd.startsWith("show version")) {
    return `${head}${name} uptime is 12 weeks, 2 days\nPlatform: ${platform}\nRole: ${role}\n`;
  }
  if (cmd.startsWith("show ip interface brief") || cmd === "show ip int brief") {
    return `${head}Interface              IP-Address      Status          Protocol\nGigabitEthernet1/0/1   ${ip.padEnd(15)} up              up\n`;
  }
  if (cmd.startsWith("show vlan")) {
    return `${head}VLAN Name                             Status    Ports\n1    default                           active    Gi1/0/1\n10   USERS                             active    Gi1/0/2\n`;
  }
  if (cmd.includes("mac address-table") || cmd.includes("mac-address-table")) {
    return `${head}Vlan    Mac Address       Type        Ports\n10      0050.56ab.0001    DYNAMIC     Gi1/0/2\n`;
  }
  if (cmd.startsWith("show interfaces status") || cmd.startsWith("show interface status")) {
    return `${head}Port      Name               Status       Vlan       Duplex  Speed Type\nGi1/0/1                      connected    1          a-full  a-1000 10/100/1000BaseTX\n`;
  }
  if (cmd.startsWith("show ip route")) {
    return `${head}Codes: C - connected, S - static\nC    10.0.0.0/24 is directly connected, GigabitEthernet1/0/1\n`;
  }
  if (cmd.includes("cdp neighbor")) {
    return `${head}Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID\nsw2              Gig 1/0/24        140            S I     C9000v    Gig 1/0/24\n`;
  }
  if (cmd.includes("interfaces counters")) {
    return `${head}Port        InOctets    InUcastPkts  OutOctets   OutUcastPkts\nGi1/0/1     1048576     1200         524288      900\n`;
  }
  return `${head}% FIXTURE: no mock output for '${command}' on ${name}. Live show commands need Catalyst Center.`;
}

function runFixtureShow(devices, commands) {
  const list = Array.isArray(devices) ? devices : [];
  const cmds = (Array.isArray(commands) ? commands : []).map(String).filter(Boolean);
  if (list.length === 0) {
    return { ok: false, error: "Mock lab has no devices." };
  }
  if (cmds.length === 0) {
    return { ok: false, error: "Provide at least one read-only 'show' command." };
  }
  const outputs = {};
  for (const device of list) {
    const host = device.name || "device";
    outputs[host] = {};
    for (const command of cmds) {
      outputs[host][command] = renderCommand(device, command);
    }
  }
  return {
    ok: true,
    fixture: true,
    mode: "fixture",
    scope: list.map((device) => device.name).join(", "),
    outputs,
  };
}

function matchFixtureDevices(all, query) {
  const devices = Array.isArray(all) ? all : [];
  const q = String(query || "").trim().toLowerCase();
  if (!q || q === "all" || q === "all devices") return devices.slice(0, 4);
  const hits = devices.filter(
    (device) =>
      String(device.name || "").toLowerCase() === q ||
      String(device.name || "").toLowerCase().includes(q) ||
      String(device.ip || device.mgmtIp || "") === q,
  );
  return hits.length ? hits.slice(0, 4) : [];
}

module.exports = { renderCommand, runFixtureShow, matchFixtureDevices };
