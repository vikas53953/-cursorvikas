// Skill: cross-platform investigation (chat path).
//
// Runs the `investigate` tool once for the seed entity the router extracted,
// then (optionally) asks the model to narrate the deterministic result. The
// narration is fed ONLY the engine's output - the timeline, observations,
// coverage and gaps - so it cannot introduce facts the evidence does not hold.

const { INTENTS } = require("../message-router.cjs");
const { applyPolicy } = require("../answer-policy.cjs");
const { isQuotaError, llmUnavailableNotice } = require("../degradation.cjs");

function fallbackText(result) {
  const lines = [`**Summary** — ${result.summary}`];
  const facts = (result.observations || []).filter((t) => !/^\S+: \d+ events? between/.test(t)).slice(1, 5);
  if (facts.length) {
    lines.push("", "**Details**", ...facts.map((t) => `- ${t}`));
  }
  if (result.gaps?.length) {
    lines.push("", "**Gaps**", ...result.gaps.map((g) => `- ${g}`));
  }
  return lines.join("\n");
}

async function run(ctx) {
  const { route, plan, deps } = ctx;
  const { entity, lookbackHours, platforms } = route.meta;
  const args = { [entity.kind]: entity.value };
  if (lookbackHours) args.lookbackHours = lookbackHours;
  if (platforms) args.platforms = platforms;

  const result = await deps.execute("investigate", args);
  const label = `Investigate ${entity.kind} ${entity.value}`;

  if (result.ok === false) {
    return {
      ok: false,
      error: result.error || "Investigation failed.",
      artifacts: [],
      activity: [deps.buildChatActivity("investigate", `${label} failed`, `Tool: investigate\nArgs: ${JSON.stringify(args)}\nStatus: failed\nError: ${result.error || "unknown"}`, "error")],
      intent: route.intent,
      skill: "investigation",
    };
  }

  const artifacts = [];
  if (result.artifact) artifacts.push(result.artifact);

  const coverageLines = (result.coverage || []).map((c) => `  ${c.platform.padEnd(9)} ${c.provider.padEnd(16)} ${c.status.padEnd(12)} ${c.count} events${c.error ? ` - ${c.error}` : ""}`);
  const activity = [
    deps.buildChatActivity(
      "investigate",
      `${label} — ${result.counts?.total ?? 0} events across ${Object.keys(result.counts?.byPlatform || {}).length} platforms`,
      [
        "Tool: investigate",
        `Seed: ${entity.kind}=${entity.value}`,
        `Window: ${result.window?.from} to ${result.window?.to} (${result.window?.hours}h)`,
        `Coverage (${coverageLines.length} providers):`,
        ...coverageLines,
        `Events: ${result.counts?.total ?? 0} (dropped ${result.counts?.droppedDuplicates ?? 0} duplicates, ${result.counts?.droppedOutOfWindow ?? 0} out of window)`,
        "Status: ok",
      ].join("\n"),
    ),
  ];

  let text = fallbackText(result);
  if (plan.useLlm !== false && (result.counts?.total ?? 0) > 0) {
    try {
      const grounded = {
        entity: result.entity,
        window: result.window,
        summary: result.summary,
        observations: result.observations,
        coverage: result.coverage,
        gaps: result.gaps,
        pivots: result.pivots,
        timeline: result.timeline,
      };
      const reply = await deps.chatCompletion(
        [
          {
            role: "system",
            content: `${deps.jarvisInstructions}\n\n# Investigation narration\nYou are given the complete, deterministic output of the investigate tool as JSON. Write **Summary** (one or two sentences: what the evidence shows for this entity in this window) then **Details** (time-ordered bullets, each with the UTC timestamp, platform and what happened), then **Gaps** listing every platform that was unconfigured, failed or empty. Use ONLY facts present in the JSON. Do not infer intent, attribution or compromise. No next steps.`,
          },
          { role: "user", content: JSON.stringify(grounded).slice(0, 60000) },
        ],
        [],
      );
      const narrated = String(reply.content || "").trim();
      if (narrated) text = applyPolicy(INTENTS.INVESTIGATE, narrated);
    } catch (error) {
      if (isQuotaError(error)) text = `${text}\n\n${llmUnavailableNotice()}`;
      deps.logger.log("skill.investigation_narration_failed", { entity, error: String(error).slice(0, 200) });
    }
  }

  if (result.fixture && !/FIXTURE DATA/.test(text)) {
    text = `_FIXTURE DATA — mock lab (NETJARVIS_EVIDENCE_FIXTURE), not a real network._\n\n${text}`;
  }

  return { ok: true, text, artifacts, activity, intent: route.intent, skill: "investigation", investigationId: result.id, fixture: Boolean(result.fixture) };
}

module.exports = { id: "investigation", run };
