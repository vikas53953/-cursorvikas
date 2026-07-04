// Skill: interface / Ethernet link status on a named device (API, not LLM guesswork).

const { INTENTS } = require("../message-router.cjs");
const { applyPolicy } = require("../answer-policy.cjs");

function formatInterfaceStatusReply(device, interfaces) {
  if (!interfaces || interfaces.length === 0) {
    return `No interface data returned for ${device}.`;
  }

  const normalized = interfaces.map((row) => ({
    name: row.interface || row.portName || "unknown",
    status: String(row.status || "").toLowerCase(),
    admin: String(row.adminStatus || row.admin || "").toLowerCase(),
    vlan: row.vlan || row.vlanId || "",
    mode: row.mode || row.portMode || "",
  }));

  const up = normalized.filter((row) => row.status === "up" || row.status === "connected");
  const down = normalized.filter((row) => !["up", "connected"].includes(row.status));

  const highlights = up
    .slice(0, 6)
    .map((row) => {
      const bits = [row.name, row.status];
      if (row.mode) bits.push(row.mode);
      if (row.vlan) bits.push(`vlan ${row.vlan}`);
      return bits.join(" ");
    })
    .join("; ");

  let text = `On ${device}, ${up.length} interface(s) are up`;
  if (down.length > 0) text += ` and ${down.length} are down (${down.map((r) => r.name).join(", ")})`;
  text += `.`;
  if (highlights) text += ` Up: ${highlights}.`;

  return applyPolicy(INTENTS.INTERFACE_STATUS, text);
}

async function run(ctx) {
  const { route, deps } = ctx;
  const { device, problemsOnly } = route.meta;
  const result = await deps.execute("interface_report", { device, problemsOnly: problemsOnly === true });
  const artifacts = [];

  if (result.ok === false) {
    return {
      ok: false,
      error: result.error || "Interface report failed.",
      artifacts,
      activity: [
        deps.buildChatActivity("interface_report", `Interface status on ${device} failed`, result.error || "unknown", "error"),
      ],
      intent: route.intent,
      skill: "interface_status",
    };
  }

  deps.collectTechnicalArtifacts(result, artifacts);
  const interfaces = result.interfaces || [];
  const text = formatInterfaceStatusReply(device, interfaces);
  const activity = [
    deps.buildChatActivity(
      "interface_report",
      `Interface status on ${device}`,
      deps.formatChatToolResult("interface_report", { device, problemsOnly }, result, 0),
    ),
  ];

  return { ok: true, text, artifacts, activity, intent: route.intent, skill: "interface_status" };
}

module.exports = { id: "interface_status", run };
