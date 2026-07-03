import { useState } from "react";
import { AgentRoster } from "./AgentRoster";
import { useTeamTasks } from "../hooks/useTeamTasks";
import type { JarvisMood } from "../lib/realtime";
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
  mood?: JarvisMood;
  active?: boolean;
  refreshToken?: number;
};

export function TeamBoard({ staticTasks, mood = "idle", active = true, refreshToken = 0 }: TeamBoardProps) {
  const live = useTeamTasks(active && !staticTasks, refreshToken);
  const tasks = staticTasks || live.tasks;
  const [doneVisible, setDoneVisible] = useState(PAGE);

  if (!staticTasks && tasks.length === 0 && !live.error) {
    return (
      <div className="team-board-layout">
        <AgentRoster mood={mood} tasks={[]} />
        <div className="team-board-main">
          <header className="team-board-toolbar">
            <div>
              <strong>Task board</strong>
              <p>Syncing live tasks...</p>
            </div>
            {live.lastSync ? <span className="team-board-sync">sync {live.lastSync}</span> : null}
          </header>
          <div className="empty-artifact team-board-empty">
            <p>Waiting for Jarvis activity. When you delegate or run a tool, cards appear in Queued → In Progress → Done.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!staticTasks && tasks.length === 0 && live.error) {
    return (
      <div className="empty-artifact">
        <p>Team board error: {live.error}</p>
      </div>
    );
  }

  if (staticTasks && tasks.length === 0) {
    return (
      <div className="empty-artifact">
        <p>No delegated tasks in this snapshot.</p>
      </div>
    );
  }

  return (
    <div className="team-board-layout">
      <AgentRoster mood={mood} tasks={tasks} />

      <div className="team-board-main">
        <header className="team-board-toolbar">
          <div>
            <strong>Task board</strong>
            <p>
              {live.storeCount || tasks.length} tasks in store (cap {live.storeCap || 500}) · live sync every 1s
            </p>
          </div>
          <div className="team-board-toolbar-right">
            {live.lastSync ? <span className="team-board-sync">sync {live.lastSync}</span> : null}
            {live.error ? <span className="team-board-error">{live.error}</span> : null}
          </div>
        </header>

        <div className="kanban">
          {COLUMNS.map((column) => {
            const items = tasks.filter((task) => column.key.includes(task.status));
            const isDone = column.title === "Done";
            const visible = isDone ? items.slice(0, doneVisible) : items;
            return (
              <section className={`kanban-column ${column.className}`} key={column.title}>
                <header>
                  <h3>{column.title}</h3>
                  <span className={items.some((task) => task.status === "in_progress") && column.title === "In Progress" ? "kanban-live-pulse" : ""}>
                    {items.length}
                  </span>
                </header>
                <div className="kanban-cards">
                  {visible.length === 0 ? <p className="kanban-column-empty">—</p> : null}
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
