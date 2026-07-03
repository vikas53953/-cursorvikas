#!/usr/bin/env node
// Behavior cycle: exercises core tools and checks the activity board + logs.

const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const db = require("../electron/db.cjs");
const { createTools } = require("../electron/tools.cjs");
const logger = require("../electron/logger.cjs");

const tools = createTools({ readDb: db.readDb, updateDb: db.updateDb });

const CASES = [
  { name: "network_overview", args: {} },
  { name: "vulnerability_check", args: { windowDays: 30 } },
  { name: "precheck_capture", args: { label: "behavior-cycle-pre" } },
  { name: "team_board", args: {} },
  { name: "multi_source_status", args: {} },
  { name: "problem_trends", args: { limit: 5 } },
];

async function main() {
  const failures = [];
  console.log("NetJarvis behavior cycle starting...");
  for (const testCase of CASES) {
    const started = Date.now();
    try {
      const result = await tools.execute(testCase.name, testCase.args);
      const ms = Date.now() - started;
      if (result.ok === false) {
        failures.push(`${testCase.name}: ${result.error || "failed"}`);
        console.log(`FAIL ${testCase.name} (${ms}ms) - ${result.error}`);
      } else {
        console.log(`OK   ${testCase.name} (${ms}ms) artifact=${result.artifact?.title || "none"}`);
      }
    } catch (error) {
      failures.push(`${testCase.name}: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`ERR  ${testCase.name} - ${error}`);
    }
  }

  const tasks = await tools.listTasks();
  const artifacts = await tools.listArtifacts(10);
  const recentLogs = logger.recent(30).filter((entry) => String(entry.type || "").startsWith("tool."));
  console.log(`\nTasks on board: ${tasks.length}`);
  console.log(`Artifacts saved: ${artifacts.length}`);
  console.log(`Recent tool logs: ${recentLogs.length}`);

  if (tasks.length < CASES.length - 1) {
    failures.push(`Expected at least ${CASES.length - 1} board tasks, got ${tasks.length}`);
  }

  if (failures.length > 0) {
    console.error("\nBehavior cycle failures:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("\nBehavior cycle passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
