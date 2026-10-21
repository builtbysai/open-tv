import { mergeWishes } from "../domain/wishlist";
import { loadUserState, STORAGE_KEY, type UserState } from "./user-state";
import { AppError } from "../domain/errors";
export function exportProfile(user: UserState) {
  return {
    version: 1,
    kind: "open-tv-general-profile",
    profile: {
      ...user,
      preferences: {
        volume: user.preferences.volume,
        muted: user.preferences.muted,
      },
    },
  };
}
export function parseProfile(text: string): UserState {
  if (text.length > 2_000_000)
    throw new AppError("format", "This profile exceeds the 2 MB import limit.");
  try {
    const value = JSON.parse(text);
    if (
      !value ||
      value.version !== 1 ||
      value.kind !== "open-tv-general-profile" ||
      value.profile?.version !== 2
    )
      throw new Error();
    const source = value.profile,
      preferences = source.preferences;
    const sanitized = {
      ...source,
      preferences: { volume: preferences?.volume, muted: preferences?.muted },
    };
    return loadUserState({
      getItem: (key) =>
        key === STORAGE_KEY ? JSON.stringify(sanitized) : null,
      setItem: () => {},
    });
  } catch {
    throw new AppError(
      "format",
      "Choose an Open TV general-profile backup. Invalid data cannot replace your saved profile.",
    );
  }
}
export function mergeProfile(
  current: UserState,
  incoming: UserState,
): UserState {
  const collections = new Map(current.collections.map((c) => [c.id, c]));
  for (const c of incoming.collections) {
    const existing = collections.get(c.id);
    if (existing)
      collections.set(c.id, {
        ...existing,
        itemIds: [...new Set([...existing.itemIds, ...c.itemIds])].slice(
          0,
          10000,
        ),
      });
    else if (collections.size < 100) collections.set(c.id, c);
  }
  const history = new Map(current.history.map((h) => [h.id, h]));
  for (const h of incoming.history)
    if (!history.has(h.id) || history.get(h.id)!.at < h.at)
      history.set(h.id, h);
  return {
    ...current,
    favorites: [
      ...new Set([...current.favorites, ...incoming.favorites]),
    ].slice(0, 10000),
    wishlist: mergeWishes(current.wishlist, incoming.wishlist),
    collections: [...collections.values()],
    history: [...history.values()].sort((a, b) => b.at - a.at).slice(0, 100),
    progress: { ...incoming.progress, ...current.progress },
    preferences: {
      ...current.preferences,
      volume: incoming.preferences.volume,
      muted: incoming.preferences.muted,
    },
    session: {
      ...incoming.session,
      ...current.session,
      query: current.session.query || incoming.session.query,
      nowId: current.session.nowId || incoming.session.nowId,
      views: { ...incoming.session.views, ...current.session.views },
      scroll: { ...incoming.session.scroll, ...current.session.scroll },
      drafts: { ...incoming.session.drafts, ...current.session.drafts },
    },
  };
}
