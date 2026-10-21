import { Shuffle } from "lucide-react";
import type { Content } from "../domain/content";
import type { Route } from "../persistence/user-state";

const titles: Partial<Record<Route, string>> = {
  live: "Live TV",
  audio: "Audio",
  music: "Music",
  movies: "Movies & Shows",
  library: "My Library",
  search: "Search",
};
const shuffles: Route[] = ["live", "audio", "movies", "library"];

// A screen's title, and Shuffle: a random pick from what the screen lists now.
export function PageHeading({
  route,
  pool,
  onPlay,
  onNotice,
}: {
  route: Route;
  pool: Content[];
  onPlay(item: Content): void;
  onNotice(message: string): void;
}) {
  const playable = pool.filter(
    (c) => c.availability === "playable" && c.streams.length > 0,
  );
  return (
    <div className="page-heading">
      <div>
        <h1>{titles[route] ?? "Settings & Sources"}</h1>
      </div>
      {shuffles.includes(route) && playable.length > 0 && (
        <button
          className="button secondary"
          onClick={() =>
            playable.length
              ? onPlay(playable[Math.floor(Math.random() * playable.length)])
              : onNotice("Connect a source or save a favorite first.")
          }
        >
          <Shuffle size={17} />
          Shuffle
        </button>
      )}
    </div>
  );
}
