// Skill: LLM tool loop for general questions and delegation.

const { applyPolicy, generalChatSystemAppendix } = require("../answer-policy.cjs");
const { llmUnavailableNotice, isQuotaError } = require("../degradation.cjs");

async function run(ctx) {
  const { route, plan, deps } = ctx;
  const jarvisTools = deps.toolSpecs.map((spec) => ({
    type: "function",
    function: { name: spec.name, description: spec.description, parameters: spec.parameters },
  }));

  const customRoster = deps.agents.listCustomAgents();
  const customRosterNote =
    customRoster.length > 0
      ? `\n\nCustom agents:\n${customRoster.map((agent) => `- @${agent.id} (${agent.name}): ${agent.scope}`).join("\n")}`
      : "";

  const messages = [
    {
      role: "system",
      content: `${deps.jarvisInstructions}\n${generalChatSystemAppendix({ customRosterNote })}`,
    },
    { role: "user", content: plan.payload },
  ];

  const artifacts = [];
  const activity = [];
  const maxRounds = plan.maxRounds || 8;

  for (let round = 0; round < maxRounds; round += 1) {
    let modelMessage;
    try {
      modelMessage = await deps.chatCompletion(messages, jarvisTools);
    } catch (error) {
      if (isQuotaError(error)) {
        return {
          ok: true,
          text: llmUnavailableNotice(),
          artifacts,
          activity,
          intent: route.intent,
          skill: "llm_loop",
          degraded: true,
        };
      }
      throw error;
    }
    messages.push(modelMessage);

    const toolCalls = Array.isArray(modelMessage.tool_calls) ? modelMessage.tool_calls : [];
    if (toolCalls.length === 0) {
      const text = applyPolicy(route.intent, String(modelMessage.content || "").trim() || "Done.");
      return { ok: true, text, artifacts, activity, intent: route.intent, skill: "llm_loop", rounds: round + 1 };
    }

    for (const call of toolCalls) {
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = {};
      }
      const name = call.function?.name || "";
      const toolStarted = Date.now();
      activity.push(
        deps.buildChatActivity(name, deps.describeChatTool(name, args), deps.formatChatToolArgs(name, args), "running"),
      );
      const result = await deps.execute(name, args);
      const toolMs = Date.now() - toolStarted;
      deps.collectTechnicalArtifacts(result, artifacts);
      activity.push(
        deps.buildChatActivity(
          name,
          `${deps.describeChatTool(name, args)} done in ${(toolMs / 1000).toFixed(1)}s`,
          deps.formatChatToolResult(name, args, result, toolMs),
          result.ok === false ? "error" : "done",
        ),
      );
      messages.push({ role: "tool", tool_call_id: call.id, content: deps.compactToolResult(result) });
    }
  }

  return {
    ok: true,
    text: applyPolicy(route.intent, "Reached the tool-call limit before finishing. Check the Team Board for partial results."),
    artifacts,
    activity,
    intent: route.intent,
    skill: "llm_loop",
  };
}

module.exports = { id: "llm_loop", run };
