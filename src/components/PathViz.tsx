import { StatusPill, toneFromSeverity, toneFromStatus, type Tone } from "./ui/StatusPill";
import type { InvestigationCoverage, InvestigationEvent } from "../vite-env";

export const HOP_ORDER = ["identity", "vpn", "firewall", "proxy", "endpoint", "network", "cloud", "siem"] as const;

const HOP_LABEL: Record<string, string> = {
  identity: "Identity",
  vpn: "Remote access",
  firewall: "Perimeter",
  proxy: "Web egress",
  endpoint: "Endpoint",
  network: "Campus",
  cloud: "Cloud",
  siem: "SIEM",
};

type PathVizProps = {
  coverage: InvestigationCoverage[];
  timeline: InvestigationEvent[];
  selected?: string | null;
  onSelect?: (platform: string) => void;
};

function worstSeverity(events: InvestigationEvent[]): string {
  const rank: Record<string, number> = { info: 1, low: 2, medium: 3, high: 4, critical: 5 };
  return events.reduce((acc, event) => ((rank[event.severity] || 0) > (rank[acc] || 0) ? event.severity : acc), "info");
}

function hopTone(status: string | undefined, events: InvestigationEvent[]): Tone {
  if (status === "unconfigured") return "neutral";
  if (status === "failed") return "bad";
  if (status === "empty" || events.length === 0) return "info";
  return toneFromSeverity(worstSeverity(events));
}

export function PathViz({ coverage, timeline, selected, onSelect }: PathVizProps) {
  const byPlatform = new Map(coverage.map((row) => [row.platform, row]));

  return (
    <div className="path-viz" role="list" aria-label="Evidence path">
      {HOP_ORDER.map((platform, index) => {
        const row = byPlatform.get(platform);
        const events = timeline.filter((event) => event.platform === platform);
        const status = row?.status || "unconfigured";
        const tone = hopTone(status, events);
        const active = selected === platform;
        return (
          <div className="path-hop-wrap" key={platform} role="listitem">
            {index > 0 ? <span className={`path-cable path-cable-${tone}`} aria-hidden="true" /> : null}
            <button
              type="button"
              className={`path-hop path-hop-${tone} ${active ? "path-hop-active" : ""}`}
              onClick={() => onSelect?.(platform)}
              aria-pressed={active}
            >
              <span className="path-hop-index">{index + 1}</span>
              <strong>{HOP_LABEL[platform] || platform}</strong>
              <em>{platform}</em>
              <StatusPill tone={toneFromStatus(status === "ok" && events.length ? "ok" : status)} label={status} dot={false} />
              <small>{events.length ? `${events.length} event${events.length === 1 ? "" : "s"}` : "no events"}</small>
            </button>
          </div>
        );
      })}
    </div>
  );
}
