// Task E4 model-plumbing fix: electron/agents.cjs `chatCompletion` previously
// hardcoded model:"gpt-5-mini" in the OpenAI request body, so
// NETJARVIS_BRAIN_MODEL never reached OpenAI for the one-brain command-former
// / answer-composer calls. This test drives the real chatCompletion function
// but stubs global.fetch (no network) to capture the outgoing request body
// and assert the model it sent -- deterministic and offline.
const test = require("node:test");
const assert = require("node:assert/strict");
const { chatCompletion } = require("../electron/agents.cjs");

function fakeOkResponse(body) {
  return {
    ok: true,
    json: async () => body,
  };
}

function withFetchStub(captureFn, responseBody) {
  const original = global.fetch;
  global.fetch = async (url, init) => {
    captureFn({ url, body: JSON.parse(init.body) });
    return fakeOkResponse(responseBody || { choices: [{ message: { role: "assistant", content: "ok" } }] });
  };
  return () => {
    global.fetch = original;
  };
}

function withApiKey() {
  const prev = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  return () => {
    if (prev === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev;
  };
}

test("chatCompletion defaults to gpt-5-mini when no opts.model is given (existing specialist-agent behavior unchanged)", async () => {
  const restoreKey = withApiKey();
  let captured = null;
  const restoreFetch = withFetchStub((c) => (captured = c));

  try {
    await chatCompletion([{ role: "user", content: "hi" }], undefined);
    assert.equal(captured.body.model, "gpt-5-mini");
  } finally {
    restoreFetch();
    restoreKey();
  }
});

test("chatCompletion uses opts.model when provided (brain model plumbing)", async () => {
  const restoreKey = withApiKey();
  let captured = null;
  const restoreFetch = withFetchStub((c) => (captured = c));

  try {
    await chatCompletion([{ role: "user", content: "hi" }], undefined, { model: "gpt-5.5" });
    assert.equal(captured.body.model, "gpt-5.5");
  } finally {
    restoreFetch();
    restoreKey();
  }
});

test("chatCompletion still passes tools and messages through unchanged alongside opts.model", async () => {
  const restoreKey = withApiKey();
  let captured = null;
  const restoreFetch = withFetchStub((c) => (captured = c));
  const messages = [{ role: "system", content: "sys" }, { role: "user", content: "q" }];
  const tools = [{ type: "function", function: { name: "noop", parameters: {} } }];

  try {
    await chatCompletion(messages, tools, { model: "gpt-5.4" });
    assert.deepEqual(captured.body.messages, messages);
    assert.deepEqual(captured.body.tools, tools);
    assert.equal(captured.body.model, "gpt-5.4");
  } finally {
    restoreFetch();
    restoreKey();
  }
});
