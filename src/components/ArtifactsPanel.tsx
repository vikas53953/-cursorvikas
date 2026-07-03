import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactRecord } from "../vite-env";

const PAGE = 30;

// Download library — separate from live Reports.
export function ArtifactsPanel() {
  const [items, setItems] = useState<ArtifactRecord[]>([]);
  const [visible, setVisible] = useState(PAGE);
  const [query, setQuery] = useState("");
  const timerRef = useRef<number>(0);

  const load = useCallback(async () => {
    try {
      const data = await window.jarvis.listArtifacts(200);
      setItems(Array.isArray(data) ? data : []);
    } catch {
      // Keep last good list.
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timerRef.current);
  }, [load]);

  const filtered = items.filter((item) => {
    const hay = `${item.title} ${item.tool} ${item.team}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });
  const shown = filtered.slice(0, visible);

  return (
    <div className="artifacts-library">
      <header className="artifacts-library-header">
        <div>
          <h3>Artifact library</h3>
          <p>Download any saved report, table, CLI output, or diagram. Live voice output still lands on Reports first.</p>
        </div>
        <input
          className="artifacts-search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisible(PAGE);
          }}
          placeholder="Search artifacts..."
        />
      </header>

      {filtered.length === 0 ? (
        <div className="empty-artifact">
          <p>{items.length === 0 ? "No artifacts saved yet. Ask NetJarvis for a report — it will appear here for download." : "No artifacts match your search."}</p>
        </div>
      ) : (
        <>
          <p className="artifacts-meta">
            Showing {shown.length} of {filtered.length} artifacts · store keeps the latest 200
          </p>
          <ul className="artifacts-table">
            <li className="artifacts-table-head">
              <span>Title</span>
              <span>Team</span>
              <span>Tool</span>
              <span>Time</span>
              <span />
            </li>
            {shown.map((item) => (
              <li key={item.id}>
                <span className="artifacts-title">{item.title}</span>
                <span>{item.team}</span>
                <span>{item.tool}</span>
                <time>{item.createdAt.slice(0, 16).replace("T", " ")}</time>
                <a href={item.downloadUrl} download={item.downloadName || undefined}>
                  Download
                </a>
              </li>
            ))}
          </ul>
          {visible < filtered.length ? (
            <button className="noc-load-more" onClick={() => setVisible((count) => count + PAGE)}>
              Load more ({filtered.length - visible} remaining)
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
