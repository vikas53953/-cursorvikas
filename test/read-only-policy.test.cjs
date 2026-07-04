const test = require("node:test");
const assert = require("node:assert/strict");
const { assertReadOnly } = require("../electron/core/read-only-policy.cjs");

test("allows a show command on ios-xe", () => {
  assert.equal(assertReadOnly("ios-xe", "show vlan brief").ok, true);
});

test("blocks configure on ios-xe", () => {
  assert.equal(assertReadOnly("ios-xe", "configure terminal").ok, false);
});

test("blocks a mutating verb even if it starts with show-like text", () => {
  assert.equal(assertReadOnly("ios-xe", "show run | append flash:x").ok, false);
});

test("allows list on f5-tmos but not on ios-xe", () => {
  assert.equal(assertReadOnly("f5-tmos", "list ltm pool").ok, true);
  assert.equal(assertReadOnly("ios-xe", "list ltm pool").ok, false);
});
