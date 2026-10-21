import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Play, Info, Shuffle, Search } from "lucide-react";
import type { Content } from "../domain/content";
import { SITE_NAME } from "../config/site";
import { isUnowned } from "../domain/discover";
import { SetupReminder } from "../components/SetupReminder";
import { useRestricted } from "../components/ProfileGate";
import type { Route } from "../persistence/user-state";
import type { Shelf } from "../app/shelves";
interface Props {
  featured: Content[];
  movies: Content[];
  live: Content[];
  audio: Content[];
  listenAgain: Content[];
  favorites: Content[];
  wishlist: Content[];
  airing: Content[];
  continueWatching: Content[];
  recommended: Content[];
  newOnServers: Content[];
  shelves: Shelf[];
  showArchive: boolean;
  surprisePool: Content[];
  onNotice?(message: string): void;
  onSearchSources(title: string): void;
  // How many of the two setup steps are done, or null once nothing is left to remind about.
  setupDone: number | null;
  setupSteps: { tmdb: boolean; sources: boolean };
  onContinueSetup(): void;
  onHideSetupReminder(): void;
  hasSourceError: boolean;
  rail(
    title: string,
    items: Content[],
    target?: Route,
    libraryTab?: "saved" | "continue" | "wishlist",
    // Fills from your history: a labelled placeholder shows while the catalog arrives.
    awaits?: "progress" | "history",
  ): ReactNode;
  navigate(route: Route): void;
  play(item: Content): void;
  select(item: Content): Promise<void>;
}
export function Home({
  featured: slides,
  movies,
  live,
  audio,
  listenAgain,
  favorites,
  wishlist,
  airing,
  continueWatching,
  recommended,
  newOnServers,
  shelves,
  showArchive,
  surprisePool,
  onNotice,
  onSearchSources,
  setupDone,
  setupSteps,
  onContinueSetup,
  onHideSetupReminder,
  hasSourceError,
  rail,
  navigate,
  play,
  select,
}: Props) {
  const restricted = useRestricted();
  const [slide, setSlide] = useState(0),
    [paused, setPaused] = useState(false);
  const featured = slides[slide % Math.max(slides.length, 1)];
  useEffect(() => {
    if (
      slides.length < 2 ||
      paused ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const timer = setTimeout(
      () => setSlide((value) => (value + 1) % slides.length),
      9000,
    );
    return () => clearTimeout(timer);
  }, [slides.length, slide, paused]);
  const films = useMemo(
    () => movies.filter((item) => item.providerId === "open-cinema"),
    [movies],
  );
  const news = useMemo(
    () =>
      live
        .filter((item) =>
          item.genres.some((genre) =>
            /news|documentary|education|culture/i.test(genre),
          ),
        )
        .slice(0, 16),
    [live],
  );
  const surprise = () => {
    const pool = [...surprisePool, ...live].filter(
      (item) => item.availability === "playable" && item.streams.length > 0,
    );
    if (pool.length) play(pool[Math.floor(Math.random() * pool.length)]);
    else onNotice?.("Nothing playable yet. Connect a source first.");
  };
  return (
    <>
      <section
        className={`hero ${featured ? "" : "hero-loading"}`}
        aria-label="Featured film"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        {featured?.backdrop && (
          <img
            key={featured.id}
            className="hero-image"
            src={featured.backdrop}
            alt=""
            fetchPriority="high"
          />
        )}
        <div className="hero-shade" />
        <div className="hero-content" key={featured?.id || "empty"}>
          <p className="hero-category">
            {featured?.rating
              ? [
                  `Trending · ★ ${featured.rating.toFixed(1)}`,
                  isUnowned(featured)
                    ? "Not in your library"
                    : "In your library",
                ].join(" · ")
              : "Featured film"}
          </p>
          <h1>{featured?.title || SITE_NAME}</h1>
          {featured && (
            <p className="hero-meta">
              {[
                featured.year,
                featured.duration
                  ? `${Math.round(featured.duration / 60)} min`
                  : undefined,
                ...featured.genres.slice(0, 2),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <p className="hero-description">
            {featured?.description ||
              (restricted
                ? "Browse live channels and films picked for you."
                : "Browse live channels or connect a source.")}
          </p>
          <div className="actions">
            {featured?.availability === "playable" &&
            featured.streams.length > 0 ? (
              <button className="button primary" onClick={() => play(featured)}>
                <Play size={18} fill="currentColor" />
                Play
              </button>
            ) : featured && isUnowned(featured) ? (
              <button
                className="button primary"
                onClick={() =>
                  onSearchSources(
                    [featured.title, featured.year].filter(Boolean).join(" "),
                  )
                }
              >
                <Search size={18} />
                Search your sources
              </button>
            ) : (
              !featured && (
                <button
                  className="button primary"
                  onClick={() => navigate("live")}
                >
                  <Play size={18} />
                  Live TV
                </button>
              )
            )}
            {(featured || !restricted) && (
              <button
                className="button hero-secondary"
                onClick={() =>
                  featured ? void select(featured) : navigate("settings")
                }
              >
                <Info size={18} />
                {featured ? "Details" : "Add a source"}
              </button>
            )}
            <button className="button hero-secondary" onClick={surprise}>
              <Shuffle size={18} />
              Surprise me
            </button>
          </div>
          {slides.length > 1 && (
            <div
              className="hero-dots"
              role="group"
              aria-label="Featured titles"
            >
              {slides.map((item, index) => (
                <button
                  key={item.id}
                  aria-label={`Show ${item.title}`}
                  aria-current={index === slide % slides.length}
                  onClick={() => setSlide(index)}
                />
              ))}
            </div>
          )}
        </div>
      </section>
      <div className="home-body">
        {setupDone !== null && (
          <SetupReminder
            tmdb={setupSteps.tmdb}
            sources={setupSteps.sources}
            onContinue={onContinueSetup}
            onHide={onHideSetupReminder}
          />
        )}
        {rail(
          "Continue watching",
          continueWatching,
          "library",
          "continue",
          "progress",
        )}
        {rail("New on your servers", newOnServers, "movies")}
        {shelves
          .filter((shelf) => shelf.lead)
          .map((shelf) => rail(shelf.title, shelf.items))}
        {rail("For you", recommended, undefined, undefined, "history")}
        {showArchive && rail("Films", films, "movies")}
        {shelves
          .filter((shelf) => !shelf.lead)
          .map((shelf) => rail(shelf.title, shelf.items))}
        {rail("Live TV", live, "live")}
        {rail("Listen again", listenAgain, "audio")}
        {rail("Audio", audio, "audio")}
        {rail("Saved", favorites, "library", "saved")}
        {rail("Wishlist", wishlist, "library", "wishlist")}
        {rail("Airing now", airing)}
        {rail("News & documentaries", news, "live")}
        {live.length === 0 && hasSourceError && (
          <div className="empty-state">
            <h2>Channels couldn’t load</h2>
            {restricted ? (
              <p>
                Check your connection, or ask a grown-up to check the sources.
              </p>
            ) : (
              <>
                <p>Check your connection or refresh your sources.</p>
                <button
                  className="button secondary"
                  onClick={() => navigate("settings")}
                >
                  Manage sources
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
