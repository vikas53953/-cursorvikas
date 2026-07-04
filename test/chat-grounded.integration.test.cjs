// Integration test for Task G5: chat persona uses the same grounded-answers
// contract as voice (R1-R3): quote the user's verbatim words to ask_network,
// state only the facts it returns, and answer honestly on not_found.
//
// This drives the REAL llm_loop skill (electron/skills/llm-loop.cjs) end to
// end, with a fake chatCompletion standing in for the model (deterministic,
// no network hit) and a REAL createGrounding wired to a fake registry/query
// layer (the same injection seam Task G2's own test uses) so no live catc /
// Catalyst Center call is needed. This exercises the production system
// message (generalChatSystemAppendix) and the production tool-dispatch path,
// not just static string content.
const test = require("node:test");
const assert = require("node:assert/strict");

const llmLoop = require("../electron/skills/llm-loop.cjs");
const { createGrounding } = require("../electron/core/grounding.cjs");
const { compactToolResult } = require("../electron/agents.cjs");
const { generalChatSystemAppendix } = require("../electron/answer-policy.cjs");
const { INTENTS } = require("../electron/message-router.cjs");

const DEVICES = [
  { name: "sw1", mgmtIp: "10.10.20.51", role: "access", softwareVersion: "17.12.1", software: "IOS-XE" },
];

function makeGrounding(session = {}) {
  return createGrounding({
    registry: { allDevices: async () => DEVICES },
    queryLayer: { run: async () => ({ ok: true, devices: [], results: [] }) },
    getDeviceFacts: (name) => DEVICES.find((d) => d.name === name) || null,
    session,
  });
}

function baseDeps({ chatCompletion, grounding }) {
  return {
    toolSpecs: [
      {
        name: "ask_network",
        description: "Resolve a device by the user's verbatim words and answer only from grounded facts.",
        parameters: {
          type: "object",
          properties: {
            target_phrase: { type: "string" },
            question: { type: "string" },
            commands: { type: "array", items: { type: "string" } },
          },
          required: ["target_phrase", "question"],
        },
      },
    ],
    agents: { listCustomAgents: () => [] },
    jarvisInstructions: "# Role\nYou are NetJarvis.",
    chatCompletion,
    execute: async (name, args) => {
      if (name !== "ask_network") return { ok: false, error: `unexpected tool ${name}` };
      const result = await grounding.ask({
        targetPhrase: args.target_phrase,
        question: args.question,
        commands: args.commands,
      });
      return { ok: true, ...result };
    },
    buildChatActivity: (tool, narrative, technical, status = "done") => ({ tool, narrative, technical, status }),
    describeChatTool: (name) => name.replace(/_/g, " "),
    formatChatToolArgs: (name, args) => `Tool: ${name}\n${JSON.stringify(args)}`,
    formatChatToolResult: (name, args, result) => `Tool: ${name}\nResult: ${JSON.stringify(result)}`,
    collectTechnicalArtifacts: () => {},
    compactToolResult,
  };
}

function makeRoute() {
  return { intent: INTENTS.GENERAL, confidence: "low", meta: {} };
}

function makePlan(message) {
  return { skill: "llm_loop", mode: "llm", useLlm: true, batch: false, payload: message, maxRounds: 8 };
}

test("chat: generalChatSystemAppendix carries the mandatory grounded-answers rules (R1-R3, no voice hedge)", () => {
  const appendix = generalChatSystemAppendix({});
  assert.match(appendix, /ask_network/);
  assert.match(appendix, /EXACT words/i);
  assert.match(appendix, /not_found/);
  assert.match(appendix, /nearest/i);
  assert.match(appendix, /answerKind/);
  assert.match(appendix, /need_command/);
  // Text chat must NOT require the voice-only two-beat hedge.
  assert.match(appendix, /No two-beat hedge/i);
});

test("chat: 'what version is sw1 running' routes through ask_network and states the grounded fact only", async () => {
  const grounding = makeGrounding();
  let round = 0;
  let capturedSystemMessage = null;
  let capturedToolCallArgs = null;

  const chatCompletion = async (messages) => {
    round += 1;
    if (round === 1) {
      capturedSystemMessage = messages.find((m) => m.role === "system")?.content || "";
      return {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            function: {
              name: "ask_network",
              arguments: JSON.stringify({ target_phrase: "sw1", question: "what version is sw1 running" }),
            },
          },
        ],
      };
    }
    // Round 2: model has the tool result and must speak only that fact.
    const toolMsg = messages.find((m) => m.role === "tool");
    capturedToolCallArgs = JSON.parse(toolMsg.content);
    return { role: "assistant", content: capturedToolCallArgs.sentence };
  };

  const deps = baseDeps({ chatCompletion, grounding });
  const result = await llmLoop.run({
    route: makeRoute(),
    plan: makePlan("what version is sw1 running"),
    deps,
  });

  assert.equal(result.ok, true);
  // The chat system prompt actually sent to the model carries the grounded rules.
  assert.match(capturedSystemMessage, /ask_network/);
  assert.match(capturedSystemMessage, /EXACT words/i);
  // Grounding actually ran and produced the fact from live inventory.
  assert.equal(capturedToolCallArgs.status, "answered");
  assert.equal(capturedToolCallArgs.answerKind, "fact");
  assert.equal(capturedToolCallArgs.device, "sw1");
  // The final chat reply reflects the grounded fact, not a fumbled other fact
  // (no IP/hostname detour — S3).
  assert.match(result.text, /17\.12\.1/);
  assert.doesNotMatch(result.text, /10\.10\.20\.51/);
});

test("chat: 'switch 99' (nonexistent) is answered honestly via ask_network not_found, never fabricated", async () => {
  const grounding = makeGrounding();
  let capturedToolResult = null;

  const chatCompletion = async (messages) => {
    const toolMsg = messages.find((m) => m.role === "tool");
    if (!toolMsg) {
      return {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            function: {
              name: "ask_network",
              arguments: JSON.stringify({ target_phrase: "switch 99", question: "what is the ip of switch 99" }),
            },
          },
        ],
      };
    }
    capturedToolResult = JSON.parse(toolMsg.content);
    return {
      role: "assistant",
      content: `There's no switch 99. Nearest real devices: ${capturedToolResult.nearest.join(", ")}.`,
    };
  };

  const deps = baseDeps({ chatCompletion, grounding });
  const result = await llmLoop.run({
    route: makeRoute(),
    plan: makePlan("what is the ip of switch 99"),
    deps,
  });

  assert.equal(result.ok, true);
  assert.equal(capturedToolResult.status, "not_found");
  assert.ok(capturedToolResult.nearest.includes("sw1"));
  assert.match(result.text, /no switch 99/i);
  assert.match(result.text, /sw1/);
  // Must never invent an IP for a device that doesn't exist.
  assert.doesNotMatch(result.text, /\d+\.\d+\.\d+\.\d+/);
});
