// Skill: single show command on a device.

const { INTENTS } = require("../message-router.cjs");
const { applyPolicy } = require("../answer-policy.cjs");
const { isQuotaError } = require("../degradation.cjs");

async function run(ctx) {
  const { route, plan, deps } = ctx;
  const { device, commands } = route.meta;
  const cliResult = await deps.execute("run_show_command", { device, commands });
  const artifacts = [];

  if (cliResult.ok === false) {
    return {
      ok: false,
      error: cliResult.error || "CLI command failed.",
      artifacts,
      activity: [
        deps.buildChatActivity(
          "run_show_command",
          `${device} · ${commands[0]} failed`,
          cliResult.error || "unknown error",
          "error",
        ),
      ],
      intent: route.intent,
      skill: "cli_show",
    };
  }

  deps.collectTechnicalArtifacts(cliResult, artifacts);
  const activity = [
    deps.buildChatActivity(
      "run_show_command",
      `${device} · ${commands[0]}`,
      deps.formatChatToolResult("run_show_command", { device, commands }, cliResult, 0),
    ),
  ];

  let text = `**Summary** — \`${commands[0]}\` on ${device} completed. See technical output below.`;
  if (plan.useLlm !== false) {
    try {
      const summaryMessage = await deps.chatCompletion(
        [
          {
            role: "system",
            content: `${deps.jarvisInstructions}\n\nSummarize this CLI output briefly. No next steps.`,
          },
          { role: "user", content: cliResult.artifact?.content || "" },
        ],
        [],
      );
      text = applyPolicy(INTENTS.CLI_SHOW, String(summaryMessage.content || "").trim() || text);
    } catch (error) {
      if (isQuotaError(error)) {
        deps.logger.log("skill.cli_show_summary_failed", { device, error: String(error).slice(0, 200) });
      }
    }
  }

  return { ok: true, text, artifacts, activity, intent: route.intent, skill: "cli_show" };
}

module.exports = { id: "cli_show", run };
