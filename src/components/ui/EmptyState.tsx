type EmptyStateProps = {
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
  tone?: "idle" | "warn" | "bad";
};

export function EmptyState({ title, detail, action, tone = "idle" }: EmptyStateProps) {
  return (
    <div className={`empty-state empty-state-${tone}`} role="status">
      <strong>{title}</strong>
      <p>{detail}</p>
      {action ? (
        <button type="button" className="ui-btn" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
