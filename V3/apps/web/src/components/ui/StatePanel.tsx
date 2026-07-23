interface StatePanelProps {
  title: string;
  message: string;
  kind?: "loading" | "empty" | "error" | "unavailable" | "not-found";
  action?: { label: string; onClick: () => void };
}

export function StatePanel({ title, message, kind = "empty", action }: StatePanelProps) {
  const role = kind === "error" ? "alert" : kind === "loading" ? "status" : undefined;

  return (
    <section className={`state-panel state-panel--${kind}`} role={role} aria-live="polite">
      {kind === "loading" ? <span className="spinner" aria-hidden="true" /> : null}
      <p className="eyebrow">{kind.replace("-", " ")}</p>
      <h1>{title}</h1>
      <p>{message}</p>
      {action ? <button className="button" type="button" onClick={action.onClick}>{action.label}</button> : null}
    </section>
  );
}
