const test = require("node:test");
const assert = require("node:assert/strict");
const { getLegitReads } = require("../electron/sources/catalyst-center.cjs");

test("getLegitReads returns the response array from an injected apiFn", async () => {
  const fakeApi = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/dna/intent/api/v1/network-device-poller/cli/legit-reads");
    return { response: ["show", "sh", "ping"] };
  };
  const verbs = await getLegitReads({ apiFn: fakeApi, fresh: true });
  assert.deepEqual(verbs, ["show", "sh", "ping"]);
});

test("getLegitReads falls back to ['show','sh'] when apiFn throws", async () => {
  const fakeApi = async () => {
    throw new Error("network down");
  };
  const verbs = await getLegitReads({ apiFn: fakeApi, fresh: true });
  assert.deepEqual(verbs, ["show", "sh"]);
});

test("getLegitReads falls back to ['show','sh'] when response is malformed", async () => {
  const fakeApi = async () => ({ nonsense: true });
  const verbs = await getLegitReads({ apiFn: fakeApi, fresh: true });
  assert.deepEqual(verbs, ["show", "sh"]);
});

test("getLegitReads caches the result across calls (second call does not re-invoke apiFn)", async () => {
  let calls = 0;
  const fakeApi = async () => {
    calls += 1;
    return { response: ["show", "sh", "traceroute"] };
  };
  const first = await getLegitReads({ apiFn: fakeApi, fresh: true });
  const second = await getLegitReads({ apiFn: fakeApi });
  assert.deepEqual(first, ["show", "sh", "traceroute"]);
  assert.deepEqual(second, ["show", "sh", "traceroute"]);
  assert.equal(calls, 1, "apiFn should only be called once due to caching");
});

test("getLegitReads accepts a bare array response shape too", async () => {
  const fakeApi = async () => ["show", "sh", "dir"];
  const verbs = await getLegitReads({ apiFn: fakeApi, fresh: true });
  assert.deepEqual(verbs, ["show", "sh", "dir"]);
});
