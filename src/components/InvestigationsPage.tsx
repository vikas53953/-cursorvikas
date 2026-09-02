import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, FlaskConical, Play, Search } from "lucide-react";
import { StatusPill, severityTone, type Tone } from "./ui/StatusPill";
import type { ArtifactRecord, JarvisArtifact } from "../vite-env";

type SeedKind = "user" | "ip" | "host";

const PLATFORMS = ["network", "vpn", "proxy", "firewall", "endpoint", "identity", "cloud", "siem"] as const;
type Platform = (typeof PLATFORMS)[number];

const WINDOWS: Array<{ label: string; hours: number }> = [
  { label: "Last hour", hours: 1 },
  { label: "Last 6 hours", hours: 6 },
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 3 days", hours: 72 },
  { label: "Last 7 days", hours: 168 },
  { label: "Last 30 days", hours: 720 },
];

type Coverage = { provider: string; platform: string; status: "ok" | "empty" | "unconfigured" | "failed"; count: number; error?: string; ms?: number | null };
type TimelineRow = { ts: string; platform: string; severity: string; summary: string; entities: Record<string, string>; provider: string };
type Pivot = { kind: SeedKind; value: string; count: number; platforms: string[]; firstSeen: string; lastSeen: string };

type InvestigationResult = {
  ok: boolean;
  error?: string;
  id?: string;
  fixture?: boolean;
  entity?: { kind: SeedKind; value: string };
  window?: { from: string; to: string; hours: number };
  summary?: string;
  counts?: { total: number; shown: number; byPlatform: Record<string, number>; droppedDuplicates: number; droppedOutOfWindow: number; truncated: boolean };
  coverage?: Coverage[];
  observations?: string[];
  pivots?: Pivot[];
  gaps?: string[];
  timeline?: TimelineRow[];
  artifact?: JarvisArtifact;
};

type InvestigationsPageProps = {
  onOpenArtifact: (artifact: JarvisArtifact) => void;
  onActivity?: () => void;
};

