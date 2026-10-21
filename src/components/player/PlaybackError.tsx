import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";

// Every playback failure offers the same actions, in the same order: Retry, Try next
// source (when the title has another), Try another channel (live), then anything specific
// to the failure, then Back. The panel wraps and scrolls, so its text is never cut off.
export function PlaybackError({
  title,
  message,
  detail,
  onRetry,
  onNextSource,
  onNextChannel,
  onBack,
  children,
}: {
  title: string;
  message?: string;
  detail?: ReactNode;
  onRetry?(): void;
  onNextSource?(): void;
  onNextChannel?(): void;
  onBack(): void;
  children?: ReactNode;
}) {
  return (
    <div className="player-error" role="alert">
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {detail}
      <div className="actions">
        {onRetry && (
          <button className="button primary" onClick={onRetry}>
            <RotateCcw size={17} />
            Retry
          </button>
        )}
        {onNextSource && (
          <button className="button secondary" onClick={onNextSource}>
            Try next source
          </button>
        )}
        {onNextChannel && (
          <button className="button secondary" onClick={onNextChannel}>
            Try another channel
          </button>
        )}
        {children}
        <button className="button secondary" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
