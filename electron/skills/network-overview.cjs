// Skill: network health overview (short summary, not a dump).

const { INTENTS } = require("../message-router.cjs");
const { applyPolicy, formatOverviewReply } = require("../answer-policy.cjs");

async function run(ctx) {
  const { route, plan, deps } = ctx;
  const result = await deps.execute(plan.tool, plan.args || {});
  const activity = [
    deps.buildChatActivity(
      "network_overview",
      "Network overview",
      deps.formatChatToolResult("network_overview", {}, result, 0),
    ),
  ];

  if (result.ok === false) {
    return {
      ok: false,
      error: result.error || "Network overview failed.",
      artifacts: [],
      activity,
      intent: route.intent,
      skill: "network_overview",
    };
  }

  const snapshot = await deps.source.getSnapshot();
  const text = applyPolicy(INTENTS.NETWORK_OVERVIEW, formatOverviewReply(snapshot));
  const artifacts = [];
  deps.collectTechnicalArtifacts(result, artifacts);

  return { ok: true, text, artifacts, activity, intent: route.intent, skill: "network_overview" };
}

module.exports = { id: "network_overview", run };
