// Enterprise message orchestrator — classify → plan → skill → audit.

const { classifyIntent } = require("./message-router.cjs");
const { planAction } = require("./action-planner.cjs");
const { getSkill } = require("./skills/index.cjs");
const sessionStore = require("./session-store.cjs");

function createHandleUserMessage(deps) {
  async function handleUserMessage({ channel = "chat", message, target = "jarvis", sessionId } = {}) {
    const trimmed = String(message || "").trim();
    if (!trimmed) return { ok: false, error: "Message is empty" };

    const started = Date.now();
    // Pass the live inventory through when a registry is wired (Task 11) so
    // device extraction can use real names/roles/sites, not just the swN
    // regex. Falls back to [] (→ regex fallback inside device-facts.cjs) if
    // the registry isn't available or the fetch fails.
    const devices = typeof deps.getDevices === "function" ? await deps.getDevices().catch(() => []) : [];
    const route = classifyIntent(trimmed, { agentsApi: deps.agents, target, devices });
    const plan = planAction(route, { message: trimmed, target, channel, agents: deps.agents });

    if (plan.ok === false) {
      return { ok: false, error: plan.error, intent: route.intent };
    }

    const resolvedSessionId = sessionId || sessionStore.getOrCreateSession(channel);
    const auditId = await sessionStore.beginTurn({
      sessionId: resolvedSessionId,
      channel,
      userMessage: trimmed,
      route,
      plan,
    });

    deps.logger.log("message.start", {
      channel,
      sessionId: resolvedSessionId,
      auditId,
      intent: route.intent,
      skill: plan.skill,
      confidence: route.confidence,
      target,
    });

    const skill = getSkill(plan.skill);
    if (!skill) {
      const err = `No skill registered for plan: ${plan.skill}`;
      const fail = { ok: false, error: err, intent: route.intent, skill: plan.skill, sessionId: resolvedSessionId, auditId };
      await sessionStore.completeTurn(auditId, resolvedSessionId, fail, started);
      return fail;
    }

    try {
      const result = await skill.run({ route, plan, deps, message: trimmed, target, channel });
      const enriched = {
        ...result,
        sessionId: resolvedSessionId,
        auditId,
        intent: route.intent,
        skill: plan.skill,
        confidence: route.confidence,
        channel,
      };
      await sessionStore.completeTurn(auditId, resolvedSessionId, enriched, started);
      deps.logger.log("message.done", {
        channel,
        sessionId: resolvedSessionId,
        auditId,
        intent: route.intent,
        skill: plan.skill,
        ms: Date.now() - started,
        ok: enriched.ok !== false,
      });
      return enriched;
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      const fail = {
        ok: false,
        error: errText,
        intent: route.intent,
        skill: plan.skill,
        sessionId: resolvedSessionId,
        auditId,
        artifacts: [],
        activity: [],
      };
      await sessionStore.completeTurn(auditId, resolvedSessionId, fail, started);
      deps.logger.log("message.error", { channel, intent: route.intent, skill: plan.skill, error: errText });
      return fail;
    }
  }

  return { handleUserMessage };
}

module.exports = { createHandleUserMessage };
