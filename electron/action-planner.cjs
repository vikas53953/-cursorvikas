// Maps classified intent → execution plan (skill, tools, LLM mode).

const { INTENTS } = require("./message-router.cjs");

function buildLlmPayload(message, route, target, agents) {
  let payload = message;
  const teamKey = String(target || "jarvis").toLowerCase();

  if (teamKey !== "jarvis") {
    const spec = agents.resolveTeam(teamKey);
    if (!spec) return { ok: false, error: `Unknown squad target: ${target}` };
    payload = `[Squad text chat — engineer is messaging ${spec.name} (${teamKey} agent). Respond in that specialist scope; use delegate_task or tools as you would for voice.] ${message}`;
    return { ok: true, payload, teamKey, delegateTarget: teamKey };
  }

  if (route.intent === INTENTS.DELEGATE && route.meta?.primary) {
    payload = `[Squad channel mentions: @${route.meta.teams.join(", @")}] ${message}`;
    return { ok: true, payload, teamKey, delegateTarget: route.meta.primary };
  }

  return { ok: true, payload, teamKey: "jarvis", delegateTarget: null };
}

function planAction(route, context = {}) {
  const { message = "", target = "jarvis", channel = "chat", agents } = context;

  switch (route.intent) {
    case INTENTS.DEVICE_FACT:
      return {
        skill: "device_fact",
        mode: "automated",
        useLlm: false,
        batch: false,
        meta: route.meta,
      };

    case INTENTS.NETWORK_OVERVIEW:
      return {
        skill: "network_overview",
        mode: "automated",
        useLlm: false,
        batch: false,
        tool: "network_overview",
        args: {},
      };

    case INTENTS.DEVICE_PRECHECK:
      return {
        skill: "device_precheck",
        mode: "hybrid",
        useLlm: true,
        batch: true,
        tool: "run_show_command",
        meta: route.meta,
      };

    case INTENTS.INTERFACE_STATUS:
      return {
        skill: "interface_status",
        mode: "automated",
        useLlm: false,
        batch: false,
        tool: "interface_report",
        meta: route.meta,
      };

    case INTENTS.CLI_SHOW:
      return {
        skill: "cli_show",
        mode: "hybrid",
        useLlm: true,
        batch: false,
        tool: "run_show_command",
        meta: route.meta,
      };

    case INTENTS.DELEGATE:
    case INTENTS.GENERAL: {
      const built = buildLlmPayload(message, route, target, agents);
      if (built.ok === false) return built;
      return {
        skill: "llm_loop",
        mode: "llm",
        useLlm: true,
        batch: false,
        payload: built.payload,
        teamKey: built.teamKey,
        delegateTarget: built.delegateTarget,
        maxRounds: 8,
      };
    }

    default:
      return { ok: false, error: "No plan for intent", intent: route.intent };
  }
}

module.exports = { planAction, buildLlmPayload };
