import { useCallback, useEffect, useRef, useState } from "react";
import type { TeamTask } from "../vite-env";

const COLUMNS: Array<{ key: TeamTask["status"][]; title: string; className: string }> = [
  { key: ["queued"], title: "Queued", className: "kanban-queued" },
  { key: ["in_progress"], title: "In Progress", className: "kanban-progress" },
  { key: ["done", "failed"], title: "Done", className: "kanban-done" },
];

const TEAM_BADGE: Record<string, string> = {
  data: "DATA",
  firewall: "FW",
  loadbalancer: "LB",
  proxy: "PROXY",
  incident: "INC",
  problem: "PRB",
};

type TeamBoardProps = {
  // When provided (taskBoard artifact), renders statically; otherwise
  // self-refreshes from the task API.
  staticTasks?: TeamTask[];
};

// Kanban view of NetJarvis's delegations to the specialist agents.
export function TeamBoard({ staticTasks }: TeamBoardProps) {
  const [tasks, setTasks] = useState<TeamTask[]>(staticTasks || []);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number>(0);
  const isLive = !staticTasks;

  const load = useCallback(async () => {
    try {
      const data = await window.jarvis.getTasks();
      setTasks(Array.isArray(data) ? data : []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    if (!isLive) return;
    void load();
    timerRef.current = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timerRef.current);
  }, [isLive, load]);

  if (tasks.length === 0) {
    return (
      <div className="empty-artifact">
        <p>
          {error
            ? `Team board error: ${error}`
            : "No delegated tasks yet. Ask NetJarvis to hand work to the team, e.g. \u201cHand this to the data team: full spanning tree health check.\u201d Tasks move across this board as agents work them."}
        </p>
      </div>
    );
  }

  return (
    <div className="kanban">
      {COLUMNS.map((column) => {
        const items = tasks.filter((task) => column.key.includes(task.status));
        return (
          <section className={`kanban-column ${column.className}`} key={column.title}>
            <header>
              <h3>{column.title}</h3>
              <span>{items.length}</span>
            </header>
            <div className="kanban-cards">
              {items.map((task) => (
                <TaskCard task={task} key={task.id} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskCard({ task }: { task: TeamTask }) {
  const [expanded, setExpanded] = useState(false);
  const failed = task.status === "failed";
  const steps = task.steps || [];

  function copyAsEmail() {
    const subject = `[NOC] ${task.teamName}: ${task.title}`;
    const body = [
      `Team: ${task.teamName}`,
      `Task: ${task.request || task.title}`,
      `Status: ${task.status}${failed && task.error ? ` (${task.error})` : ""}`,
      `Opened: ${task.createdAt}`,
      "",
      "Report:",
      task.result || "(no report yet)",
      "",
      "-- Sent from NetJarvis",
    ].join("\n");
    void navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
  }

  return (
    <article className={`kanban-card kanban-card-${task.status}`}>
      <header>
        <span className="kanban-team">{TEAM_BADGE[task.team] || task.team.toUpperCase()}</span>
        <small>{task.id}</small>
      </header>
      <p className="kanban-title">{task.title}</p>
      {task.status === "in_progress" && steps.length > 0 ? <p className="kanban-step">{steps[steps.length - 1].text}</p> : null}
      {failed ? <p className="kanban-error">{task.error}</p> : null}
      {expanded ? (
        <div className="kanban-detail">
          {steps.length > 0 ? (
            <ul>
              {steps.map((step, index) => (
                <li key={index}>
                  <time>{step.ts.slice(11, 19)}</time> {step.text}
                </li>
              ))}
            </ul>
          ) : null}
          {task.result ? <pre>{task.result}</pre> : null}
        </div>
      ) : null}
      <footer>
        <time>{task.updatedAt.slice(11, 16)}</time>
        <div className="kanban-actions">
          {steps.length > 0 || task.result ? (
            <button onClick={() => setExpanded((value) => !value)}>{expanded ? "Less" : "Detail"}</button>
          ) : null}
          {task.result ? <button onClick={copyAsEmail}>Copy email</button> : null}
        </div>
      </footer>
    </article>
  );
}
