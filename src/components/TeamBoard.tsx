import { useCallback, useEffect, useRef, useState } from "react";
import { AgentRoster } from "./AgentRoster";
import type { TeamTask } from "../vite-env";

const COLUMNS: Array<{ key: TeamTask["status"][]; title: string; className: string }> = [
  { key: ["queued"], title: "Queued", className: "kanban-queued" },
  { key: ["in_progress"], title: "In Progress", className: "kanban-progress" },
  { key: ["done", "failed"], title: "Done", className: "kanban-done" },
];

const TEAM_BADGE: Record<string, string> = {
  jarvis: "JARVIS",
  data: "DATA",
  firewall: "FW",
  loadbalancer: "LB",
  proxy: "PROXY",
  change: "CHG",
  incident: "INC",
  problem: "PRB",
};

const PAGE = 20;

type TeamBoardProps = {
  staticTasks?: TeamTask[];
};

export function TeamBoard({ staticTasks }: TeamBoardProps) {
  const [tasks, setTasks] = useState<TeamTask[]>(staticTasks || []);
  const [storeCount, setStoreCount] = useState(0);
  const [storeCap, setStoreCap] = useState(500);
  const [doneVisible, setDoneVisible] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number>(0);
  const isLive = !staticTasks;

  const load = useCallback(async () => {
    try {
      const data = await window.jarvis.getTasks({ limit: 500 });
      setTasks(data.tasks || []);
      setStoreCount(data.storeCount || 0);
      setStoreCap(data.storeCap || 500);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    if (!isLive) return;
    void load();
    timerRef.current = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timerRef.current);
  }, [isLive, load]);

  if (!isLive && tasks.length === 0) {
    return (
      <div className="empty-artifact">
        <p>No delegated tasks in this snapshot.</p>
      </div>
    );
  }

  const doneItems = tasks.filter((task) => task.status === "done" || task.status === "failed");

  return (
    <div className="team-board-layout">
      <AgentRoster tasks={tasks} />

      <div className="team-board-main">
        <header className="team-board-toolbar">
          <div>
            <strong>Task board</strong>
            <p>
              {storeCount} tasks in store (cap {storeCap}) · showing latest per column
            </p>
          </div>
          {error ? <span className="team-board-error">{error}</span> : null}
        </header>

        {tasks.length === 0 ? (
          <div className="empty-artifact team-board-empty">
            <p>Every tool run and delegation appears here. Ask Jarvis to investigate — you will see Jarvis hand off to the agent on the left.</p>
          </div>
        ) : (
          <div className="kanban">
            {COLUMNS.map((column) => {
              const items = tasks.filter((task) => column.key.includes(task.status));
              const isDone = column.title === "Done";
              const visible = isDone ? items.slice(0, doneVisible) : items;
              return (
                <section className={`kanban-column ${column.className}`} key={column.title}>
                  <header>
                    <h3>{column.title}</h3>
                    <span>{items.length}</span>
                  </header>
                  <div className="kanban-cards">
                    {visible.map((task) => (
                      <TaskCard task={task} key={task.id} />
                    ))}
                  </div>
                  {isDone && doneVisible < items.length ? (
                    <button className="noc-load-more kanban-load-more" onClick={() => setDoneVisible((count) => count + PAGE)}>
                      Load more ({items.length - doneVisible} in Done)
                    </button>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: TeamTask }) {
  const [expanded, setExpanded] = useState(false);
  const failed = task.status === "failed";
  const steps = task.steps || [];
  const delegated = task.source === "delegated";

  function copyAsEmail() {
    const subject = `[NOC] ${task.teamName}: ${task.title}`;
    const body = [
      `Team: ${task.teamName}`,
      `Executor: ${task.executor === "jarvis" ? "NetJarvis" : task.teamName}`,
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

  function downloadArtifact() {
    if (!task.artifactId) return;
    const anchor = document.createElement("a");
    anchor.href = `/api/artifacts/${task.artifactId}/download`;
    anchor.download = "";
    anchor.click();
  }

  return (
    <article className={`kanban-card kanban-card-${task.status}`}>
      <header>
        <span className="kanban-team">{TEAM_BADGE[task.team] || task.team.toUpperCase()}</span>
        <small>{task.id}</small>
      </header>
      <p className="kanban-title">{task.title}</p>
      <p className="kanban-meta">
        {delegated ? "Jarvis → " : ""}
        {task.teamName}
        {task.tool ? ` · ${task.tool}` : ""}
      </p>
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
          {steps.length > 0 || task.result ? <button onClick={() => setExpanded((value) => !value)}>{expanded ? "Less" : "Detail"}</button> : null}
          {task.artifactId ? <button onClick={downloadArtifact}>Download</button> : null}
          {task.result ? <button onClick={copyAsEmail}>Copy email</button> : null}
        </div>
      </footer>
    </article>
  );
}
