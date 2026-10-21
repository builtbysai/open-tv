import { isTVMode } from "../tv/mode";
import { licenseLabel } from "../domain/rights";
import { useEffect, useRef, useState, useId } from "react";
import {
  X,
  Play,
  Plus,
  Check,
  ExternalLink,
  ChevronDown,
  Search,
  Bookmark,
  BookmarkCheck,
  ListPlus,
  Tv,
} from "lucide-react";
import type { NamedCollection } from "../persistence/user-state";
import { contentAliases } from "../persistence/user-state";
import type { Content } from "../domain/content";
import { episodeLabel } from "../domain/episodes";
import { ServerSources } from "./ServerSources";
import { isAudio } from "../domain/content";
import { qualityBadge } from "../domain/quality";
import { isUnowned } from "../domain/discover";
import type { WatchProviders } from "../providers/tmdb";
import { EpisodeBrowser } from "./EpisodeBrowser";
import { StreamCheck } from "./StreamCheck";
import { clipText } from "../domain/text";
// A long description opens short, cut at a word boundary, with a toggle for the rest.
const SHORT_DESCRIPTION = 360;
function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > SHORT_DESCRIPTION;
  return (
    <p className="description">
      {long && !open ? clipText(text, SHORT_DESCRIPTION) : text}
      {long && (
        <>
          {" "}
          <button
            type="button"
            className="text-toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Less" : "More"}
          </button>
        </>
      )}
    </p>
  );
}
export function Detail({
  item,
  sourceName,
  favorite,
  onClose,
  onPlay,
  onFavorite,
  related,
  parent,
  onLoadEpisodes,
  progress,
  onSelect,
  collections,
  onCollection,
  onReport,
  resolveUrl,
  resume,
  similar = [],
  renderCard,
  onSearchSources,
  watch,
  wished = false,
  onWishlist,
  onQueue,
  onPlayOnTv,
  tvName,
  tvs = [],
}: {
  sourceName?: string;
  parent?: Content;
  onLoadEpisodes?(series: Content, signal: AbortSignal): Promise<Content[]>;
  progress(item: Content): number;
  collections?: NamedCollection[];
  onCollection?(collectionId: string, item: Content): void;
  onReport?(): void;
  resolveUrl?: import("../playback/probe").ProbeOptions["resolveUrl"];
  resume?: Content;
  similar?: Content[];
  renderCard?(item: Content): React.ReactNode;
  onSearchSources?(title: string): void;
  watch?: WatchProviders | null;
  wished?: boolean;
  onWishlist?(): void;
  onQueue?(): void;
  // A paired TV is reachable: offer to play there instead.
  onPlayOnTv?(item: Content, tvId?: string): void;
  tvName?: string;
  // Every paired TV, when there is more than one to choose from.
  tvs?: { id: string; name: string }[];
  item: Content;
  favorite: boolean;
  onClose(): void;
  onPlay(item: Content): void;
  onFavorite(item: Content): void;
  related: Content[];
  onSelect(item: Content): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const unowned = isUnowned(item);
  const embedCount = item.streams.filter((s) => s.format === "embed").length;
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourcePanel = useId();
  // The hero image falls back to the next artwork when one fails to load, and is left
  // out rather than shown as a black box when none does.
  const [artTry, setArtTry] = useState(0);
  const art = [
    ...new Set([item.backdrop, item.artwork, item.poster].filter(Boolean)),
  ][artTry];
  useEffect(() => {
    const element = document.activeElement as HTMLElement;
    ref.current?.showModal();
    // On a TV the remote starts on the main action (Watch now), not on Close.
    if (isTVMode())
      ref.current
        ?.querySelector<HTMLElement>(".button.primary:not([disabled])")
        ?.focus();
    return () => {
      element?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="detail-dialog"
      aria-labelledby="detail-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="detail-shell">
        <button
          className="icon-button detail-close"
          onClick={onClose}
          aria-label="Close details"
        >
          <X />
        </button>
        {art && (
          <div
            className={`detail-art ${item.type === "live" ? "logo-art" : ""}`}
          >
            <img
              key={art}
              src={art}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setArtTry((n) => n + 1)}
            />
          </div>
        )}
        <div className="detail-content">
          <p className="eyebrow">
            {item.type === "live"
              ? "Live television"
              : item.type === "series"
                ? `Series · ${item.genres.join(" / ")}`
                : item.type === "episode"
                  ? `${item.season === 0 ? "Specials" : `Season ${item.season ?? 1}`} · Episode ${item.episode ?? 1}`
                  : item.genres.join(" / ")}
          </p>
          <h2 id="detail-title">
            {item.title}
            {item.classification === "adult" && (
              <span className="adult-pill inline">18+</span>
            )}
          </h2>
          <p className="detail-meta">
            {[
              item.year,
              qualityBadge(item),
              item.rating && `★ ${item.rating.toFixed(1)}`,
              item.streams.length > 1 && `${item.streams.length} sources`,
              item.duration && `${Math.round(item.duration / 60)} min`,
              ...item.countries,
              ...item.languages,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {item.description && (
            <Description key={item.id} text={item.description} />
          )}
          {unowned && watch && (
            <section className="watch-providers" aria-label="Where to watch">
              <h3>Where to watch</h3>
              {(
                [
                  ["Stream", watch.stream],
                  ["Rent", watch.rent],
                  ["Buy", watch.buy],
                ] as const
              ).map(
                ([label, names]) =>
                  names.length > 0 && (
                    <p key={label}>
                      <strong>{label}</strong> {names.join(" · ")}
                    </p>
                  ),
              )}
              <p className="fine-print">
                {watch.link && (
                  <a href={watch.link} target="_blank" rel="noreferrer">
                    All options
                  </a>
                )}{" "}
                Availability data from JustWatch.
              </p>
            </section>
          )}
          <div className="actions">
            {unowned ? (
              <>
                <span className="unowned-note">Not in your library</span>
                {onSearchSources && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      onSearchSources(
                        [item.title, item.year].filter(Boolean).join(" "),
                      )
                    }
                  >
                    <Search size={16} />
                    Search your sources
                  </button>
                )}
                {onWishlist && (
                  <button
                    className="button secondary"
                    aria-pressed={wished}
                    onClick={onWishlist}
                  >
                    {wished ? (
                      <BookmarkCheck size={16} />
                    ) : (
                      <Bookmark size={16} />
                    )}
                    {wished ? "On your wishlist" : "Add to wishlist"}
                  </button>
                )}
              </>
            ) : item.type === "series" ? (
              <>
                {resume && (
                  <button
                    className="button primary"
                    onClick={() => onPlay(resume)}
                  >
                    <Play size={18} fill="currentColor" />
                    {progress(resume) > 10 ? "Resume" : "Play"}{" "}
                    {episodeLabel(resume)}
                  </button>
                )}
                <button
                  className={`button ${resume ? "secondary" : "primary"}`}
                  aria-controls="series-episodes"
                  onClick={() => {
                    const section =
                      ref.current?.querySelector<HTMLElement>(".episodes");
                    (
                      section?.querySelector<HTMLElement>("select, button") ||
                      section
                    )?.focus();
                  }}
                >
                  Browse episodes
                </button>
              </>
            ) : item.availability === "playable" ? (
              <>
                {onPlayOnTv &&
                  (tvs.length > 1 ? (
                    tvs.map((choice, index) => (
                      <button
                        key={choice.id}
                        className={`button ${index ? "secondary" : "primary"} play-on-tv`}
                        onClick={() => onPlayOnTv(item, choice.id)}
                      >
                        <Tv size={18} />
                        Play on {choice.name}
                      </button>
                    ))
                  ) : (
                    <button
                      className="button primary play-on-tv"
                      onClick={() => onPlayOnTv(item)}
                    >
                      <Tv size={18} />
                      Play on {tvName || "TV"}
                    </button>
                  ))}
                <button
                  className={`button ${onPlayOnTv ? "secondary" : "primary"}`}
                  onClick={() => onPlay(item)}
                >
                  <Play size={18} fill="currentColor" />
                  {onPlayOnTv
                    ? "Play here"
                    : isAudio(item)
                      ? item.type === "radio"
                        ? "Listen live"
                        : "Listen"
                      : `Watch ${item.type === "live" ? "live" : "now"}`}
                </button>
              </>
            ) : item.externalUrl ? (
              <a
                className="button primary"
                href={item.externalUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={18} />
                Watch on provider
              </a>
            ) : (
              <span>Playback unavailable</span>
            )}
            {onQueue && (
              <button className="button secondary" onClick={onQueue}>
                <ListPlus size={18} />
                Add to queue
              </button>
            )}
            {!unowned && (
              <button
                className="button secondary"
                onClick={() => onFavorite(item)}
              >
                {favorite ? <Check size={18} /> : <Plus size={18} />}
                {favorite ? "Saved" : "Save"}
              </button>
            )}
          </div>
          {!!collections?.length && onCollection && (
            <label className="collection-picker">
              Organize in a collection
              <select
                aria-label="Organize in a collection"
                value=""
                onChange={(e) => {
                  if (e.target.value) onCollection(e.target.value, item);
                }}
              >
                <option value="">Choose a collection</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {contentAliases(item).some((id) => c.itemIds.includes(id))
                      ? " (added)"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!unowned && (item.type === "series" || related.length > 0) && (
            <EpisodeBrowser
              item={item}
              parent={parent}
              episodes={related}
              load={onLoadEpisodes}
              onSelect={onSelect}
              onPlay={onPlay}
              progress={progress}
            />
          )}

          {renderCard && similar.length > 0 && (
            <section className="detail-similar" aria-label="More like this">
              <h3>More like this</h3>
              <div className="content-rail poster-rail">
                {similar.map(renderCard)}
              </div>
            </section>
          )}
          {!unowned && embedCount > 1 && (
            <ServerSources item={item} onPlay={onPlay} />
          )}
          {!unowned && (
            <div className="detail-utilities">
              <button
                className="button text"
                aria-expanded={sourceOpen}
                aria-controls={sourcePanel}
                onClick={() => setSourceOpen((open) => !open)}
              >
                Source & playback
                <ChevronDown
                  size={16}
                  className={sourceOpen ? "expanded-chevron" : ""}
                />
              </button>
              {onReport && (
                <button className="button text" onClick={onReport}>
                  Report this listing
                </button>
              )}
            </div>
          )}
          {!unowned && sourceOpen && (
            <div id={sourcePanel} className="detail-source-panel">
              <div className="source-note">
                <span>Source: {sourceName || "Your connected library"}</span>
                <span>
                  {item.rights.status === "open-license"
                    ? licenseLabel(item.rights.license)
                    : item.rights.status === "unverified"
                      ? "Rights unverified"
                      : item.rights.status === "provider-listed"
                        ? "Provider directory"
                        : item.rights.status === "user-authorized"
                          ? "Your authorized source"
                          : item.rights.status === "public-domain"
                            ? "Public domain"
                            : item.rights.status}
                </span>
                {item.rights.attribution && (
                  <span>{item.rights.attribution}</span>
                )}
                {item.rights.url && (
                  <a href={item.rights.url} target="_blank" rel="noreferrer">
                    Source & rights information <ExternalLink size={12} />
                  </a>
                )}
              </div>
              {embedCount === 1 && (
                <ServerSources item={item} onPlay={onPlay} />
              )}
              {item.type !== "series" && item.streams.length > 0 && (
                <StreamCheck item={item} resolveUrl={resolveUrl} />
              )}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
