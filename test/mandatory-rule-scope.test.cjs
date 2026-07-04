const test = require("node:test");
const assert = require("node:assert/strict");
const { JARVIS_INSTRUCTIONS } = require("../electron/tools.cjs");
const { squadChatSystemAppendix } = require("../electron/answer-policy.cjs");

// SME review regression: the "Grounded answers (MANDATORY)" rule used to say
// ask_network is required for "ANY question about a device or anything on
// the network", which collided with network-wide/fleet tools
// (network_overview, network_inventory, topology_show, active_alerts) and
// would misroute questions like "how is my network doing". The rule must be
// scoped to specific named device/target questions, with fleet questions
// explicitly exempted.

test("voice JARVIS_INSTRUCTIONS scopes the mandatory rule to a named device/target", () => {
  assert.match(JARVIS_INSTRUCTIONS, /specific named device or target/i);
  assert.doesNotMatch(JARVIS_INSTRUCTIONS, /ANY question about a device or anything on the network/);
});

test("voice JARVIS_INSTRUCTIONS exempts fleet-wide questions from the mandatory rule", () => {
  assert.match(JARVIS_INSTRUCTIONS, /network_overview/);
  assert.match(JARVIS_INSTRUCTIONS, /network_inventory/);
  assert.match(JARVIS_INSTRUCTIONS, /topology_show/);
  assert.match(JARVIS_INSTRUCTIONS, /active_alerts/);
  // The exemption line should live inside the Grounded answers section, not
  // just be present anywhere in the prompt (Core behavior already mentions
  // these tools) — assert the scoped sentence itself names all four.
  const section = JARVIS_INSTRUCTIONS.slice(JARVIS_INSTRUCTIONS.indexOf("# Grounded answers"));
  const scopedLine = section.slice(0, section.indexOf("\n- Quote"));
  assert.match(scopedLine, /network_overview/);
  assert.match(scopedLine, /network_inventory/);
  assert.match(scopedLine, /topology_show/);
  assert.match(scopedLine, /active_alerts/);
});

test("chat squadChatSystemAppendix scopes the mandatory rule to a named device/target", () => {
  const appendix = squadChatSystemAppendix();
  assert.match(appendix, /specific named device or target/i);
  assert.doesNotMatch(appendix, /ANY question about a device or anything on the network/);
});

test("chat squadChatSystemAppendix exempts fleet-wide questions from the mandatory rule", () => {
  const appendix = squadChatSystemAppendix();
  const section = appendix.slice(appendix.indexOf("# Grounded answers"));
  const scopedLine = section.slice(0, section.indexOf("\n- Quote"));
  assert.match(scopedLine, /network_overview/);
  assert.match(scopedLine, /network_inventory/);
  assert.match(scopedLine, /topology_show/);
  assert.match(scopedLine, /active_alerts|overnight_events/);
});
