// Skill registry — intent handlers as pluggable enterprise modules.

const deviceFact = require("./device-fact.cjs");
const networkOverview = require("./network-overview.cjs");
const devicePrecheck = require("./device-precheck.cjs");
const cliShow = require("./cli-show.cjs");
const llmLoop = require("./llm-loop.cjs");

const SKILLS = new Map(
  [deviceFact, networkOverview, devicePrecheck, cliShow, llmLoop].map((skill) => [skill.id, skill]),
);

function getSkill(skillId) {
  return SKILLS.get(skillId) || null;
}

function listSkills() {
  return [...SKILLS.values()].map((skill) => ({ id: skill.id }));
}

module.exports = { getSkill, listSkills, SKILLS };
