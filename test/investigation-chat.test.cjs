const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyIntent, INTENTS, parseInvestigateRoute, parseLookbackHours } = require("../electron/message-router.cjs");
const { planAction } = require("../electron/action-planner.cjs");
const { validateToolCall } = require("../electron/guardrails.cjs");
const { getSkill } = require("../electron/skills/index.cjs");
const { TEAMS, TOOL_ROUTING } = require("../electron/agents.cjs");

const agentsApi = { resolveTeam: (key) => TEAMS[key] || null };
const devices = [{ name: "sw1" }, { name: "sw2" }];

test("router classifies investigation requests and extracts the seed entity", () => {
  const byUser = classifyIntent("investigate user jdoe over the last 6 hours", { agentsApi, devices });
  assert.equal(byUser.intent, INTENTS.INVESTIGATE);
  assert.deepEqual(byUser.meta.entity, { kind: "user", value: "jdoe" });
  assert.equal(byUser.meta.lookbackHours, 6);

  const byIp = classifyIntent("what did 10.20.0.7 do yesterday?", { agentsApi, devices });
  assert.equal(byIp.intent, INTENTS.INVESTIGATE);
  assert.deepEqual(byIp.meta.entity, { kind: "ip", value: "10.20.0.7" });
  assert.equal(byIp.meta.lookbackHours, 24);

  const byHost = classifyIntent("timeline for host LT-4421 across vpn, proxy and firewall", { agentsApi, devices });
  assert.equal(byHost.intent, INTENTS.INVESTIGATE);
  assert.deepEqual(byHost.meta.entity, { kind: "host", value: "LT-4421" });
  assert.deepEqual(byHost.meta.platforms, ["vpn", "proxy", "firewall"]);

  const byEmail = classifyIntent("correlate the identity and cloud evidence for jdoe@corp.example in the past 2 days", { agentsApi, devices });
  assert.equal(byEmail.intent, INTENTS.INVESTIGATE);
  assert.deepEqual(byEmail.meta.entity, { kind: "user", value: "jdoe@corp.example" });
  assert.deepEqual(byEmail.meta.platforms, ["identity", "cloud"]);
  assert.equal(byEmail.meta.lookbackHours, 48);

  const byDevice = classifyIntent("investigate sw1", { agentsApi, devices });
  assert.equal(byDevice.intent, INTENTS.INVESTIGATE);
  assert.deepEqual(byDevice.meta.entity, { kind: "host", value: "sw1" });
});

test("router does not hijack unrelated or entity-less messages", () => {
  assert.equal(parseInvestigateRoute("investigate", devices), null);
  assert.notEqual(classifyIntent("show vlan brief on sw1", { agentsApi, devices }).intent, INTENTS.INVESTIGATE);
  assert.notEqual(classifyIntent("how is my network doing", { agentsApi, devices }).intent, INTENTS.INVESTIGATE);
  assert.notEqual(classifyIntent("what is the uptime of sw2", { agentsApi, devices }).intent, INTENTS.INVESTIGATE);
});

test("parseLookbackHours understands common windows", () => {
  assert.equal(parseLookbackHours("last 90 minutes"), 2);
  assert.equal(parseLookbackHours("past 3 days"), 72);
  assert.equal(parseLookbackHours("last week"), 168);
  assert.equal(parseLookbackHours("last hour"), 1);
  assert.equal(parseLookbackHours("nothing here"), null);
});

test("planner maps the investigate intent to the investigation skill and tool", () => {
  const route = classifyIntent("investigate user jdoe", { agentsApi, devices });
  const plan = planAction(route, { message: "investigate user jdoe", agents: agentsApi });
  assert.equal(plan.skill, "investigation");
  assert.equal(plan.tool, "investigate");
  assert.ok(getSkill("investigation"));
});

test("guardrails require exactly one seed entity and a sane window", () => {
  assert.equal(validateToolCall("investigate", { user: "jdoe" }).ok, true);
  assert.equal(validateToolCall("investigate", {}).ok, false);
  assert.equal(validateToolCall("investigate", { user: "jdoe", ip: "1.2.3.4" }).ok, false);
  assert.equal(validateToolCall("investigate", { ip: "1.2.3.4", lookbackHours: -3 }).ok, false);
});

test("the Investigation Agent is on the org chart and owns the investigate tool", () => {
  assert.equal(TEAMS.soc.group, "security");
  assert.equal(TOOL_ROUTING.investigate.team, "soc");
});

