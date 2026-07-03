// Skill: batched device pre-check via CLI.

const { INTENTS } = require("../message-router.cjs");
const { applyPolicy, precheckFallbackSummary } = require("../answer-policy.cjs");
const { llmUnavailableNotice, isQuotaError } = require("../degradation.cjs");

async function run(ctx) {
  const { route, plan, deps } = ctx;
  const { team, device, commands } = route.meta;
  const cliResult = await deps.execute("run_show_command", { device, commands });
  const artifacts = [];

  if (cliResult.ok === false) {
    return {
      ok: false,
      error: cliResult.error || "CLI pre-check failed.",
      artifacts,
      activity: [
        deps.buildChatActivity(
          "run_show_command",
          `Pre-check on ${device} failed`,
          `Tool: run_show_command\nDevice: ${device}\nStatus: failed\nError: ${cliResult.error || "unknown"}`,
          "error",
        ),
      ],
      intent: route.intent,
      skill: "device_precheck",
    };
  }

  const spec = deps.agents.resolveTeam(team);
  artifacts.push(
    deps.buildPrecheckArtifact({
      device,
      agent: spec?.name || team,
      commands,
      cliOutput: cliResult.artifact?.content || "",
      elapsedMs: 0,
    }),
  );

  const activity = [
    deps.buildChatActivity(
      "run_show_command",
      `Pre-check on ${device} — ${commands.length} show commands (batched)`,
      [
        "Tool: run_show_command",
        `Device: ${device}`,
        `Agent: ${spec?.name || team}`,
        `Commands (${commands.length}):`,
        ...commands.map((command) => `  $ ${command}`),
        "Status: ok",
      ].join("\n"),
    ),
  ];

  let text = precheckFallbackSummary(device);
  if (plan.useLlm !== false) {
    try {
      const summaryMessage = await deps.chatCompletion(
        [
          {
            role: "system",
            content: `${deps.jarvisInstructions}\n\n# Pre-check complete on ${device}\nSummarize: **Summary** then **Details**. No next steps.`,
          },
          { role: "user", content: `Pre-check on ${device}:\n\n${cliResult.artifact?.content || ""}` },
        ],
        [],
      );
      text = applyPolicy(INTENTS.DEVICE_PRECHECK, String(summaryMessage.content || "").trim() || text);
    } catch (error) {
      if (isQuotaError(error)) text = `${text} ${llmUnavailableNotice()}`;
      deps.logger.log("skill.precheck_summary_failed", { device, error: String(error).slice(0, 200) });
    }
  }

  return { ok: true, text, artifacts, activity, intent: route.intent, skill: "device_precheck" };
}

module.exports = { id: "device_precheck", run };
