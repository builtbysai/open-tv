import { memo, useState, type CSSProperties } from "react";
import { Plus, Check, Radio, Film, Volume2, Star } from "lucide-react";
import { isAudio, type Content } from "../domain/content";
import { qualityBadge } from "../domain/quality";
import { isUnowned } from "../domain/discover";
import { titleHue } from "../playback/spectrum";
// Two letters that stand in for a title with no artwork: the caption already has its name.
const monogram = (title: string) =>
  title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
interface Props {
  item: Content;
  favorite: boolean;
  progress?: number;
  onSelect(item: Content): void;
  onFavorite(item: Content): void;
  wide?: boolean;
}
function ContentCardView({
  item,
  favorite,
  progress = 0,
  onSelect,
  onFavorite,
  wide,
}: Props) {
  const [failedArtwork, setFailedArtwork] = useState(""),
    [loadedArtwork, setLoadedArtwork] = useState(""),
    [portraitArtwork, setPortraitArtwork] = useState("");
  const live = item.type === "live" || isAudio(item);
  const unowned = isUnowned(item);
  const art = item.poster || item.artwork;
  return (
    <article
      className={`content-card ${live ? "channel-card" : "film-card"} ${wide ? "wide-card" : ""} ${item.poster && !isAudio(item) ? "poster-card" : ""} ${isAudio(item) ? "audio-card" : ""} ${unowned ? "unowned" : ""}`}
    >
      <button
        className="card-select"
        onClick={() => onSelect(item)}
        aria-label={`Details for ${item.title}`}
      >
        <div
          className={`card-art ${!item.poster && portraitArtwork === art ? "art-portrait" : ""}`}
          style={
            portraitArtwork === art
              ? ({ "--art": `url("${art}")` } as CSSProperties)
              : undefined
          }
        >
          {art && art !== failedArtwork && (
            <img
              src={art}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              style={{ opacity: loadedArtwork === art ? 1 : 0 }}
              onLoad={(event) => {
                setLoadedArtwork(art || "");
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalHeight > naturalWidth * 1.1)
                  setPortraitArtwork(art || "");
              }}
              onError={() => setFailedArtwork(art || "")}
            />
          )}
          {(!art || failedArtwork === art || loadedArtwork !== art) && (
            <div
              className="art-fallback"
              aria-hidden="true"
              style={{ "--hue": titleHue(item.title) } as CSSProperties}
            >
              {live ? isAudio(item) ? <Volume2 /> : <Radio /> : <Film />}
              <span className="art-monogram">{monogram(item.title)}</span>
            </div>
          )}
          {item.classification === "adult" && (
            <span className="adult-pill">18+</span>
          )}
          {qualityBadge(item) && (
            <span className="quality-pill">{qualityBadge(item)}</span>
          )}
          {item.rating && (
            <span className="rating-pill">
              <Star size={11} fill="currentColor" />
              {item.rating.toFixed(1)}
            </span>
          )}
          {progress > 0 && (
            <div className="watch-progress">
              <span
                style={{
                  width: `${Math.min(95, item.duration ? (progress / item.duration) * 100 : 15)}%`,
                }}
              />
            </div>
          )}
        </div>
        <div className="card-copy">
          <h3>{item.title}</h3>
          <p>
            {live
              ? item.genres[0]
              : [
                  item.type === "series" ? "Series" : undefined,
                  item.year,
                  item.duration
                    ? `${Math.round(item.duration / 60)} min`
                    : item.genres[0],
                ]
                  .filter(Boolean)
                  .join(" · ")}
            {unowned ? (
              <span className="sr-only"> · Not in your library</span>
            ) : null}
            {unowned
              ? ""
              : item.availability === "external"
                ? " · External"
                : item.availability === "unavailable"
                  ? " · Unavailable"
                  : ""}
          </p>
        </div>
      </button>
      {!unowned && (
        <button
          className={`card-save icon-button ${favorite ? "saved" : ""}`}
          onClick={() => onFavorite(item)}
          aria-label={`${favorite ? "Remove" : "Save"} ${item.title}`}
          aria-pressed={favorite}
        >
          {favorite ? <Check size={17} /> : <Plus size={17} />}
        </button>
      )}
    </article>
  );
}

// Cards only re-render when their own item, saved state or progress change.
export const ContentCard = memo(ContentCardView);
