import { Pause, Play, SkipBack, SkipForward, Maximize2, X } from "lucide-react";
import type { Content } from "../domain/content";
import { titleHue } from "../playback/spectrum";
// Audio keeps playing while you browse: this bar docks to the bottom of the screen with
// the essentials, and expands back to the full player.
export function MiniPlayer({
  item,
  paused,
  loading,
  timeline,
  onToggle,
  onNext,
  onExpand,
  onClose,
}: {
  item: Content;
  paused: boolean;
  loading: boolean;
  timeline: { time: number; duration: number };
  onToggle(): void;
  onNext(direction: number): void;
  onExpand(): void;
  onClose(): void;
}) {
  const art = item.poster || item.artwork;
  const progress =
    timeline.duration > 0
      ? Math.min(100, (timeline.time / timeline.duration) * 100)
      : 0;
  return (
    <section
      className="mini-player"
      aria-label="Now playing"
      style={{ "--hue": titleHue(item.title) } as React.CSSProperties}
    >
      {timeline.duration > 0 && (
        <div className="mini-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
      <button
        className="mini-info"
        onClick={onExpand}
        aria-label={`Open player for ${item.title}`}
      >
        {art ? (
          <img src={art} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="mini-art-fallback" aria-hidden="true" />
        )}
        <span className="mini-text">
          <strong>{item.title}</strong>
          <small>
            {loading
              ? "Loading…"
              : item.type === "radio"
                ? "Live radio"
                : item.genres[0] || "Audio"}
          </small>
        </span>
        <span
          className={`mini-eq ${paused ? "" : "playing"}`}
          aria-hidden="true"
        >
          <i />
          <i />
          <i />
        </span>
      </button>
      <div className="mini-controls">
        <button
          className="icon-button"
          aria-label="Previous"
          onClick={() => onNext(-1)}
        >
          <SkipBack size={20} />
        </button>
        <button
          className="button primary mini-play"
          aria-label={paused ? "Play audio" : "Pause audio"}
          onClick={onToggle}
        >
          {paused ? (
            <Play size={20} fill="currentColor" />
          ) : (
            <Pause size={20} />
          )}
        </button>
        <button
          className="icon-button"
          aria-label="Next"
          onClick={() => onNext(1)}
        >
          <SkipForward size={20} />
        </button>
        <button
          className="icon-button"
          aria-label="Expand player"
          onClick={onExpand}
        >
          <Maximize2 size={18} />
        </button>
        <button
          className="icon-button"
          aria-label="Stop and close player"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
    </section>
  );
}
