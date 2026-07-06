// Task E6: proves the eval harness itself actually scores things, rather
// than just always printing PASS. Two things are asserted:
//   1. The real seeded test/eval-set.json, run deterministically offline,
//      scores 100% (every case PASS) - this is the harness's normal job.
//   2. A deliberately-wrong expectation (cloned from a real seeded case but
//      with an expectation flipped to something the deterministic pipeline
//      will NOT produce) is scored as a FAIL - proving the scoring logic is
//      not vacuous (it can and does fail cases).
const test = require("node:test");
const assert = require("node:assert/strict");

const { loadEvalSet, runEvalSet, buildDeterministicGrounding } = require("../scripts/eval-grounded.cjs");

test("eval harness: the seeded deterministic eval-set scores all PASS", async () => {
  const cases = loadEvalSet();
  assert.ok(cases.length > 0, "eval-set.json should not be empty");

  const outcomes = await runEvalSet(cases, buildDeterministicGrounding);

  const failed = outcomes.filter((o) => !o.pass);
  assert.deepEqual(failed, [], `expected all seeded cases to pass, but ${failed.length} failed: ${JSON.stringify(failed, null, 2)}`);
  assert.equal(outcomes.length, cases.length);
});

test("eval harness: a deliberately-wrong expectation is scored FAIL (proves scoring is not vacuous)", async () => {
  const wrongDevice = {
    id: "deliberately-wrong-device",
    question: "what version is sw1 running",
    // sw1's fake facts are wired above; the real device is sw1, never sw2.
    expect: { status: "answered", device: "sw2", answerKind: "fact" },
  };
  const wrongStatus = {
    id: "deliberately-wrong-status",
    question: "show vlans on switch 99",
    // switch 99 does not exist in the fake registry; this can never be "answered".
    expect: { status: "answered" },
  };
  const wrongCommand = {
    id: "deliberately-wrong-command",
    question: "vlans on sw1",
    // vlans never runs "show ip route".
    expect: { status: "answered", answerKind: "output", commandIncludes: "ip route" },
  };

  const outcomes = await runEvalSet([wrongDevice, wrongStatus, wrongCommand], buildDeterministicGrounding);

  for (const outcome of outcomes) {
    assert.equal(outcome.pass, false, `expected case "${outcome.id}" to FAIL, but it PASSed`);
    assert.ok(outcome.failures.length > 0, `expected case "${outcome.id}" to report at least one failure reason`);
  }
});

test("eval harness: scoreCase's `not` clause reports failure when the negated value DOES occur", async () => {
  const { scoreCase } = require("../scripts/eval-grounded.cjs");
  const result = { status: "need_command", device: "sw1" };
  const { pass, failures } = scoreCase({ expect: { not: { status: "need_command" } } }, result);
  assert.equal(pass, false);
  assert.match(failures[0], /not\.status/);
});
