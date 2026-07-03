// Single message orchestrator for voice (text), squad chat, and keyboard.

const { sanitizeSquadChatReply } = require("./chat-reply.cjs");
const { matchSnapshotDevices } = require("./device-facts.cjs");
const { INTENTS, classifyIntent } = require("./message-router.cjs");
const {
  applyPolicy,
  formatOverviewReply,
  formatDeviceFactFromSnapshot,
  precheckFallbackSummary,
  squadChatSystemAppendix,
  generalChatSystemAppendix,
} = require("./answer-policy.cjs");

function createHandleUserMessage(deps) {
  const {
    execute,
    agents,
    source,
    chatCompletion,
    jarvisInstructions,
    toolSpecs,
    buildChatActivity,
    describeChatTool,
    formatChatToolArgs,
    formatChatToolResult,
    collectTechnicalArtifacts,
    buildPrecheckArtifact,
    compactToolResult,
    logger,
  } = deps;

  async function runDeviceFact(route, started) {
    const snapshot = await source.getSnapshot();
    const { matched, missing } = matchSnapshotDevices(route.meta.devices, snapshot.devices || []);
    if (matched.length === 0) {
      return {
        ok: true,
        text: `I couldn't find ${route.meta.devices.join(", ")} in inventory.`,
        artifacts: [],
        activity: [],
        intent: route.intent,
      };
    }
    const text = formatDeviceFactFromSnapshot(route.meta.factKind, matched, missing);
    const activity = [
      buildChatActivity(
        "device_health",
        `Device fact: ${route.meta.factKind} for ${matched.map((d) => d.name).join(", ")}`,
        matched
          .map((d) => `${d.name}: ip=${d.ip || "n/a"}, uptime=${d.uptime || "n/a"}, status=${d.status || "n/a"}`)
          .join("\n"),
      ),
    ];
    logger.log("message.done", { intent: route.intent, ms: Date.now() - started });
    return { ok: true, text, artifacts: [], activity, intent: route.intent };
  }

  async function runNetworkOverview(route, started) {
    const result = await execute("network_overview", {});
    const activity = [
      buildChatActivity("network_overview", "Network overview", formatChatToolResult("network_overview", {}, result, 0)),
    ];
    if (result.ok === false) {
      return { ok: false, error: result.error || "Network overview failed.", artifacts: [], activity, intent: route.intent };
    }
    const snapshot = await source.getSnapshot();
    const text = applyPolicy(INTENTS.NETWORK_OVERVIEW, formatOverviewReply(snapshot));
    const artifacts = [];
    collectTechnicalArtifacts(result, artifacts);
    logger.log("message.done", { intent: route.intent, ms: Date.now() - started });
    return { ok: true, text, artifacts, activity, intent: route.intent };
  }

  async function runDevicePrecheck(route, started) {
    const { team, device, commands } = route.meta;
    const cliResult = await execute("run_show_command", { device, commands });
    const artifacts = [];
    if (cliResult.ok === false) {
      return {
        ok: false,
        error: cliResult.error || "CLI pre-check failed.",
        artifacts,
        activity: [
          buildChatActivity(
            "run_show_command",
            `Pre-check on ${device} failed`,
            `Tool: run_show_command\nDevice: ${device}\nStatus: failed\nError: ${cliResult.error || "unknown"}`,
            "error",
          ),
        ],
        intent: route.intent,
      };
    }

    const elapsed = Date.now() - started;
    const spec = agents.resolveTeam(team);
    artifacts.push(
      buildPrecheckArtifact({
        device,
        agent: spec?.name || team,
        commands,
        cliOutput: cliResult.artifact?.content || "",
        elapsedMs: elapsed,
      }),
    );
    const activity = [
      buildChatActivity(
        "run_show_command",
        `Pre-check on ${device} — ${commands.length} show commands (batched)`,
        [
          "Tool: run_show_command",
          `Device: ${device}`,
          `Agent: ${spec?.name || team}`,
          `Commands (${commands.length}):`,
          ...commands.map((command) => `  $ ${command}`),
          "Status: ok",
          `Elapsed: ${(elapsed / 1000).toFixed(1)}s`,
        ].join("\n"),
      ),
    ];

    let text = precheckFallbackSummary(device);
    try {
      const summaryMessage = await chatCompletion(
        [
          {
            role: "system",
            content: `${jarvisInstructions}\n\n# Pre-check complete on ${device}\nSummarize in Slack style: **Summary** then **Details**. No next steps.`,
          },
          {
            role: "user",
            content: `Pre-check on ${device}:\n\n${cliResult.artifact?.content || "No CLI output."}`,
          },
        ],
        [],
      );
      text = applyPolicy(INTENTS.DEVICE_PRECHECK, String(summaryMessage.content || "").trim() || text);
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      logger.log("message.precheck_summary_failed", { device, error: errText.slice(0, 200) });
    }

    logger.log("message.done", { intent: route.intent, ms: Date.now() - started });
    return { ok: true, text, artifacts, activity, intent: route.intent };
  }

  async function runCliShow(route, started) {
    const { device, commands } = route.meta;
    const cliResult = await execute("run_show_command", { device, commands });
    const artifacts = [];
    if (cliResult.ok === false) {
      return {
        ok: false,
        error: cliResult.error || "CLI command failed.",
        artifacts,
        activity: [
          buildChatActivity(
            "run_show_command",
            `${device} · ${commands[0]} failed`,
            cliResult.error || "unknown error",
            "error",
          ),
        ],
        intent: route.intent,
      };
    }
    collectTechnicalArtifacts(cliResult, artifacts);
    const activity = [
      buildChatActivity(
        "run_show_command",
        `${device} · ${commands[0]}`,
        formatChatToolResult("run_show_command", { device, commands }, cliResult, Date.now() - started),
      ),
    ];
    let text = `**Summary** — \`${commands[0]}\` on ${device} completed. See technical output below.`;
    try {
      const summaryMessage = await chatCompletion(
        [
          {
            role: "system",
            content: `${jarvisInstructions}\n\nSummarize this CLI output briefly. No next steps.`,
          },
          { role: "user", content: cliResult.artifact?.content || "" },
        ],
        [],
      );
      text = applyPolicy(INTENTS.CLI_SHOW, String(summaryMessage.content || "").trim() || text);
    } catch {
      // fallback text is fine
    }
    logger.log("message.done", { intent: route.intent, ms: Date.now() - started });
    return { ok: true, text, artifacts, activity, intent: route.intent };
  }

  async function runGeneralLoop({ payload, teamKey, intent, started }) {
    const jarvisTools = toolSpecs.map((spec) => ({
      type: "function",
      function: { name: spec.name, description: spec.description, parameters: spec.parameters },
    }));

    const customRoster = agents.listCustomAgents();
    const customRosterNote =
      customRoster.length > 0
        ? `\n\nCustom agents:\n${customRoster.map((agent) => `- @${agent.id} (${agent.name}): ${agent.scope}`).join("\n")}`
        : "";

    const messages = [
      {
        role: "system",
        content: `${jarvisInstructions}\n${generalChatSystemAppendix({ customRosterNote })}`,
      },
      { role: "user", content: payload },
    ];

    const artifacts = [];
    const activity = [];

    for (let round = 0; round < 8; round += 1) {
      const modelMessage = await chatCompletion(messages, jarvisTools);
      messages.push(modelMessage);

      const toolCalls = Array.isArray(modelMessage.tool_calls) ? modelMessage.tool_calls : [];
      if (toolCalls.length === 0) {
        const text = applyPolicy(intent, String(modelMessage.content || "").trim() || "Done.");
        logger.log("message.done", { intent, ms: Date.now() - started, rounds: round + 1 });
        return { ok: true, text, artifacts, activity, intent };
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
        activity.push(buildChatActivity(name, describeChatTool(name, args), formatChatToolArgs(name, args), "running"));
        const result = await execute(name, args);
        const toolMs = Date.now() - toolStarted;
        collectTechnicalArtifacts(result, artifacts);
        activity.push(
          buildChatActivity(
            name,
            `${describeChatTool(name, args)} done in ${(toolMs / 1000).toFixed(1)}s`,
            formatChatToolResult(name, args, result, toolMs),
            result.ok === false ? "error" : "done",
          ),
        );
        messages.push({ role: "tool", tool_call_id: call.id, content: compactToolResult(result) });
      }
    }

    return {
      ok: true,
      text: applyPolicy(intent, "Reached the tool-call limit before finishing. Check the Team Board for partial results."),
      artifacts,
      activity,
      intent,
    };
  }

  async function handleUserMessage({ channel = "chat", message, target = "jarvis" } = {}) {
    const trimmed = String(message || "").trim();
    if (!trimmed) return { ok: false, error: "Message is empty" };

    const started = Date.now();
    const route = classifyIntent(trimmed, { agentsApi: agents, target });
    logger.log("message.start", { channel, intent: route.intent, confidence: route.confidence, target });

    switch (route.intent) {
      case INTENTS.DEVICE_FACT:
        return runDeviceFact(route, started);
      case INTENTS.NETWORK_OVERVIEW:
        return runNetworkOverview(route, started);
      case INTENTS.DEVICE_PRECHECK:
        return runDevicePrecheck(route, started);
      case INTENTS.CLI_SHOW:
        return runCliShow(route, started);
      case INTENTS.DELEGATE:
      case INTENTS.GENERAL: {
        let payload = trimmed;
        const teamKey = String(target || "jarvis").toLowerCase();
        if (teamKey !== "jarvis") {
          const spec = agents.resolveTeam(teamKey);
          if (!spec) return { ok: false, error: `Unknown squad target: ${target}` };
          payload = `[Squad text chat — engineer is messaging ${spec.name} (${teamKey} agent). Respond in that specialist scope; use delegate_task or tools as you would for voice.] ${trimmed}`;
        } else if (route.intent === INTENTS.DELEGATE && route.meta.primary) {
          payload = `[Squad channel mentions: @${route.meta.teams.join(", @")}] ${trimmed}`;
        }
        try {
          return await runGeneralLoop({ payload, teamKey, intent: route.intent, started });
        } catch (error) {
          const errText = error instanceof Error ? error.message : String(error);
          logger.log("message.error", { intent: route.intent, error: errText, ms: Date.now() - started });
          return { ok: false, error: errText, intent: route.intent };
        }
      }
      default:
        return { ok: false, error: "Unknown intent", intent: route.intent };
    }
  }

  return { handleUserMessage };
}

module.exports = { createHandleUserMessage };
