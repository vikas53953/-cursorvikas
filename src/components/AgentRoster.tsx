import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentOrg, TeamTask } from "../vite-env";

type AgentRosterProps = {
  mood?: "idle" | "listening" | "thinking" | "speaking" | "working" | "error";
};

// Hierarchical agent team on the operations dashboard (right panel).
export function AgentRoster({ mood = "idle" }: AgentRosterProps) {
  const [org, setOrg] = useState<AgentOrg | null>(null);
  const [tasks, setTasks] = useState<TeamTask[]>([]);
  const timerRef = useRef<number>(0);

  const load = useCallback(async () => {
    try {
      const [orgData, taskData] = await Promise.all([window.jarvis.getOrg(), window.jarvis.getTasks()]);
      setOrg(orgData);
      setTasks(Array.isArray(taskData) ? taskData : []);
    } catch {
      // Keep last good state on transient errors.
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timerRef.current);
  }, [load]);

  const active = buildActiveMap(tasks);
  const recent = tasks.slice(0, 4);

  return (
    <section className="agent-roster agent-roster-dashboard">
      <header className="agent-roster-jarvis">
        <div className={`agent-node agent-node-jarvis agent-mood-${mood}`}>
          <span className="agent-dot" />
          <div>
            <strong>{org?.jarvis?.name || "NetJarvis"}</strong>
            <small>{org?.jarvis?.role || "SME Lead"}</small>
          </div>
          {active.jarvis ? <em className="agent-active-badge">{active.jarvis} active</em> : null}
        </div>
      </header>

      {org?.groups?.map((group) => (
        <section className="agent-group" key={group.id}>
          <h3>{group.name}</h3>
          <ul>
            {group.agents.map((agent) => {
              const count = active[agent.id] || 0;
              return (
                <li key={agent.id} className={count > 0 ? "agent-node-active" : ""}>
                  <span className="agent-dot" />
                  <span className="agent-name">{agent.name}</span>
                  {count > 0 ? <em className="agent-active-badge">{count}</em> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {recent.length > 0 ? (
        <section className="agent-feed">
          <h3>Live delegation</h3>
          <ul>
            {recent.map((task) => (
              <li key={task.id} className={`agent-feed-${task.status}`}>
                <time>{task.updatedAt.slice(11, 16)}</time>
                <strong>{task.executor === "jarvis" ? "Jarvis" : task.teamName}</strong>
                <span>{task.title}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="agent-feed-empty">Delegated tasks and tool runs appear here live.</p>
      )}
    </section>
  );
}

function buildActiveMap(tasks: TeamTask[]): Record<string, number> {
  const active: Record<string, number> = {};
  for (const task of tasks) {
    if (task.status === "queued" || task.status === "in_progress") {
      const key = task.executor === "jarvis" ? "jarvis" : task.team;
      active[key] = (active[key] || 0) + 1;
    }
  }
  return active;
}
