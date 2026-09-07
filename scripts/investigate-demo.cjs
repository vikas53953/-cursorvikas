#!/usr/bin/env node
// Runs the investigation agent against the bundled mock lab (FIXTURE DATA) and
// prints the markdown artifact. Never touches a real Splunk; Catalyst Center is
// still queried live if reachable (its rows are labelled provider catalyst-center).
//
//   npm run demo:investigate                 # user jdoe, last 24h
//   npm run demo:investigate -- ip 10.20.0.7 6
//   npm run demo:investigate -- host LT-4421

process.env.NETJARVIS_EVIDENCE_FIXTURE = process.env.NETJARVIS_EVIDENCE_FIXTURE || "1";

const [kind = "user", value = "jdoe", hours = "24"] = process.argv.slice(2);
const { createTools } = require("../electron/tools.cjs");

(async () => {
  const tools = createTools({
    readDb: async () => ({ notes: [] }),
    updateDb: async (fn) => {
      const db = { notes: [] };
      const result = await fn(db);
      return { db, result };
    },
  });
  const result = await tools.execute("investigate", { [kind]: value, lookbackHours: Number(hours) || 24 }, { skipActivity: true });
  if (result.ok === false) {
    console.error(`investigate failed: ${result.error}`);
    process.exit(1);
  }
  console.log(result.artifact.content);
  console.log("\n---\nSpoken summary:\n" + result.summary);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
