import { Check, Circle, X } from "lucide-react";
// One line on Home while setup is unfinished: it replaces the old Get started card.
export function SetupReminder({
  tmdb,
  sources,
  onContinue,
  onHide,
}: {
  tmdb: boolean;
  sources: boolean;
  onContinue(): void;
  onHide(): void;
}) {
  return (
    <section className="setup-reminder" aria-label="Finish setup">
      <p>
        <strong>Finish setup</strong>{" "}
        <span className="muted setup-steps">
          {[
            ["TMDB key for trending titles", tmdb],
            ["A source of channels or servers", sources],
          ].map(([label, done]) => (
            <span key={String(label)} className={done ? "done" : ""}>
              {done ? <Check size={14} /> : <Circle size={14} />} {label}
            </span>
          ))}
        </span>
      </p>
      <button className="button secondary small" onClick={onContinue}>
        Continue
      </button>
      <button
        className="icon-button"
        aria-label="Hide this reminder"
        onClick={onHide}
      >
        <X size={16} />
      </button>
    </section>
  );
}
