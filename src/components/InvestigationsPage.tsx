import { useEffect, useMemo, useState } from "react";
import { PathViz } from "./PathViz";
import { StatusPill, toneFromSeverity, toneFromStatus } from "./ui/StatusPill";
import { Markdown } from "./Markdown";
import type { InvestigationPivot, InvestigationResult } from "../vite-env";

const LOOKBACKS = [1, 6, 12, 24, 72];

type InvestigationsPageProps = {
  lookbackHours: number;
  onLookbackHours: (hours: number) => void;
  pendingSeed?: { kind: "user" | "ip" | "host"; value: string } | null;
  onRecord?: (seed: { kind: "user" | "ip" | "host"; value: string }) => void;
};

function parseSeed(raw: string): { kind: "user" | "ip" | "host"; value: string } | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value)) {
    return { kind: "ip", value };
  }
  if (value.includes("@") || value.includes("\\")) return { kind: "user", value };
  if (/[.\-]/.test(value) || /\d$/.test(value)) return { kind: "host", value };
  return { kind: "user", value };
}

export function InvestigationsPage({ lookbackHours, onLookbackHours, pendingSeed, onRecord }: InvestigationsPageProps) {
  const [kind, setKind] = useState<"user" | "ip" | "host">(pendingSeed?.kind || "user");
  const [value, setValue] = useState(pendingSeed?.value || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InvestigationResult | null>(null);
  const [hop, setHop] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string>("all");

  useEffect(() => {
    if (!pendingSeed?.value) return;
    setKind(pendingSeed.kind);
    setValue(pendingSeed.value);
    void run(pendingSeed, lookbackHours);
    // Seed is applied once when the parent navigates here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSeed?.kind, pendingSeed?.value]);

  async function run(seed = parseSeed(value), hours = lookbackHours) {
    if (!seed) {
      setError("Enter a user, IP, or host.");
      return;
    }
    setKind(seed.kind);
    setValue(seed.value);
    setBusy(true);
    setError(null);
    setHop(null);
    try {
      const response = (await window.jarvis.executeTool({
        name: "investigate",
        arguments: { [seed.kind]: seed.value, lookbackHours: hours },
      })) as InvestigationResult;
      if (response.ok === false) {
        setResult(null);
        setError(response.error || "Investigation failed.");
        return;
      }
      setResult(response);
      onRecord?.(seed);
    } catch (runError) {
      setResult(null);
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setBusy(false);
    }
  }

  function pivotTo(pivot: InvestigationPivot) {
    const nextKind = pivot.kind === "ip" || pivot.kind === "host" || pivot.kind === "user" ? pivot.kind : "host";
    setKind(nextKind);
    setValue(pivot.value);
    void run({ kind: nextKind, value: pivot.value }, lookbackHours);
  }

  const timeline = result?.timeline || [];
  const filtered = useMemo(() => {
    return timeline.filter((event) => {
      if (hop && event.platform !== hop) return false;
      if (severity !== "all" && event.severity !== severity) return false;
      return true;
    });
  }, [timeline, hop, severity]);

  const findings = (result?.observations || []).filter((text) => !/^\[FIXTURE|\w+: \d+ event/.test(text));

  return (
    <div className="page investigate-page">
      <header className="page-toolbar">
        <div>
          <h1>Investigate</h1>
          <p className="page-sub">One user, IP, or host. Evidence from each platform on a single path. Read-only.</p>
        </div>
      </header>

      <section className="dashlet investigate-form">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <label>
            Seed
            <select name="seed-kind" value={kind} onChange={(event) => setKind(event.target.value as "user" | "ip" | "host")}>
              <option value="user">User</option>
              <option value="ip">IP</option>
              <option value="host">Host</option>
            </select>
          </label>
          <label className="investigate-value">
            Value
            <input
              name="seed-value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={kind === "ip" ? "10.20.0.7" : kind === "host" ? "LT-4421 or sw1" : "jdoe"}
            />
          </label>
          <label>
            Window
            <select value={lookbackHours} onChange={(event) => onLookbackHours(Number(event.target.value))}>
              {LOOKBACKS.map((hours) => (
                <option key={hours} value={hours}>
                  Last {hours}h
                </option>
              ))}
            </select>
          </label>
          <button className="ui-btn ui-btn-primary" type="submit" disabled={busy}>
            {busy ? "Running…" : "Run investigation"}
          </button>
        </form>
      </section>

      {error ? <div className="ui-banner ui-banner-bad">{error}</div> : null}

      {!result && !busy && !error ? (
        <div className="ui-empty investigate-empty">
          <p>No investigation yet. Run a seed (user, IP, or host). Unconfigured platforms stay empty — they are not filled in.</p>
        </div>
      ) : null}

      {busy ? (
        <div className="page-loading">
          <div className="progress-pulse" />
          <p>Collecting evidence across platforms…</p>
        </div>
      ) : null}

      {result?.ok ? (
        <>
          {result.fixture ? (
            <div className="ui-banner ui-banner-fixture">
              FIXTURE DATA — mock lab, not a live network. Enable only via NETJARVIS_EVIDENCE_FIXTURE.
            </div>
          ) : null}

          <section className="dashlet">
            <header className="dashlet-head">
              <h2>
                Path · {result.entity?.kind} {result.entity?.value}
              </h2>
              <span>
                {result.counts?.total ?? 0} events · {result.window?.hours ?? lookbackHours}h window
              </span>
            </header>
            <p className="investigate-summary">{result.summary}</p>
            <PathViz coverage={result.coverage || []} timeline={result.timeline || []} selected={hop} onSelect={(platform) => setHop((current) => (current === platform ? null : platform))} />
          </section>

          {findings.length > 0 ? (
            <section className="dashlet">
              <header className="dashlet-head">
                <h2>Observations</h2>
              </header>
              <ul className="investigate-findings">
                {findings.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="dashlet-grid">
            <section className="dashlet">
              <header className="dashlet-head">
                <h2>Coverage</h2>
              </header>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Platform</th>
                    <th>Status</th>
                    <th>Events</th>
                    <th>Provider</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.coverage || [])
                    .slice()
                    .sort((a, b) => a.status.localeCompare(b.status) || a.platform.localeCompare(b.platform))
                    .map((row) => (
                      <tr key={`${row.platform}-${row.provider}`}>
                        <td>{row.platform}</td>
                        <td>
                          <StatusPill tone={toneFromStatus(row.status)} label={row.status} />
                        </td>
                        <td>{row.count}</td>
                        <td className="mono">{row.provider || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>

            <section className="dashlet">
              <header className="dashlet-head">
                <h2>Related entities</h2>
              </header>
              {(result.pivots || []).length === 0 ? (
                <p className="ui-empty">No pivot entities in this window.</p>
              ) : (
                <ul className="pivot-list">
                  {(result.pivots || []).map((pivot) => (
                    <li key={`${pivot.kind}-${pivot.value}`}>
                      <button type="button" className="linkish" onClick={() => pivotTo(pivot)}>
                        {pivot.kind} {pivot.value}
                      </button>
                      <span>
                        {pivot.count} · {(pivot.platforms || []).join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {(result.gaps || []).length > 0 ? (
            <section className="dashlet">
              <header className="dashlet-head">
                <h2>Gaps</h2>
              </header>
              <ul className="investigate-gaps">
                {(result.gaps || []).map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="dashlet">
            <header className="dashlet-head">
              <h2>Event table</h2>
              <div className="investigate-filters">
                <label>
                  Hop
                  <select value={hop || "all"} onChange={(event) => setHop(event.target.value === "all" ? null : event.target.value)}>
                    <option value="all">All hops</option>
                    {(result.coverage || []).map((row) => (
                      <option key={row.platform} value={row.platform}>
                        {row.platform}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Severity
                  <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
                    <option value="all">All</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="info">Info</option>
                  </select>
                </label>
                <span>
                  {filtered.length} / {timeline.length}
                </span>
              </div>
            </header>
            {filtered.length === 0 ? (
              <p className="ui-empty">No events match the current filters.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time (UTC)</th>
                    <th>Hop</th>
                    <th>Severity</th>
                    <th>Summary</th>
                    <th>Provider</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((event, index) => (
                    <tr key={`${event.ts}-${event.platform}-${index}`}>
                      <td className="mono">{event.ts.replace("T", " ").replace(/\.\d+Z$/, "Z")}</td>
                      <td>{event.platform}</td>
                      <td>
                        <StatusPill tone={toneFromSeverity(event.severity)} label={event.severity} />
                      </td>
                      <td>{event.summary}</td>
                      <td className="mono">{event.provider || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {result.artifact?.content ? (
            <section className="dashlet">
              <header className="dashlet-head">
                <h2>Audit artifact</h2>
              </header>
              <Markdown text={result.artifact.content} />
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
