import type { Dispatch, SetStateAction } from "react";
import { mergeProfile } from "../persistence/profile";
import { contentAliases, type UserState } from "../persistence/user-state";
import type { Content } from "../domain/content";

// Small edits to the viewer's saved state.
export function useUserPatches(setUser: Dispatch<SetStateAction<UserState>>) {
  return {
    importProfile(profile: UserState) {
      setUser((current) => mergeProfile(current, profile));
    },
    setDrafts(patch: Partial<UserState["session"]["drafts"]>) {
      setUser((old) => ({
        ...old,
        session: {
          ...old.session,
          drafts: { ...old.session.drafts, ...patch },
        },
      }));
    },
    setPreferences(patch: Partial<UserState["preferences"]>) {
      setUser((old) => ({
        ...old,
        preferences: { ...old.preferences, ...patch },
      }));
    },
    // Forgets one title: its history entry and where you were in it.
    removeHistory(item: Content) {
      const ids = new Set(contentAliases(item));
      setUser((old) => ({
        ...old,
        history: old.history.filter((h) => !ids.has(h.id)),
        progress: Object.fromEntries(
          Object.entries(old.progress).filter(([id]) => !ids.has(id)),
        ),
      }));
    },
    clearHistory() {
      setUser((old) => ({
        ...old,
        history: [],
        progress: {},
        session: { ...old.session, nowId: undefined },
      }));
    },
    setLibraryView(patch: Partial<UserState["session"]["library"]>) {
      setUser((old) => ({
        ...old,
        session: {
          ...old.session,
          library: { ...old.session.library, ...patch },
          scroll: patch.tab
            ? { ...old.session.scroll, library: 0 }
            : old.session.scroll,
        },
      }));
    },
  };
}
