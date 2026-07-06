#!/usr/bin/env node
// Eval harness (Task E6): makes "strongest" a measured number instead of a
// feeling. Loads test/eval-set.json (a replayable question set with expected
// shape) and runs each question through the SAME grounding engine
// (electron/core/grounding.cjs createGrounding().ask) real callers use.
//
// Default (no flags): fully deterministic and offline. Builds createGrounding
// with fake registry/getDeviceFacts/commandFormer/queryLayer/answerComposer
// so the harness scores the PIPELINE (scope resolution, fact-compose,
// command-forming shape, query-run wiring, answer composition) without a
// live model or network call — repeatable in CI, no creds required.
//
// `--live`: builds the REAL grounding via electron/tools.cjs createTools
// (real Catalyst Center sandbox `catc` + the real gpt-5.5 command-former/
// answer-composer brain via chatCompletion) so Vikas can score the actual
// brain's command-forming against the same eval-set later, once creds are
// present. Requires OPENAI_API_KEY / catc sandbox env vars to do anything
// useful; without them the real commandFormer degrades to `cannot_form`
// honestly (see test/ask-network.integration.test.cjs) rather than crashing.
//
// Deviation (logged, harness-only): eval-set.json cases carry only a
// `question`, not a separate `target_phrase`. In production the OUTER
// model (voice/chat "mouth") decides target_phrase from the engineer's
// words (electron/tools.cjs JARVIS_INSTRUCTIONS: "the engineer's exact
// words naming the device/target" e.g. "sw1", or "it"/"its" for a
// follow-up) - that decision is not part of createGrounding itself and this
// harness has no LLM standing in for that mouth. `deriveTargetPhrase` below
// is a small deterministic stand-in for that one step: pull a device-name
// token (`sw1`, `switch 99`) out of the question, or - for a pronoun-led
// follow-up - the pronoun onward ("its uptime" out of "and its uptime?").
// This is scoring the grounding engine's own pipeline, not the mouth's
// phrase-extraction skill.

const fs = require("node:fs");
const path = require("node:path");

const { createGrounding } = require("../electron/core/grounding.cjs");

const EVAL_SET_PATH = path.join(__dirname, "..", "test", "eval-set.json");

// ---------------------------------------------------------------------------
// Deterministic offline fakes (default path).
// ---------------------------------------------------------------------------

const FAKE_DEVICES = [
  { name: "sw1", mgmtIp: "10.10.20.51", role: "access", platform: "C9300-24T", executor: "fake" },
  { name: "sw2", mgmtIp: "10.10.20.52", role: "access", platform: "C9300-24T", executor: "fake" },
  { name: "sw3", mgmtIp: "10.10.20.53", role: "distribution", platform: "C9300-48T", executor: "fake" },
  { name: "sw4", mgmtIp: "10.10.20.54", role: "core", platform: "C9500-24Y4C", executor: "fake" },
];

const FAKE_FACTS = {
  sw1: { name: "sw1", mgmtIp: "10.10.20.51", role: "access", platform: "C9300-24T", software: "IOS-XE", softwareVersion: "17.12.1", uptime: "10 days, 2:15:00" },
  sw2: { name: "sw2", mgmtIp: "10.10.20.52", role: "access", platform: "C9300-24T", software: "IOS-XE", softwareVersion: "17.12.1", uptime: "5 days, 0:40:00" },
  sw3: { name: "sw3", mgmtIp: "10.10.20.53", role: "distribution", platform: "C9300-48T", software: "IOS-XE", softwareVersion: "17.9.4a", uptime: "42 days, 3:00:00" },
  sw4: { name: "sw4", mgmtIp: "10.10.20.54", role: "core", platform: "C9500-24Y4C", software: "IOS-XE", softwareVersion: "17.9.4a", uptime: "120 days, 8:00:00" },
};

const CANNED_OUTPUT = {
  "show mac address-table": "Vlan  Mac Address     Type    Ports\n1     aabb.ccdd.eeff  DYNAMIC Gi1/0/1",
  "show vlan brief": "VLAN Name    Status    Ports\n1    default  active    Gi1/0/1, Gi1/0/2",
  "show ip route": "Gateway of last resort is 10.10.20.1\nS*   0.0.0.0/0 [1/0] via 10.10.20.1",
  "show ip arp": "Protocol  Address       Age (min)  Hardware Addr   Type  Interface\nInternet  10.10.20.1    -          aabb.ccdd.0001  ARPA  Vlan1",
};

function fakeRegistry() {
  return { allDevices: async () => FAKE_DEVICES };
}

function fakeGetDeviceFacts(name) {
  return FAKE_FACTS[name] || null;
}

// Fake commandFormer: maps common read-only intents to the exact show
// command a real gpt-5.5 command-former (electron/core/command-former.cjs)
// is expected to form - this is the seam the harness scores the PIPELINE
// through without a live model.
function fakeCommandFormer() {
  return {
    async formCommand(question) {
      const q = String(question || "").toLowerCase();
      if (/\bmac\b/.test(q)) return { ok: true, commands: ["show mac address-table"] };
      if (/\bvlan/.test(q)) return { ok: true, commands: ["show vlan brief"] };
      if (/\b(route|routing)\b/.test(q)) return { ok: true, commands: ["show ip route"] };
      if (/\barp\b/.test(q)) return { ok: true, commands: ["show ip arp"] };
      return { ok: false, error: "fake-command-former: no mapping for this intent" };
    },
  };
}

function fakeQueryLayer() {
  return {
    async run(deviceName, commands) {
      const outputs = {};
      for (const command of commands) {
        outputs[command] = CANNED_OUTPUT[command] || `(no canned output for "${command}")`;
      }
      return { ok: true, devices: [{ name: deviceName }], results: [{ host: deviceName, ok: true, outputs }] };
    },
  };
}

