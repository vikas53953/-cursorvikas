/** Product mark for the rail. Geometric radar / watch — not a cartoon mesh. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="ops-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="vigil-mark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d3a5c" />
          <stop offset="1" stopColor="#061526" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="5" fill="url(#vigil-mark-fill)" />
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="4.25" fill="none" stroke="#049fd9" strokeOpacity="0.5" />
      <path d="M7.5 22.2a10.2 10.2 0 0 1 17 0" fill="none" stroke="#049fd9" strokeWidth="1.35" strokeLinecap="round" />
      <path d="M10.6 19.6a6.8 6.8 0 0 1 10.8 0" fill="none" stroke="#00bceb" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="16" cy="12.2" r="2.35" fill="#f4f7fb" />
      <path d="M16 14.6v7.4" stroke="#f4f7fb" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}
