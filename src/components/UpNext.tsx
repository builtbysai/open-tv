import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import type { Content } from "../domain/content";
import { episodeLabel } from "../domain/episodes";
export function UpNext({
  item,
  seconds = 8,
  onPlay,
  onCancel,
}: {
  item: Content;
  seconds?: number;
  onPlay(): void;
  onCancel(): void;
}) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) {
      onPlay();
      return;
    }
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, onPlay]);
  return (
    <div className="up-next" role="status" aria-live="polite">
      <p className="eyebrow">Up next · {left}s</p>
      <h3>{item.title}</h3>
      <p className="muted">{episodeLabel(item)}</p>
      <div className="actions">
        <button autoFocus className="button primary" onClick={onPlay}>
          <Play size={16} fill="currentColor" />
          Play now
        </button>
        <button className="button secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <span
        className="up-next-bar"
        style={{ animationDuration: `${seconds}s` }}
      />
    </div>
  );
}
