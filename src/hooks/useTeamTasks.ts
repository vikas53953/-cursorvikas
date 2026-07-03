import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTeamTasks } from "../lib/tasks";
import type { TaskListResponse } from "../vite-env";

const FAST_MS = 1000;

export function useTeamTasks(active: boolean, refreshToken = 0) {
  const [data, setData] = useState<TaskListResponse>({
    tasks: [],
    total: 0,
    limit: 0,
    offset: 0,
    storeCap: 500,
    storeCount: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string>("");
  const timerRef = useRef<number>(0);

  const load = useCallback(async () => {
    try {
      const result = await fetchTeamTasks({ limit: 500 });
      setData(result);
      setLastSync(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    timerRef.current = window.setInterval(() => void load(), FAST_MS);
    return () => window.clearInterval(timerRef.current);
  }, [active, load, refreshToken]);

  return { ...data, error, lastSync, reload: load };
}
