import { useEffect, useState } from "react";
import { Play, RotateCcw, ArrowLeft } from "lucide-react";
import type { Content } from "../domain/content";
import { friendlyError } from "../domain/errors";
interface Props {
  item: Content;
  parent?: Content;
  episodes: Content[];
  load?(series: Content, signal: AbortSignal): Promise<Content[]>;
  onSelect(item: Content): void;
  onPlay(item: Content): void;
  progress(item: Content): number;
}
export function EpisodeBrowser({
  item,
  parent,
  episodes,
  load,
  onSelect,
  onPlay,
  progress,
}: Props) {
  const [status, setStatus] = useState(load ? "loading" : "ready"),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [season, setSeason] = useState(item.season ?? 1),
    [limit, setLimit] = useState(50);
  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    setStatus("loading");
    void load(item, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setStatus("error");
          setError(friendlyError(error));
        }
      });
    return () => controller.abort();
  }, [item, load, attempt]);
  const seasons = [
    ...new Set(episodes.map((episode) => episode.season ?? 1)),
  ].sort((a, b) => a - b);
  const currentSeason = seasons.includes(season)
    ? season
    : (seasons.find((n) => n > 0) ?? seasons[0]);
  const visible = episodes.filter(
    (episode) => (episode.season ?? 1) === currentSeason,
  );
  return (
    <section
      id="series-episodes"
      className="episodes"
      tabIndex={-1}
      aria-label="Series episodes"
      aria-busy={status === "loading"}
    >
      {parent && (
        <button
          className="button text series-back"
          onClick={() => onSelect(parent)}
        >
          <ArrowLeft size={15} /> {parent.title}
        </button>
      )}
      <div className="episode-heading">
        <div>
          <h3>Episodes</h3>
          {episodes.length > 0 && (
            <p className="muted">
              {episodes.length} {episodes.length === 1 ? "episode" : "episodes"}{" "}
              · {seasons.length} {seasons.length === 1 ? "season" : "seasons"}
            </p>
          )}
        </div>
        {!!seasons.length && (
          <label>
            <span className="sr-only">Choose season</span>
            <select
              aria-label="Choose season"
              value={currentSeason}
              onChange={(e) => {
                setSeason(Number(e.target.value));
                setLimit(50);
              }}
            >
              {seasons.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "Specials" : `Season ${n}`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {status === "loading" && (
        <p className="episode-status" role="status">
          <span className="spinner" /> Loading episodes from your provider…
        </p>
      )}
      {status === "error" && (
        <div className="episode-status" role="alert">
          <p>{error}</p>
          <button
            className="button secondary small"
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RotateCcw size={15} /> Retry episodes
          </button>
        </div>
      )}
      {status === "ready" && !episodes.length && (
        <p className="episode-status">No playable episodes found.</p>
      )}
      {visible.slice(0, limit).map((episode) => (
        <article
          className={`episode-row ${episode.id === item.id ? "current" : ""}`}
          key={episode.id}
        >
          <span
            className="episode-number"
            aria-label={`Episode ${episode.episode}`}
          >
            {String(episode.episode ?? 1).padStart(2, "0")}
          </span>
          <button
            className="episode-select"
            onClick={() => onSelect(episode)}
            aria-label={`Details for S${episode.season ?? 1} E${episode.episode ?? 1}: ${episode.title}`}
            aria-current={episode.id === item.id ? "true" : undefined}
          >
            <span className="episode-title">{episode.title}</span>
            {episode.description && (
              <span className="episode-description">{episode.description}</span>
            )}
            <span className="episode-meta">
              {[
                episode.duration
                  ? `${Math.round(episode.duration / 60)} min`
                  : undefined,
                progress(episode) > 0
                  ? `${Math.floor(progress(episode) / 60)} min watched`
                  : undefined,
                episode.availability !== "playable"
                  ? "Playback unavailable"
                  : undefined,
                episode.id === item.id ? "Selected episode" : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </button>
          {episode.availability === "playable" && !!episode.streams.length && (
            <button
              className="icon-button episode-play"
              onClick={() => onPlay(episode)}
              aria-label={`Play S${episode.season ?? 1} E${episode.episode ?? 1}: ${episode.title}`}
            >
              <Play size={18} />
            </button>
          )}
        </article>
      ))}
      {visible.length > limit && (
        <button className="button text" onClick={() => setLimit((n) => n + 50)}>
          Show more episodes ({visible.length - limit})
        </button>
      )}
    </section>
  );
}
