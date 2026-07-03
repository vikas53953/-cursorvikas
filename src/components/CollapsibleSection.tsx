import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type CollapsibleSectionProps = {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  badge?: string;
  children: ReactNode;
};

// NOC-style accordion section — collapsed by default to reduce visual noise.
export function CollapsibleSection({ title, count, defaultOpen = false, badge, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`noc-section ${open ? "noc-section-open" : ""}`}>
      <button type="button" className="noc-section-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="noc-section-title">
          {title}
          {count != null ? <em className="noc-section-count">{count}</em> : null}
          {badge ? <span className="noc-section-badge">{badge}</span> : null}
        </span>
        <ChevronDown size={16} className={open ? "noc-chevron-open" : ""} />
      </button>
      {open ? <div className="noc-section-body">{children}</div> : null}
    </section>
  );
}
