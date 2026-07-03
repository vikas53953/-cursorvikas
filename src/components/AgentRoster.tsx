import { useCallback, useEffect, useRef, useState } from "react";
import type { JarvisMood } from "../lib/realtime";
import type { AgentOrg, TeamTask } from "../vite-env";

type AgentRosterProps = {
  mood?: JarvisMood;
  tasks?: TeamTask[];
};

type AgentVisualState = "idle" | "active" | "handoff-target";

// Agent hierarchy on Team Board — idle by default, highlights handoff target when working.
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

  const handoff = findHandoff(tasks);
  const recent = tasks.slice(0, 6);

  return (
    <aside className="agent-roster agent-roster-board">
      <header className="agent-roster-jarvis">
        <div className={`agent-node agent-node-jarvis agent-jarvis-${mood} ${handoff ? "agent-node-handoff-source" : ""}`}>
          <span className={`agent-dot agent-dot-jarvis agent-dot-${mood}`} />
          <div>
            <strong>{org?.jarvis?.name || "NetJarvis"}</strong>
            <small>{jarvisStateLabel(mood)}</small>
          </div>
        </div>
      </header>

      {handoff ? (
        <div className="agent-handoff-flow">
          <span className="agent-handoff-arrow">Jarvis handing off →</span>
          <strong>{handoff.teamName}</strong>
          <p>{handoff.title}</p>
          <em className={`agent-handoff-status agent-handoff-${handoff.status}`}>{handoff.status.replace("_", " ")}</em>
        </div>
      ) : (
        <p className="agent-handoff-idle">All specialists idle. Jarvis listens, then routes work to one agent.</p>
      )}

      {org?.groups?.map((group) => (
        <section className="agent-group" key={group.id}>
          <h3>{group.name}</h3>
          <ul>
            {group.agents.map((agent) => {
              const visual = agentVisualState(agent.id, tasks, handoff);
              return (
                <li key={agent.id} className={`agent-node-li agent-state-${visual}`}>
                  <span className={`agent-dot agent-dot-${visual}`} />
                  <span className="agent-name">{agent.name}</span>
                  {visual === "active" ? <em className="agent-active-badge">working</em> : null}
                  {visual === "handoff-target" ? <em className="agent-active-badge agent-badge-handoff">handoff</em> : null}
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
                <time>{task.updatedAt.slice(11, 19)}</time>
                <strong>{task.source === "delegated" ? "Jarvis →" : "Jarvis"}</strong>
                <span>
                  {task.source === "delegated" ? `${task.teamName}: ` : ""}
                  {task.title}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="agent-feed-empty">Waiting for activity...</p>
        )}
      </section>
    </aside>
  );
}

function jarvisStateLabel(mood: JarvisMood): string {
  if (mood === "listening") return "Listening";
  if (mood === "thinking") return "Thinking";
  if (mood === "speaking") return "Speaking";
  if (mood === "working") return "Delegating / running tools";
  if (mood === "error") return "Error";
  return "SME Lead · idle";
}

function findHandoff(tasks: TeamTask[]): TeamTask | null {
  return tasks.find((task) => task.status === "in_progress") || tasks.find((task) => task.status === "queued") || null;
}

function agentVisualState(agentId: string, tasks: TeamTask[], handoff: TeamTask | null): AgentVisualState {
  if (handoff && handoff.team === agentId && (handoff.status === "queued" || handoff.status === "in_progress")) {
    return "handoff-target";
  }
  const active = tasks.some((task) => task.team === agentId && (task.status === "queued" || task.status === "in_progress"));
  return active ? "active" : "idle";
}
