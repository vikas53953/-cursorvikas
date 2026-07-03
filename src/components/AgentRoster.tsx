import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentOrg, TeamTask } from "../vite-env";

type AgentRosterProps = {
  mood?: "idle" | "listening" | "thinking" | "speaking" | "working" | "error";
  tasks?: TeamTask[];
};

// Agent hierarchy for Team Board sidebar — shows who Jarvis is handing work to.
export function AgentRoster({ mood = "idle", tasks = [] }: AgentRosterProps) {
  const [org, setOrg] = useState<AgentOrg | null>(null);
  const timerRef = useRef<number>(0);

  const load = useCallback(async () => {
    try {
      setOrg(await window.jarvis.getOrg());
    } catch {
      // Keep last good org chart.
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timerRef.current);
  }, [load]);

  const active = buildActiveMap(tasks);
  const handoff = useMemo(() => findHandoff(tasks), [tasks]);
  const recent = tasks.slice(0, 6);

  return (
    <aside className="agent-roster agent-roster-board">
      <header className="agent-roster-jarvis">
        <div className={`agent-node agent-node-jarvis agent-mood-${mood} ${handoff ? "agent-node-handoff-source" : ""}`}>
          <span className="agent-dot" />
          <div>
            <strong>{org?.jarvis?.name || "NetJarvis"}</strong>
            <small>{org?.jarvis?.role || "SME Lead"}</small>
          </div>
        </div>
      </header>

      {handoff ? (
        <div className="agent-handoff-flow">
          <span className="agent-handoff-arrow">handing off →</span>
          <strong>{handoff.teamName}</strong>
          <p>{handoff.title}</p>
        </div>
      ) : (
        <p className="agent-handoff-idle">Jarvis routes work to the specialist below when you delegate or run a domain tool.</p>
      )}

      {org?.groups?.map((group) => (
        <section className="agent-group" key={group.id}>
          <h3>{group.name}</h3>
          <ul>
            {group.agents.map((agent) => {
              const count = active[agent.id] || 0;
              const isTarget = handoff?.team === agent.id;
              return (
                <li key={agent.id} className={[count > 0 ? "agent-node-active" : "", isTarget ? "agent-node-handoff-target" : ""].filter(Boolean).join(" ")}>
                  <span className="agent-dot" />
                  <span className="agent-name">{agent.name}</span>
                  {count > 0 ? <em className="agent-active-badge">{count}</em> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="agent-feed">
        <h3>Live delegation</h3>
        {recent.length > 0 ? (
          <ul>
            {recent.map((task) => (
              <li key={task.id} className={`agent-feed-${task.status}`}>
                <time>{task.updatedAt.slice(11, 16)}</time>
                <strong>{task.source === "delegated" ? "Jarvis →" : "Jarvis"}</strong>
                <span>
                  {task.source === "delegated" ? `${task.teamName}: ` : ""}
                  {task.title}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="agent-feed-empty">No delegations yet.</p>
        )}
      </section>
    </aside>
  );
}

function findHandoff(tasks: TeamTask[]): TeamTask | null {
  return tasks.find((task) => task.status === "in_progress" || task.status === "queued") || null;
}

function buildActiveMap(tasks: TeamTask[]): Record<string, number> {
  const active: Record<string, number> = {};
  for (const task of tasks) {
    if (task.status === "queued" || task.status === "in_progress") {
      const key = task.executor === "jarvis" && task.source !== "delegated" ? task.team : task.team;
      active[key] = (active[key] || 0) + 1;
    }
  }
  return active;
}
