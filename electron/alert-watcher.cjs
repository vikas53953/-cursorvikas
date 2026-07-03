// Alert-driven proactive events: Jarvis speaks when something breaks.

const path = require("node:path");
const fs = require("node:fs/promises");
const logger = require("./logger.cjs");

const statePath = path.join(process.cwd(), "data", "alert-watch-state.json");
const eventsPath = path.join(process.cwd(), "data", "proactive-events.json");

function parseMinutes(value, fallback) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes >= 0.5 ? minutes : fallback;
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch {
    return { issueIds: [], activeCount: 0, overall: "healthy" };
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}

async function readEvents() {
  try {
    const raw = JSON.parse(await fs.readFile(eventsPath, "utf8"));
    return Array.isArray(raw.events) ? raw.events : [];
  } catch {
    return [];
  }
}

async function pushEvent(event) {
  const events = await readEvents();
  events.unshift(event);
  await fs.mkdir(path.dirname(eventsPath), { recursive: true });
  await fs.writeFile(eventsPath, JSON.stringify({ events: events.slice(0, 100) }, null, 2));
  logger.log("alert.proactive", event);
  return event;
}

function createAlertWatcher({ getSnapshot }) {
  const enabled = String(process.env.ALERT_WATCH_ENABLED || "true").toLowerCase() !== "false";
  const intervalMinutes = parseMinutes(process.env.ALERT_WATCH_INTERVAL_MINUTES, 1);
  let timer = null;
  let running = false;

  async function poll() {
    if (running) return;
    running = true;
    try {
      const snapshot = await getSnapshot();
      const issues = snapshot?.issues?.items || [];
      const issueIds = issues.map((issue) => issue.issueId || issue.id || issue.name).filter(Boolean);
      const prev = await readState();
      const newIssues = issues.filter((issue) => {
        const id = issue.issueId || issue.id || issue.name;
        return id && !prev.issueIds.includes(id);
      });

      if (newIssues.length > 0 || (snapshot.issues?.active || 0) > prev.activeCount) {
        const headline = newIssues[0]?.name || `${snapshot.issues?.active || 0} active issue(s)`;
        await pushEvent({
          id: `EVT-${Date.now()}`,
          type: "alert",
          at: new Date().toISOString(),
          overall: snapshot.overall,
          activeIssues: snapshot.issues?.active || 0,
          headline,
          message: `Heads up: ${headline}. Network is ${snapshot.overall}. Open the dashboard for details.`,
          issues: newIssues.slice(0, 5).map((issue) => ({
            id: issue.issueId || issue.id,
            name: issue.name,
            priority: issue.priority,
            status: issue.status,
          })),
          spoken: false,
        });
      }

      await writeState({
        issueIds,
        activeCount: snapshot.issues?.active || 0,
        overall: snapshot.overall || "healthy",
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.log("alert.watch.error", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      running = false;
    }
  }

  async function pendingEvents() {
    const events = await readEvents();
    return events.filter((event) => !event.spoken).slice(0, 10);
  }

  async function markSpoken(id) {
    const events = await readEvents();
    const next = events.map((event) => (event.id === id ? { ...event, spoken: true, spokenAt: new Date().toISOString() } : event));
    await fs.writeFile(eventsPath, JSON.stringify({ events: next }, null, 2));
    return { ok: true };
  }

  function start() {
    if (!enabled || timer) return;
    void poll();
    timer = setInterval(() => {
      void poll();
    }, intervalMinutes * 60 * 1000);
    logger.log("alert.watch.start", { enabled, intervalMinutes });
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, poll, pendingEvents, markSpoken, enabled, intervalMinutes };
}

module.exports = { createAlertWatcher };
