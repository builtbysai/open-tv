import { useMemo } from "react";
import { isAudio, type Content } from "../domain/content";
import { isArchive } from "../domain/discover";
import { recommend } from "../domain/recommendations";
import {
  contentAliases,
  progressFor,
  type UserState,
} from "../persistence/user-state";

// The lists that belong to the viewer: favourites, what they played, and the picks
// derived from both. Every entry is limited to what the catalog currently allows.
export function useViewerLists(
  visible: Content[],
  user: UserState,
  adult: boolean,
  rules: Parameters<typeof recommend>[1]["policy"],
  curated: boolean,
) {
  const visibleByAlias = useMemo(() => {
    const map = new Map<string, Content>();
    for (const item of visible)
      for (const id of contentAliases(item)) map.set(id, item);
    return map;
  }, [visible]);
  const favorites = useMemo(
    () => [
      ...new Map(
        user.favorites.flatMap((id) => {
          const item = visibleByAlias.get(id);
          return item ? [[item.id, item] as const] : [];
        }),
      ).values(),
    ],
    [visibleByAlias, user.favorites],
  );
  const recent = useMemo(
    () => [
      ...new Map(
        user.history.flatMap((h) => {
          const item = visibleByAlias.get(h.id);
          return item ? [[item.id, item] as const] : [];
        }),
      ).values(),
    ],
    [visibleByAlias, user.history],
  );
  const continueWatching = recent.filter(
    (c) => progressFor(user, c) > 10 && c.type !== "live" && !isAudio(c),
  );
  // Stations and audio you played recently, newest first.
  const listenAgain = recent.filter(isAudio).slice(0, 16);
  const recommended = useMemo(
    () =>
      recommend(visible, {
        favorites: user.favorites,
        history: user.history,
        policy: rules,
      }),
    [visible, user.favorites, user.history, rules],
  );
  const suggestions = useMemo(
    () => (curated ? recommended.filter((c) => !isArchive(c)) : recommended),
    [recommended, curated],
  );
  return {
    visibleByAlias,
    favorites,
    recent,
    continueWatching,
    listenAgain,
    suggestions,
  };
}