function fakeAnswerComposer() {
  return {
    async compose(question, device, runResult) {
      const result = runResult && runResult.results && runResult.results[0];
      const firstOutput = result && result.outputs && Object.values(result.outputs)[0];
      const firstLine = firstOutput ? String(firstOutput).split("\n")[0] : "no output";
      return { sentence: `${device && device.name}: ${firstLine}` };
    },
  };
}

function buildDeterministicGrounding() {
  return createGrounding({
    registry: fakeRegistry(),
    queryLayer: fakeQueryLayer(),
    getDeviceFacts: fakeGetDeviceFacts,
    session: { lastDevice: null },
    commandFormer: fakeCommandFormer(),
    answerComposer: fakeAnswerComposer(),
  });
}

// ---------------------------------------------------------------------------
// Live path: the REAL grounding (real catc sandbox + real gpt-5.5 brain),
// reusing electron/tools.cjs's own wiring verbatim via ask_network so this
// harness can never drift from what production actually builds.
// ---------------------------------------------------------------------------

function buildLiveGrounding() {
  const db = require("../electron/db.cjs");
  const { createTools } = require("../electron/tools.cjs");
  const tools = createTools({ readDb: db.readDb, updateDb: db.updateDb });
  return {
    async ask({ targetPhrase, question }) {
      return tools.execute("ask_network", { target_phrase: targetPhrase, question });
    },
  };
}

// ---------------------------------------------------------------------------
// Harness-only target-phrase extraction (see deviation note above).
// ---------------------------------------------------------------------------

function deriveTargetPhrase(question) {
  const text = String(question || "");
  const swMatch = text.match(/\bsw\d+\b/i);
  if (swMatch) return swMatch[0];
  const switchMatch = text.match(/\bswitch\s+\d+\b/i);
  if (switchMatch) return switchMatch[0];
  const pronounMatch = text.match(/\b(it|its|that|this)\b.*/i);
  if (pronounMatch) return pronounMatch[0].replace(/[?.!]+$/, "").trim();
  return text;
}

// ---------------------------------------------------------------------------
// Scoring.
// ---------------------------------------------------------------------------

function scoreCase(testCase, result) {
  const expect = testCase.expect || {};
  const failures = [];

  if (expect.status !== undefined && result.status !== expect.status) {
    failures.push(`status: expected "${expect.status}", got "${result.status}"`);
  }
  if (expect.device !== undefined && result.device !== expect.device) {
    failures.push(`device: expected "${expect.device}", got "${result.device}"`);
  }
  if (expect.answerKind !== undefined && result.answerKind !== expect.answerKind) {
    failures.push(`answerKind: expected "${expect.answerKind}", got "${result.answerKind}"`);
  }
  if (expect.commandIncludes !== undefined) {
    const commands = Array.isArray(result.commands) ? result.commands : [];
    const hit = commands.some((c) => String(c).includes(expect.commandIncludes));
    if (!hit) {
      failures.push(`commandIncludes: expected a command containing "${expect.commandIncludes}", got ${JSON.stringify(commands)}`);
    }
  }
  if (expect.not && typeof expect.not === "object") {
    for (const [key, value] of Object.entries(expect.not)) {
      if (result[key] === value) {
        failures.push(`not.${key}: expected result.${key} to NOT be ${JSON.stringify(value)}, but it was`);
      }
    }
  }

  return { pass: failures.length === 0, failures };
}

// Runs one eval case's question(s) in order against a freshly built grounding
// instance (own session), so cases never leak lastDevice state into each
// other. A case with `questions` (plural) is the anaphora shape: earlier
// questions in the array exist only to set up session.lastDevice; only the
// LAST question's result is scored.
async function runCase(testCase, buildGrounding) {
  const grounding = buildGrounding();
  const questions = Array.isArray(testCase.questions) ? testCase.questions : [testCase.question];
  let result;
  for (const question of questions) {
    const targetPhrase = deriveTargetPhrase(question);
    result = await grounding.ask({ targetPhrase, question });
  }
  return result;
}

function loadEvalSet(setPath = EVAL_SET_PATH) {
  return JSON.parse(fs.readFileSync(setPath, "utf8"));
}

async function runEvalSet(cases, buildGrounding) {
  const outcomes = [];
  for (const testCase of cases) {
    const result = await runCase(testCase, buildGrounding);
    const { pass, failures } = scoreCase(testCase, result);
    outcomes.push({ id: testCase.id, pass, failures, result });
  }
  return outcomes;
}

async function main() {
  const live = process.argv.includes("--live");
  const cases = loadEvalSet();
  const buildGrounding = live ? buildLiveGrounding : buildDeterministicGrounding;

  console.log(`NetJarvis grounded-answer eval — ${live ? "LIVE (real catc + real brain)" : "deterministic offline"} — ${cases.length} case(s)\n`);

  const outcomes = await runEvalSet(cases, buildGrounding);
  let passCount = 0;
  for (const outcome of outcomes) {
    if (outcome.pass) {
      passCount += 1;
      console.log(`PASS ${outcome.id}`);
    } else {
      console.log(`FAIL ${outcome.id}`);
      for (const failure of outcome.failures) console.log(`     - ${failure}`);
    }
  }

  console.log(`\nscore ${passCount}/${outcomes.length}`);

  if (passCount < outcomes.length) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  deriveTargetPhrase,
  scoreCase,
  runCase,
  loadEvalSet,
  runEvalSet,
  buildDeterministicGrounding,
  buildLiveGrounding,
  main,
};
