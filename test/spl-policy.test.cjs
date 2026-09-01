const test = require("node:test");
const assert = require("node:assert/strict");
const { assertReadOnlySpl, splQuote } = require("../electron/core/spl-policy.cjs");

test("plain searches and read-only generating commands pass", () => {
  assert.equal(assertReadOnlySpl('search index=auth user="jdoe" | stats count by src').ok, true);
  assert.equal(assertReadOnlySpl('index=auth user="jdoe"').ok, true);
  assert.equal(assertReadOnlySpl("| tstats count from datamodel=Authentication where Authentication.user=jdoe by _time").ok, true);
  assert.equal(assertReadOnlySpl("| inputlookup vpn_assets | search user=jdoe").ok, true);
});

test("write, collect, exec and outbound commands are blocked wherever they appear", () => {
  for (const spl of [
    "index=auth | delete",
    "index=auth | collect index=summary",
    "index=auth | outputlookup foo.csv",
    "index=auth | sendemail to=x@y",
    "index=auth | script foo",
    "| rest /services/server/info",
    "index=auth\n| Delete",
    "| makeresults | eval user=\"fake\"",
    "index=auth | map search=\"search index=foo | delete\"",
  ]) {
    const verdict = assertReadOnlySpl(spl);
    assert.equal(verdict.ok, false, spl);
    assert.match(verdict.error, /Read-only policy/);
  }
});

test("field names that merely contain a blocked word are not blocked", () => {
  assert.equal(assertReadOnlySpl("index=auth deleted_user=jdoe | stats count").ok, true);
  assert.equal(assertReadOnlySpl("index=cloud eventName=DeleteBucket").ok, true);
});

test("unknown leading generating command is rejected", () => {
  assert.equal(assertReadOnlySpl("| foo bar").ok, false);
  assert.equal(assertReadOnlySpl("").ok, false);
});

test("splQuote escapes quotes and backslashes", () => {
  assert.equal(splQuote('a"b'), '"a\\"b"');
  assert.equal(splQuote("CORP\\jdoe"), '"CORP\\\\jdoe"');
});
