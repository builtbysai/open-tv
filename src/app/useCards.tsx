import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Content } from "../domain/content";
import { ContentCard } from "../components/ContentCard";
import { ContentRail } from "../components/ContentRail";
import {
  hasFavorite,
  progressFor,
  type Route,
  type UserState,
} from "../persistence/user-state";

// Cards and rails for the home, movie and library screens. The handlers are stable so
// a long grid of cards does not redraw every time the app state changes.
export function useCards({
  user,
  setUser,
  select,
  toggleFavorite,
  navigate,
  updateView,
}: {
  user: UserState;
  setUser: Dispatch<SetStateAction<UserState>>;
  select(item: Content): Promise<void>;
  toggleFavorite(item: Content): void;
  navigate(route: Route): void;
  updateView(patch: {
    genre?: string;
    language?: string;
    country?: string;
    guide?: boolean;
  }): void;
}) {
  const [settling, setSettling] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setSettling(false), 8000);
    return () => clearTimeout(timer);
  }, []);
  const latest = useRef({ select, toggleFavorite });
  latest.current = { select, toggleFavorite };
  const onCardSelect = useCallback(
    (item: Content) => void latest.current.select(item),
    [],
  );
  const onCardFavorite = useCallback(
    (item: Content) => latest.current.toggleFavorite(item),
    [],
  );
  const card = (item: Content) => (
    <ContentCard
      key={item.id}
      item={item}
      favorite={hasFavorite(user, item)}
      progress={progressFor(user, item)}
      onSelect={onCardSelect}
      onFavorite={onCardFavorite}
    />
  );
  // Rails filled from your history show a labelled placeholder while the catalog is still
  // arriving, and nothing once it has settled without them.
  const awaited = {
    progress: user.history.some((h) => (user.progress[h.id] || 0) > 10),
    history: user.history.length > 0 || user.favorites.length > 0,
  };
  const rail = (
    title: string,
    items: Content[],
    target?: Route,
    libraryTab?: "saved" | "continue",
    awaits?: keyof typeof awaited,
  ) => (
    <ContentRail
      key={title}
      title={title}
      items={items}
      loading={Boolean(awaits && settling && awaited[awaits])}
      renderCard={card}
      onViewAll={
        target
          ? () => {
              if (
                target === "live" ||
                target === "audio" ||
                target === "movies"
              ) {
                navigate(target);
                updateView({
                  genre: "",
                  language: "",
                  country: "",
                  guide: false,
                });
              } else {
                if (libraryTab)
                  setUser((old) => ({
                    ...old,
                    session: {
                      ...old.session,
                      library: { tab: libraryTab, limit: 72 },
                      scroll: { ...old.session.scroll, library: 0 },
                    },
                  }));
                navigate(target);
              }
            }
          : undefined
      }
    />
  );
  return { card, rail };
}
