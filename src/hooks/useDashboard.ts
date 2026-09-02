import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardSnapshot } from "../vite-env";

const REFRESH_MS = 30000;

// One dashboard poller shared by the top bar (source badge) and the Overview page.
export function useDashboard() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number>(0);
  const retryRef = useRef<number>(0);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const data = await window.jarvis.getDashboard({ force });
      if (data.error && !data.mode) {
        setError(data.error);
      } else {
        setSnapshot(data);
        setError(data.liveError || data.staleError || null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      window.clearTimeout(retryRef.current);
      retryRef.current = window.setTimeout(() => void load(force), 5000);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    timerRef.current = window.setInterval(() => void load(false), REFRESH_MS);
    return () => {
      window.clearInterval(timerRef.current);
      window.clearTimeout(retryRef.current);
    };
  }, [load]);

  return { snapshot, loading, error, refresh: () => load(true) };
}
