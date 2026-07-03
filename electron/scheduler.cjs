// Scheduled automatic shift briefings.

const logger = require("./logger.cjs");

function parseMinutes(value, fallback) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes >= 5 ? minutes : fallback;
}

function createScheduler({ runBriefing }) {
  const enabled = String(process.env.SHIFT_BRIEFING_ENABLED || "true").toLowerCase() !== "false";
  const intervalMinutes = parseMinutes(process.env.SHIFT_BRIEFING_INTERVAL_MINUTES, 480);
  let timer = null;
  let lastRunAt = null;
  let lastResult = null;

  async function run(reason = "manual") {
    try {
      const result = await runBriefing();
      lastRunAt = new Date().toISOString();
      lastResult = { ok: true, reason, ...result };
      logger.log("scheduler.briefing", lastResult);
      return lastResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastResult = { ok: false, reason, error: message };
      logger.log("scheduler.briefing.error", lastResult);
      return lastResult;
    }
  }

  function start() {
    if (!enabled || timer) return;
    timer = setInterval(() => {
      void run("interval");
    }, intervalMinutes * 60 * 1000);
    logger.log("scheduler.start", { enabled, intervalMinutes });
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function status() {
    return {
      enabled,
      intervalMinutes,
      lastRunAt,
      lastResult,
    };
  }

  return { start, stop, run, status };
}

module.exports = { createScheduler };
