type HealthDonutProps = {
  score: number | null | undefined;
  label: string;
  caption?: string;
  max?: number;
};

export function HealthDonut({ score, label, caption, max = 10 }: HealthDonutProps) {
  const value = score == null || !Number.isFinite(score) ? null : Math.max(0, Math.min(max, score));
  const ratio = value == null ? 0 : value / max;
  const r = 34;
  const c = 2 * Math.PI * r;
  const tone = value == null ? "neutral" : value >= 8 ? "ok" : value >= 4 ? "warn" : "bad";

  return (
    <article className={`health-donut health-donut-${tone}`}>
      <svg viewBox="0 0 88 88" aria-hidden="true">
        <circle className="health-donut-track" cx="44" cy="44" r={r} />
        <circle
          className="health-donut-arc"
          cx="44"
          cy="44"
          r={r}
          strokeDasharray={`${c * ratio} ${c}`}
          transform="rotate(-90 44 44)"
        />
        <text x="44" y="48" textAnchor="middle">
          {value == null ? "—" : value % 1 === 0 ? value : value.toFixed(1)}
        </text>
      </svg>
      <div>
        <strong>{label}</strong>
        {caption ? <p>{caption}</p> : null}
      </div>
    </article>
  );
}
