import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Search } from "lucide-react";
import { StatusPill } from "./ui/StatusPill";
import type { ArtifactRecord } from "../vite-env";

const PAGE = 30;

// Reports page: the artifact library as a searchable data table.
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
    const hay = `${item.title} ${item.tool} ${item.team} ${item.kind}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });
  const shown = filtered.slice(0, visible);

  return (
    <section className="ui-card">
      <header className="ui-card-head ui-card-head-toolbar">
        <h2>
          Artifact library <em className="ui-count">{filtered.length}</em>
        </h2>
        <label className="ui-search">
          <Search size={14} aria-hidden="true" />
          <input
            className="ui-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisible(PAGE);
            }}
            placeholder="Search title, tool, team…"
            aria-label="Search artifacts"
          />
        </label>
      </header>

      {filtered.length === 0 ? (
        <div className="ui-empty ui-empty-tall">
          <FileText size={28} />
          <strong>{items.length === 0 ? "No reports yet" : "No reports match your search"}</strong>
          <span>{items.length === 0 ? "Ask NetJarvis for a report, table or CLI capture — it is saved here automatically." : "Try a different title, tool or team."}</span>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Kind</th>
                  <th>Team</th>
                  <th>Tool</th>
                  <th>Created</th>
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.title}</strong>
                      <div className="cell-note mono">{item.id}</div>
                    </td>
                    <td>
                      <StatusPill tone={item.kind === "code" ? "accent" : item.kind === "table" ? "info" : "neutral"} dot={false} label={item.kind} />
                    </td>
                    <td className="cap">{item.team}</td>
                    <td className="mono">{item.tool}</td>
                    <td className="mono nowrap">{item.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="num">
                      <a className="ui-btn ui-btn-ghost ui-btn-sm" href={item.downloadUrl} download={item.downloadName || undefined}>
                        <Download size={13} /> Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className="ui-card-foot">
            <span className="ui-muted">
              Showing {shown.length} of {filtered.length} · store keeps the latest 200
            </span>
            {visible < filtered.length ? (
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setVisible((count) => count + PAGE)}>
                Load more ({filtered.length - visible} remaining)
              </button>
            ) : null}
          </footer>
        </>
      )}
    </section>
  );
}
