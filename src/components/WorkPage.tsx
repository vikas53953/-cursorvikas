import { useState } from "react";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { ObservabilityPanel, type ObservabilityEvent } from "./ObservabilityPanel";
import { EmptyState } from "./ui/EmptyState";
import type { JarvisArtifact } from "../vite-env";
import type { TranscriptEntry } from "../lib/realtime";

type WorkPageProps = {
  events: ObservabilityEvent[];
  artifact: JarvisArtifact | null;
  sessionLog: TranscriptEntry[];
  assistantName: string;
};

export function WorkPage({ events, artifact, sessionLog, assistantName }: WorkPageProps) {
  const [tab, setTab] = useState<"current" | "library">("current");

  return (
    <div className="page work-page">
      <header className="page-toolbar">
        <div>
          <h1>Work</h1>
          <p className="page-sub">The last tool run lands here. Library is the download history.</p>
        </div>
        <div className="ui-seg" role="tablist" aria-label="Work">
          <button type="button" className={tab === "current" ? "active" : ""} onClick={() => setTab("current")}>
            Current
          </button>
          <button type="button" className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>
            Library
          </button>
        </div>
      </header>
      {tab === "current" ? (
        artifact || events.length > 0 ? (
          <ObservabilityPanel events={events} artifact={artifact} sessionLog={sessionLog} />
        ) : (
          <EmptyState
            title="No run yet"
            detail={`Ask ${assistantName} from Voice, or run Investigate. CLI, tables, and the narrative of the last run land here.`}
          />
        )
      ) : (
        <ArtifactsPanel assistantName={assistantName} />
      )}
    </div>
  );
}
