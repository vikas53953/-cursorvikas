// Test-first for Task G6: silent fact-audit telemetry (O4 phase 1).
//
// logFactAudit must never throw/block/correct - it is a best-effort audit
// trail recording what the grounding engine actually produced, for later
// drift analysis against what was ultimately said. It delegates to the
// existing logger.cjs (JSONL + secret redaction), so we spy on logger.log
// the same way test/ask-network.integration.test.cjs monkeypatches catc:
// same require-cache module instance, restored after each test.
const test = require("node:test");
const assert = require("node:assert/strict");

const logger = require("../electron/logger.cjs");
const { logFactAudit } = require("../electron/core/fact-telemetry.cjs");

test("logFactAudit logs a fact.audit entry for an answered 'fact' result", () => {
  const calls = [];
  const original = logger.log;
  logger.log = (type, data) => calls.push({ type, data });
  try {
    logFactAudit({
      channel: "tool",
      question: "what version is sw1 running",
      grounded: {
        status: "answered",
        device: "sw1",
        answerKind: "fact",
        sentence: "sw1 is running IOS-XE 17.12.1.",
      },
    });
  } finally {
    logger.log = original;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "fact.audit");
  assert.equal(calls[0].data.channel, "tool");
  assert.equal(calls[0].data.question, "what version is sw1 running");
  assert.equal(calls[0].data.status, "answered");
  assert.equal(calls[0].data.device, "sw1");
  assert.equal(calls[0].data.answerKind, "fact");
  assert.match(calls[0].data.sentence, /17\.12\.1/);
});

test("logFactAudit logs a preview of output for an answered 'output' result, without an undefined sentence", () => {
  const calls = [];
  const original = logger.log;
  logger.log = (type, data) => calls.push({ type, data });
  try {
    logFactAudit({
      channel: "tool",
      question: "show me the vlans on sw1",
      grounded: {
        status: "answered",
        device: "sw1",
        answerKind: "output",
        output: { ok: true, results: [{ host: "sw1", outputs: { "show vlan brief": "VLAN0001 default active" } }] },
      },
    });
  } finally {
    logger.log = original;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.answerKind, "output");
  assert.ok(calls[0].data.outputPreview);
  assert.match(calls[0].data.outputPreview, /VLAN0001/);
});

test("logFactAudit logs not_found results honestly", () => {
  const calls = [];
  const original = logger.log;
  logger.log = (type, data) => calls.push({ type, data });
  try {
    logFactAudit({
      channel: "tool",
      question: "what is the ip of switch 99",
      grounded: { status: "not_found", phrase: "switch 99", nearest: ["sw1", "sw2"] },
    });
  } finally {
    logger.log = original;
  }

  assert.equal(calls[0].data.status, "not_found");
  assert.deepEqual(calls[0].data.nearest, ["sw1", "sw2"]);
});

test("logFactAudit never throws even when logger.log itself throws", () => {
  const original = logger.log;
  logger.log = () => {
    throw new Error("boom");
  };
  try {
    assert.doesNotThrow(() => logFactAudit({ channel: "tool", question: "q", grounded: { status: "answered" } }));
  } finally {
    logger.log = original;
  }
});

test("logFactAudit never throws with missing or malformed args", () => {
  assert.doesNotThrow(() => logFactAudit());
  assert.doesNotThrow(() => logFactAudit({}));
  assert.doesNotThrow(() => logFactAudit({ channel: "tool", question: "q", grounded: null }));
  assert.doesNotThrow(() => logFactAudit({ channel: "tool", question: "q", grounded: { output: { circular: undefined } } }));
});