test("investigation skill runs the tool and narrates only from its output", async () => {
  const skill = getSkill("investigation");
  const toolResult = {
    ok: true,
    id: "INV-1",
    entity: { kind: "user", value: "jdoe" },
    window: { from: "2026-08-28T00:00:00.000Z", to: "2026-08-28T12:00:00.000Z", hours: 12 },
    summary: "2 correlated events for user jdoe across 2 platforms; highest severity info.",
    observations: ["2 correlated events for user jdoe across 2 platforms; highest severity info.", "vpn: 1 event between a and b.", "identity: 1 event between a and b."],
    coverage: [
      { platform: "vpn", provider: "splunk", status: "ok", count: 1 },
      { platform: "identity", provider: "splunk", status: "ok", count: 1 },
      { platform: "cloud", provider: "splunk", status: "unconfigured", count: 0 },
    ],
    gaps: ["cloud (splunk): not configured - no evidence was collected."],
    pivots: [],
    counts: { total: 2, byPlatform: { vpn: 1, identity: 1 }, droppedDuplicates: 0, droppedOutOfWindow: 0 },
    timeline: [],
    artifact: { title: "Investigation INV-1: user jdoe", kind: "markdown", content: "# Investigation" },
  };
  let executed;
  let promptedWith;
  const deps = {
    execute: async (name, args) => {
      executed = { name, args };
      return toolResult;
    },
    chatCompletion: async (messages) => {
      promptedWith = messages;
      return { content: "**Summary** — jdoe: VPN then Okta login.\n\n**Details**\n- ...\n\n**Gaps**\n- cloud not configured" };
    },
    buildChatActivity: (tool, title, detail, status) => ({ tool, title, detail, status: status || "ok" }),
    jarvisInstructions: "persona",
    logger: { log() {} },
  };
  const route = classifyIntent("investigate user jdoe in the last 12 hours across vpn and identity", { agentsApi, devices });
  const plan = planAction(route, { message: "", agents: agentsApi });
  const out = await skill.run({ route, plan, deps, message: "", target: "jarvis", channel: "chat" });

  assert.equal(out.ok, true);
  assert.deepEqual(executed, { name: "investigate", args: { user: "jdoe", lookbackHours: 12, platforms: ["vpn", "identity"] } });
  assert.equal(out.artifacts.length, 1);
  assert.match(out.activity[0].title, /Investigate user jdoe — 2 events across 2 platforms/);
  assert.match(out.activity[0].detail, /cloud {5}splunk {11}unconfigured/);
  assert.match(out.text, /jdoe: VPN then Okta login/);
  const userPayload = JSON.parse(promptedWith[1].content);
  assert.deepEqual(Object.keys(userPayload), ["entity", "window", "summary", "observations", "coverage", "gaps", "pivots", "timeline"]);
});

test("investigation skill degrades to the deterministic text when the model is unavailable", async () => {
  const skill = getSkill("investigation");
  const deps = {
    execute: async () => ({
      ok: true,
      summary: "3 correlated events for ip 10.0.0.5 across 1 platform; highest severity high.",
      observations: ["3 correlated events for ip 10.0.0.5 across 1 platform; highest severity high.", "firewall: 3 events between a and b.", "firewall: 3 of 3 events are deny/drop."],
      coverage: [{ platform: "firewall", provider: "splunk", status: "ok", count: 3 }],
      gaps: [],
      counts: { total: 3, byPlatform: { firewall: 3 } },
      window: {},
      timeline: [],
    }),
    chatCompletion: async () => { throw new Error("insufficient_quota"); },
    buildChatActivity: (tool, title, detail) => ({ tool, title, detail }),
    jarvisInstructions: "",
    logger: { log() {} },
  };
  const route = classifyIntent("investigate 10.0.0.5", { agentsApi, devices });
  const out = await skill.run({ route, plan: { useLlm: true }, deps });
  assert.equal(out.ok, true);
  assert.match(out.text, /\*\*Summary\*\* — 3 correlated events/);
  assert.match(out.text, /- firewall: 3 of 3 events are deny\/drop/);
});

test("investigation skill surfaces tool failure", async () => {
  const skill = getSkill("investigation");
  const deps = {
    execute: async () => ({ ok: false, error: "boom" }),
    buildChatActivity: (tool, title, detail, status) => ({ tool, title, detail, status }),
    logger: { log() {} },
  };
  const route = classifyIntent("investigate user jdoe", { agentsApi, devices });
  const out = await skill.run({ route, plan: {}, deps });
  assert.equal(out.ok, false);
  assert.equal(out.error, "boom");
  assert.equal(out.activity[0].status, "error");
});
