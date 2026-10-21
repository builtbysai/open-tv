import type { ReactNode } from "react";
import type { Content } from "../domain/content";
// One filter per kind of title in the catalog; a chip shows only when results of its kind exist.
const labels = {
  all: "All",
  movie: "Movies",
  series: "Series & episodes",
  documentary: "Documentaries",
  anime: "Anime",
  live: "Live TV",
  radio: "Radio",
  audio: "Audio",
} as const;
export type SearchKind = keyof typeof labels;
export const searchKinds = Object.keys(labels) as SearchKind[];
export const kindOfItem = (item: Content): Exclude<SearchKind, "all"> =>
  item.type === "episode" ? "series" : item.type;
export function SearchKinds({
  counts,
  value,
  onChange,
}: {
  counts: Record<SearchKind, number>;
  value: SearchKind;
  onChange(kind: SearchKind): void;
}) {
  return (
    <div className="chip-row" role="group" aria-label="Result type">
      {searchKinds
        .filter((kind) => kind === "all" || counts[kind] > 0)
        .map((kind) => (
          <button
            key={kind}
            className="chip"
            aria-pressed={value === kind}
            onClick={() => onChange(kind)}
          >
            {labels[kind]} <span className="chip-count">{counts[kind]}</span>
          </button>
        ))}
    </div>
  );
}
export function SearchIdle({
  genres,
  onPick,
  children,
}: {
  genres: string[];
  onPick(query: string): void;
  children?: ReactNode;
}) {
  return (
    <div className="search-idle">
      <h2>Browse by genre</h2>
      <div className="chip-row wrap" role="group" aria-label="Genres">
        {genres.map((genre) => (
          <button key={genre} className="chip" onClick={() => onPick(genre)}>
            {genre}
          </button>
        ))}
      </div>
      <p className="muted">
        Try a title, a year (“dune 2021”) or a type (“comedy movies”).
      </p>
      {children}
    </div>
  );
}
