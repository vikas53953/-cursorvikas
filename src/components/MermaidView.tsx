import { useEffect, useId, useMemo, useState } from "react";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "strict",
});

export function MermaidView({ source }: { source: string }) {
  const rawId = useId();
  const mermaidId = useMemo(() => `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`, [rawId]);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!source.trim()) {
      setSvg("");
      setError(null);
      return;
    }
    void (async () => {
      try {
        const rendered = await mermaid.render(mermaidId, source);
        if (!cancelled) {
          setSvg(rendered.svg);
          setError(null);
        }
      } catch (renderError) {
        if (!cancelled) {
          setSvg("");
          setError(renderError instanceof Error ? renderError.message : String(renderError));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mermaidId, source]);

  if (error) return <p className="ui-empty">Mermaid render failed: {error}</p>;
  if (!svg) return <p className="ui-empty">Rendering diagram…</p>;
  return <div className="mermaid-output" dangerouslySetInnerHTML={{ __html: svg }} />;
}