export function InvestigationsPage({ onOpenArtifact, onActivity }: InvestigationsPageProps) {
  const [kind, setKind] = useState<SeedKind>("user");
  const [value, setValue] = useState("");
  const [hours, setHours] = useState(24);
  const [platforms, setPlatforms] = useState<Set<Platform>>(new Set(PLATFORMS));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<InvestigationResult | null>(null);
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [history, setHistory] = useState<ArtifactRecord[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const items = await window.jarvis.listArtifacts(200);
      setHistory((Array.isArray(items) ? items : []).filter((item) => item.tool === "investigate").slice(0, 20));
    } catch {
      // history is optional
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const run = useCallback(
    async (seedKind: SeedKind, seedValue: string) => {
      const trimmed = seedValue.trim();
      if (!trimmed || running) return;
      setRunning(true);
      setPlatformFilter("all");
      try {
        const args: Record<string, unknown> = { [seedKind]: trimmed, lookbackHours: hours };
        if (platforms.size > 0 && platforms.size < PLATFORMS.length) args.platforms = [...platforms];
        const response = (await window.jarvis.executeTool({ name: "investigate", arguments: args })) as unknown as InvestigationResult;
        setResult(response);
        onActivity?.();
        void loadHistory();
      } catch (error) {
        setResult({ ok: false, error: error instanceof Error ? error.message : String(error) });
      } finally {
        setRunning(false);
      }
    },
    [hours, platforms, running, onActivity, loadHistory],
  );

  function togglePlatform(platform: Platform) {
    setPlatforms((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }

  function pivotTo(pivot: Pivot) {
    setKind(pivot.kind);
    setValue(pivot.value);
    void run(pivot.kind, pivot.value);
  }

  const timeline = useMemo(() => {
    const rows = result?.timeline || [];
    return platformFilter === "all" ? rows : rows.filter((row) => row.platform === platformFilter);
  }, [result, platformFilter]);

  const timelinePlatforms = useMemo(() => Object.keys(result?.counts?.byPlatform || {}).sort(), [result]);

  return (
    <div className="inv">
      <section className="ui-card inv-seed">
        <div className="ui-card-body inv-seed-body">
          <div className="ui-seg" role="radiogroup" aria-label="Entity type">
            {(["user", "ip", "host"] as SeedKind[]).map((option) => (
              <button type="button" key={option} role="radio" aria-checked={kind === option} className={kind === option ? "on" : ""} onClick={() => setKind(option)}>
                {option === "ip" ? "IP address" : option === "user" ? "User" : "Host"}
              </button>
            ))}
          </div>
          <input
            className="ui-input inv-seed-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void run(kind, value);
            }}
            placeholder={kind === "user" ? "jdoe or jdoe@corp.example" : kind === "ip" ? "10.20.0.7" : "LT-4421 or sw1"}
            aria-label="Seed entity"
          />
          <select className="ui-select" value={hours} onChange={(event) => setHours(Number(event.target.value))} aria-label="Time window">
            {WINDOWS.map((window) => (
              <option key={window.hours} value={window.hours}>
                {window.label}
              </option>
            ))}
          </select>
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => void run(kind, value)} disabled={running || !value.trim()}>
            {running ? <span className="ui-spinner ui-spinner-sm" aria-hidden="true" /> : <Play size={14} />}
            {running ? "Correlating…" : "Run investigation"}
          </button>
        </div>
        <div className="inv-seed-platforms">
          <span className="ui-label">Platforms</span>
          <div className="chips">
            {PLATFORMS.map((platform) => (
              <button type="button" key={platform} className={`chip ${platforms.has(platform) ? "on" : ""}`} aria-pressed={platforms.has(platform)} onClick={() => togglePlatform(platform)}>
                {platform}
              </button>
            ))}
            <button type="button" className="chip chip-link" onClick={() => setPlatforms(new Set(PLATFORMS))}>
              all
            </button>
          </div>
        </div>
      </section>

      {result && result.ok === false ? (
        <div className="ui-banner ui-banner-bad">
          <AlertTriangle size={16} />
          <div>
            <strong>Investigation failed.</strong> {result.error}
          </div>
        </div>
      ) : null}

      {result && result.ok !== false ? (
        <>
          {result.fixture ? (
            <div className="ui-banner ui-banner-fixture">
              <FlaskConical size={16} />
              <div>
                <strong>FIXTURE DATA.</strong> Rows from provider <code>fixture</code> come from the NetJarvis mock lab (NETJARVIS_EVIDENCE_FIXTURE), not from a real system.
              </div>
            </div>
          ) : null}

          <section className="ui-card">
            <header className="ui-card-head">
              <h2>
                Investigation <code className="inv-id">{result.id}</code>
                <span className="ui-muted">
                  {result.entity?.kind} <strong>{result.entity?.value}</strong> · {result.window?.hours}h
                </span>
              </h2>
              <div className="ui-card-actions">
                {result.artifact ? (
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onOpenArtifact(result.artifact!)}>
                    Open full report
                  </button>
                ) : null}
                {result.artifact?.downloadUrl ? (
                  <a className="ui-btn ui-btn-secondary ui-btn-sm" href={result.artifact.downloadUrl} download={result.artifact.downloadName || undefined}>
                    <Download size={13} /> Download
                  </a>
                ) : null}
              </div>
            </header>
            <div className="ui-card-body inv-summary">
              <p className="inv-lede">{result.summary?.replace(/^\[FIXTURE DATA[^\]]*\]\s*/, "")}</p>
              {result.observations && result.observations.length > 1 ? (
                <ul className="inv-observations">
                  {result.observations.slice(1).map((text, index) => (
                    <li key={index}>{text}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>

          <section className="ui-card">
            <header className="ui-card-head">
              <h2>
                Coverage <em className="ui-count">{result.coverage?.length ?? 0}</em>
              </h2>
              <span className="ui-muted">
                {result.counts?.total ?? 0} events after correlation · {result.counts?.droppedDuplicates ?? 0} duplicates · {result.counts?.droppedOutOfWindow ?? 0} outside window
              </span>
            </header>
            <div className="ui-card-body">
              <div className="coverage">
                {(result.coverage || []).map((cov) => (
                  <div key={`${cov.provider}-${cov.platform}`} className={`cov cov-${cov.status}`} title={cov.error || `${cov.provider} · ${cov.status}`}>
                    <span>{cov.platform}</span>
                    <strong>{cov.status === "unconfigured" ? "—" : cov.count}</strong>
                    <small>
                      {cov.provider} · {cov.status}
                      {cov.ms != null && cov.status !== "unconfigured" ? ` · ${cov.ms} ms` : ""}
                    </small>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="ui-card">
            <header className="ui-card-head">
              <h2>
                Timeline <em className="ui-count">{timeline.length}</em>
                {result.counts?.truncated ? <span className="ui-muted">showing first {result.counts.shown} of {result.counts.total}</span> : null}
              </h2>
              <div className="chips chips-sm">
                <button type="button" className={`chip ${platformFilter === "all" ? "on" : ""}`} onClick={() => setPlatformFilter("all")}>
                  All
                </button>
                {timelinePlatforms.map((platform) => (
                  <button type="button" key={platform} className={`chip ${platformFilter === platform ? "on" : ""}`} onClick={() => setPlatformFilter(platform)}>
                    {platform} <b>{result.counts?.byPlatform[platform]}</b>
                  </button>
                ))}
              </div>
            </header>
            {timeline.length === 0 ? (
              <div className="ui-empty">
                <Search size={26} />
                <strong>No events in the window</strong>
                <span>Nothing matched this entity on the platforms that returned data. See Gaps below.</span>
              </div>
            ) : (
              <div className="table-scroll table-scroll-tall">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Time (UTC)</th>
                      <th>Platform</th>
                      <th>Severity</th>
                      <th>Event</th>
                      <th>Who / where</th>
                      <th>Provider</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.map((row, index) => (
                      <tr key={`${row.ts}-${index}`}>
                        <td className="mono nowrap">{row.ts.replace("T", " ").replace(/\.\d{3}Z$/, "Z")}</td>
                        <td>
                          <StatusPill tone="neutral" dot={false} label={row.platform} />
                        </td>
                        <td>
                          <StatusPill tone={severityTone(row.severity)} label={row.severity} />
                        </td>
                        <td className="inv-event">{row.summary}</td>
                        <td className="mono inv-who">{whoWhere(row.entities)}</td>
                        <td className={`inv-provider ${row.provider === "fixture" ? "inv-provider-fixture" : ""}`}>{row.provider}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="inv-grid">
            <section className="ui-card">
              <header className="ui-card-head">
                <h2>
                  Related entities <em className="ui-count">{result.pivots?.length ?? 0}</em>
                </h2>
                <span className="ui-muted">Co-occur with the seed. Click to investigate next.</span>
              </header>
              {!result.pivots || result.pivots.length === 0 ? (
                <div className="ui-empty">
                  <strong>No related entities</strong>
                  <span>No other users, IPs or hosts appear on the same evidence rows.</span>
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Kind</th>
                        <th>Value</th>
                        <th className="num">Rows</th>
                        <th>Platforms</th>
                        <th>Last seen</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {result.pivots.map((pivot) => (
                        <tr key={`${pivot.kind}-${pivot.value}`}>
                          <td className="cap">{pivot.kind}</td>
                          <td className="mono">
                            <strong>{pivot.value}</strong>
                          </td>
                          <td className="num">{pivot.count}</td>
                          <td>{pivot.platforms.join(", ")}</td>
                          <td className="mono nowrap">{pivot.lastSeen.replace("T", " ").replace(/\.\d{3}Z$/, "Z")}</td>
                          <td className="num">
                            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => pivotTo(pivot)} disabled={running}>
                              Investigate
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="ui-card">
              <header className="ui-card-head">
                <h2>
                  Gaps <em className={`ui-count ${result.gaps?.length ? "ui-count-warn" : ""}`}>{result.gaps?.length ?? 0}</em>
                </h2>
              </header>
              {!result.gaps || result.gaps.length === 0 ? (
                <div className="ui-empty">
                  <strong>Full coverage</strong>
                  <span>Every provider returned evidence.</span>
                </div>
              ) : (
                <ul className="inv-gaps">
                  {result.gaps.map((gap, index) => (
                    <li key={index}>
                      <StatusPill tone={gapTone(gap)} dot={false} label={gap.split(":")[0]} />
                      <span>{gap.slice(gap.indexOf(":") + 1).trim()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : null}

      {!result ? (
        <div className="ui-card ui-empty ui-empty-tall">
          <Search size={28} />
          <strong>Start an investigation</strong>
          <span>Pick a user, IP or host and a window. NetJarvis correlates every configured evidence provider into one timestamped timeline and lists what it could not see.</span>
        </div>
      ) : null}

      <section className="ui-card">
        <header className="ui-card-head">
          <h2>
            Recent investigations <em className="ui-count">{history.length}</em>
          </h2>
        </header>
        {history.length === 0 ? (
          <div className="ui-empty">
            <strong>No saved investigations yet</strong>
            <span>Each run is saved as a report you can download or open later.</span>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Created</th>
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.title}</strong>
                    </td>
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
        )}
      </section>
    </div>
  );
}

function whoWhere(entities: Record<string, string>): string {
  return [entities.user, entities.srcIp, entities.destIp ? `→ ${entities.destIp}` : "", entities.host && entities.host !== entities.device ? entities.host : entities.device]
    .filter(Boolean)
    .join(" · ");
}

function gapTone(gap: string): Tone {
  if (/not configured/.test(gap)) return "neutral";
  if (/failed/.test(gap)) return "bad";
  return "warn";
}
