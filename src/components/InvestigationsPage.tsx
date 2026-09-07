import { useEffect, useMemo, useState } from "react";
import { PathViz } from "./PathViz";
import { EmptyState } from "./ui/EmptyState";
import { StatusPill, toneFromSeverity, toneFromStatus } from "./ui/StatusPill";
import { Markdown } from "./Markdown";
import type { InvestigationPivot, InvestigationResult } from "../vite-env";

const LOOKBACKS = [1, 6, 12, 24, 72];
const SEED_KINDS = ["user", "ip", "host"] as const;

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

  function applyWindow(hours: number) {
    onLookbackHours(hours);
    const seed = parseSeed(value);
    if (seed && (result || busy)) void run(seed, hours);
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
    <div className="page investigate-page investigate-views">
      <header className="views-bar">
        <div className="views-seed">
          <div className="ui-seg" role="tablist" aria-label="Seed kind">
            {SEED_KINDS.map((item) => (
              <button
                key={item}
                type="button"
                className={kind === item ? "active" : ""}
                onClick={() => setKind(item)}
              >
                {item === "ip" ? "IP" : item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <form
            className="views-value"
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
          >
            <input
              name="seed-value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={kind === "ip" ? "10.20.0.7" : kind === "host" ? "LT-4421 or vpn-asa-1" : "jdoe"}
              aria-label="Investigation seed"
            />
            <button className="ui-btn ui-btn-primary" type="submit" disabled={busy}>
              {busy ? "Running" : "Run"}
            </button>
          </form>
        </div>
        <div className="views-window" role="group" aria-label="Time window">
          {LOOKBACKS.map((hours) => (
            <button
              key={hours}
              type="button"
              className={lookbackHours === hours ? "active" : ""}
              onClick={() => applyWindow(hours)}
            >
              {hours}h
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <EmptyState tone="bad" title="Investigation failed" detail={error} action={{ label: "Try again", onClick: () => void run() }} />
      ) : null}

      {!result && !busy && !error ? (
        <EmptyState
          title="Pick a seed"
          detail="User, IP, or host. The hop path is the view — identity through SIEM. Unconfigured platforms stay empty."
        />
      ) : null}

      {busy && !result ? (
        <EmptyState title="Collecting evidence" detail="Reading each configured platform in the lookback window. Empty hops stay empty." />
      ) : null}

      {result?.ok ? (
        <>
          {result.fixture ? (
            <div className="ui-banner ui-banner-fixture">
              FIXTURE DATA — mock lab, not a live network. Enable only via NETJARVIS_EVIDENCE_FIXTURE.
            </div>
          ) : null}

          <section className="dashlet views-hero">
            <header className="dashlet-head">
              <h2>
                Path · {result.entity?.kind} {result.entity?.value}
              </h2>
              <span>
                {result.counts?.total ?? 0} events · {result.window?.hours ?? lookbackHours}h
                {busy ? " · refreshing" : ""}
              </span>
            </header>
            <p className="investigate-summary">{result.summary}</p>
            <PathViz
              coverage={result.coverage || []}
              timeline={result.timeline || []}
              selected={hop}
              onSelect={(platform) => setHop((current) => (current === platform ? null : platform))}
            />
            {(result.pivots || []).length > 0 ? (
              <div className="views-pivots">
                <span>Pivots</span>
                {(result.pivots || []).map((pivot) => (
                  <button key={`${pivot.kind}-${pivot.value}`} type="button" onClick={() => pivotTo(pivot)}>
                    {pivot.kind} {pivot.value}
                    <em>{pivot.count}</em>
                  </button>
                ))}
              </div>
            ) : (
              <p className="ui-empty">No related entities in this window.</p>
            )}
          </section>

          {findings.length > 0 ? (
            <ul className="views-findings">
              {findings.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}

          <section className="dashlet">
            <header className="dashlet-head">
              <h2>{hop ? `${hop} events` : "Events"}</h2>
              <div className="investigate-filters">
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
              <EmptyState title="No events in this slice" detail={hop ? `Clear the ${hop} hop, or widen the window.` : "Nothing in this window matched the severity filter."} />
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
                    <tr
                      key={`${event.ts}-${event.platform}-${index}`}
                      className={hop === event.platform ? "selected" : ""}
                      tabIndex={0}
                      onClick={() => setHop((current) => (current === event.platform ? null : event.platform))}
                    >
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

          {(result.gaps || []).length > 0 ? (
            <p className="views-gaps">
              Gaps: {(result.gaps || []).join(" · ")}
            </p>
          ) : null}

          {result.artifact?.content ? (
            <section className="dashlet">
              <header className="dashlet-head">
                <h2>Audit</h2>
              </header>
              <Markdown text={result.artifact.content} />
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
