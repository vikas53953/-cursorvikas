// Skill: direct device facts from inventory (IP, uptime, hostname).

const { matchSnapshotDevices } = require("../device-facts.cjs");
const { formatDeviceFactFromSnapshot } = require("../answer-policy.cjs");

async function run(ctx) {
  const { route, deps } = ctx;
  const snapshot = await deps.source.getSnapshot();
  const { matched, missing } = matchSnapshotDevices(route.meta.devices, snapshot.devices || []);

  if (matched.length === 0) {
    return {
      ok: true,
      text: `I couldn't find ${route.meta.devices.join(", ")} in inventory.`,
      artifacts: [],
      activity: [],
      intent: route.intent,
      skill: "device_fact",
    };
  }

  const text = formatDeviceFactFromSnapshot(route.meta.factKind, matched, missing);
  const activity = [
    deps.buildChatActivity(
      "device_health",
      `Device fact: ${route.meta.factKind} for ${matched.map((d) => d.name).join(", ")}`,
      matched
        .map((d) => `${d.name}: ip=${d.ip || "n/a"}, uptime=${d.uptime || "n/a"}, status=${d.status || "n/a"}`)
        .join("\n"),
    ),
  ];

  return { ok: true, text, artifacts: [], activity, intent: route.intent, skill: "device_fact" };
}

module.exports = { id: "device_fact", run };
