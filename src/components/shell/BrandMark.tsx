/** Product mark. Colors come from the active palette. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="ops-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="5" fill="var(--mark-fill)" />
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="4.25" fill="none" stroke="var(--accent)" strokeOpacity="0.55" />
      <path d="M7.5 22.2a10.2 10.2 0 0 1 17 0" fill="none" stroke="var(--accent)" strokeWidth="1.35" strokeLinecap="round" />
      <path d="M10.6 19.6a6.8 6.8 0 0 1 10.8 0" fill="none" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
      <circle cx="16" cy="12.2" r="2.35" fill="var(--voice-ink)" />
      <path d="M16 14.6v7.4" stroke="var(--voice-ink)" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}
