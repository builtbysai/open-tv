import { useMemo, useState, type ReactNode } from "react";
import {
  Grid2X2,
  List,
  Search,
  ArrowRight,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import type { Content } from "../domain/content";
import type { Route } from "../persistence/user-state";
import type { GuideProgram } from "../providers/contracts";
import { TVGuide } from "../components/TVGuide";
import { useRestricted } from "../components/ProfileGate";
import { ASK_MAIN_PROFILE } from "../domain/kids";
import type { GuideSnapshot } from "../guide/service";
export interface BrowseFilters {
  genre: string;
  language: string;
  country: string;
}
interface Props extends BrowseFilters {
  route: Route;
  query: string;
  filtered: Content[];
  visible: Content[];
  genres: string[];
  limit: number;
  guide: GuideProgram[];
  guideStatus: GuideSnapshot;
  // True while a source is still loading, so the count may still grow.
  syncing: boolean;
  guideView: boolean;
  onGuideView(value: boolean): void;
  renderCard(item: Content): ReactNode;
  onFilter(patch: Partial<BrowseFilters>): void;
  onMore(): void;
  play(item: Content): void;
  navigate(route: Route): void;
}
export function Browse({
  route,
  query,
  filtered,
  visible,
  genres,
  genre,
  language,
  country,
  limit,
  guide,
  guideStatus,
  syncing,
  guideView,
  onGuideView,
  renderCard,
  onFilter,
  onMore,
  play,
  navigate,
}: Props) {
  const restricted = useRestricted();
  const languages = useMemo(
    () => [...new Set(visible.flatMap((c) => c.languages))].sort(),
    [visible],
  );
  const countries = useMemo(
    () => [...new Set(visible.flatMap((c) => c.countries))].sort(),
    [visible],
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = [genre, language, country].filter(Boolean).length;
  const quickGenres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of visible)
      for (const value of item.genres)
        counts.set(value, (counts.get(value) || 0) + 1);
    return [...genres]
      .sort((x, y) => (counts.get(y) || 0) - (counts.get(x) || 0))
      .slice(0, 10);
  }, [visible, genres]);
  return (
    <>
      {route !== "search" && quickGenres.length > 1 && (
        <div className="chip-row" role="group" aria-label="Quick categories">
          <button
            className="chip"
            aria-pressed={!genre}
            onClick={() => onFilter({ genre: "" })}
          >
            All
          </button>
          {quickGenres.map((value) => (
            <button
              key={value}
              className="chip"
              aria-pressed={genre === value}
              onClick={() => onFilter({ genre: genre === value ? "" : value })}
            >
              {value}
            </button>
          ))}
        </div>
      )}
      <div className="browse-toolbar">
        <div className="browse-filters">
          <button
            className="button secondary small filters-toggle"
            aria-expanded={filtersOpen}
            aria-controls="filter-fields"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={15} />
            Filters{activeFilters ? ` · ${activeFilters}` : ""}
          </button>
          <div
            id="filter-fields"
            className="filter-fields"
            data-open={filtersOpen}
          >
            <label>
              Category
              <select
                aria-label="Filter category"
                value={genre}
                onChange={(event) => onFilter({ genre: event.target.value })}
              >
                <option value="">All categories</option>
                {genres.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Language
              <select
                aria-label="Filter language"
                value={language}
                onChange={(e) => onFilter({ language: e.target.value })}
              >
                <option value="">All languages</option>
                {languages.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Country
              <select
                aria-label="Filter country"
                value={country}
                onChange={(e) => onFilter({ country: e.target.value })}
              >
                <option value="">All countries</option>
                {countries.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          {route === "live" && (
            <div className="view-switch" role="group" aria-label="Channel view">
              <button
                className="icon-button"
                aria-label="Channel grid"
                aria-pressed={!guideView}
                onClick={() => onGuideView(false)}
              >
                <Grid2X2 size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="TV guide"
                aria-pressed={guideView}
                onClick={() => onGuideView(true)}
              >
                <List size={18} />
              </button>
            </div>
          )}
          <span className="results-count">
            {filtered.length.toLocaleString()}{" "}
            {route === "live"
              ? filtered.length === 1
                ? "channel"
                : "channels"
              : filtered.length === 1
                ? "result"
                : "results"}
            {syncing ? " · still loading" : ""}
          </span>
          {(genre || language || country) && (
            <button
              className="button text"
              onClick={() => onFilter({ genre: "", language: "", country: "" })}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>
      {guideView && route === "live" ? (
        <TVGuide
          channels={filtered.slice(0, limit)}
          programs={guide}
          status={guideStatus}
          play={play}
          onImport={restricted ? undefined : () => navigate("settings")}
        />
      ) : (
        <div className="content-grid">
          {filtered.slice(0, limit).map(renderCard)}
        </div>
      )}
      {!filtered.length && syncing && !activeFilters && route !== "search" && (
        <div className="content-grid" role="status" aria-label="Loading">
          {Array.from({ length: 10 }, (_, i) => (
            <div
              className="content-card skeleton-card"
              key={i}
              aria-hidden="true"
            >
              <div className="card-art skeleton-line" />
              <span className="skeleton-line" style={{ width: "70%" }} />
            </div>
          ))}
        </div>
      )}
      {!filtered.length &&
        !(syncing && !activeFilters && route !== "search") && (
          <div className="empty-state">
            <Search size={32} />
            <h2>
              {route === "search" && query
                ? "No results"
                : activeFilters
                  ? "Nothing matches these filters"
                  : "Nothing here yet"}
            </h2>
            <p>
              {route === "search"
                ? "Try another title or adjust your filters."
                : activeFilters
                  ? "Clear a filter to see more."
                  : restricted
                    ? ASK_MAIN_PROFILE
                    : route === "audio"
                      ? "Connect SomaFM or internet radio in Settings to fill this screen."
                      : route === "live"
                        ? "Connect a channel source in Settings to fill this screen."
                        : "Connect a source or a server in Settings to fill this screen."}
            </p>
            {activeFilters ? (
              <button
                className="button secondary"
                onClick={() =>
                  onFilter({ genre: "", language: "", country: "" })
                }
              >
                Clear filters
              </button>
            ) : restricted ? (
              route !== "search" && (
                <button
                  className="button secondary"
                  onClick={() => navigate("home")}
                >
                  Back to Home
                  <ArrowRight size={16} />
                </button>
              )
            ) : (
              <button
                className="button secondary"
                onClick={() => navigate("settings")}
              >
                Manage sources
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        )}
      {filtered.length > limit && (
        <div className="load-more">
          <button className="button secondary" onClick={onMore}>
            Show more <Plus size={16} />
          </button>
          <span>
            Showing {limit} of {filtered.length.toLocaleString()}
          </span>
        </div>
      )}
    </>
  );
}
