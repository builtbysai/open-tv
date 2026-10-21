import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Content } from "../domain/content";
import { applyContentPolicy } from "../domain/content-policy";
import type { ContentPolicy } from "../domain/content-policy";
import { isUnowned } from "../domain/discover";
import { resumeEpisode, sortedEpisodes } from "../domain/episodes";
import { canView } from "../domain/privacy";
import {
  contentAliases,
  progressFor,
  type UserState,
} from "../persistence/user-state";
import type { TmdbProvider } from "../providers/tmdb";
import { isAudio } from "../domain/content";

// The title whose details are open: whether the current rules still allow it, the
// restore after a reload, opening a title, and its episodes and resume point.
export function useSelection({
  selected,
  setSelected,
  visible,
  user,
  setUser,
  adult,
  rules,
  policyRef,
  metadata,
}: {
  selected: Content | null;
  setSelected: Dispatch<SetStateAction<Content | null>>;
  visible: Content[];
  user: UserState;
  setUser: Dispatch<SetStateAction<UserState>>;
  adult: boolean;
  rules: ContentPolicy;
  policyRef: MutableRefObject<ContentPolicy>;
  metadata: TmdbProvider | null;
}) {
  const selectedToRestore = useRef(user.session.selectedId);
  const selectedPermitted = useMemo(
    () => selected && applyContentPolicy([selected], rules)[0],
    [selected, rules],
  );
  // Closing forgets the title, so a reload does not reopen it.
  const close = useCallback(() => {
    setSelected(null);
    setUser((old) => ({
      ...old,
      session: { ...old.session, selectedId: undefined },
    }));
  }, [setSelected, setUser]);
  useEffect(() => {
    if (selected && !selectedPermitted) close();
  }, [selected, selectedPermitted, close]);
  useEffect(() => {
    if (!selectedToRestore.current) return;
    const found = visible.find((c) =>
      contentAliases(c).includes(selectedToRestore.current!),
    );
    if (found) {
      setSelected(found);
      selectedToRestore.current = undefined;
    }
  }, [visible, setSelected]);
  const select = async (item: Content) => {
    const permitted = applyContentPolicy([item], policyRef.current)[0];
    if (!permitted) return;
    if (!canView(item, adult)) return;
    setSelected(permitted);
    if (!isUnowned(item))
      setUser((old) => ({
        ...old,
        session: { ...old.session, selectedId: item.id },
      }));
    // 18+ titles are never looked up on TMDB.
    if (
      metadata &&
      !isUnowned(item) &&
      !item.poster &&
      item.classification === "general" &&
      item.type !== "live" &&
      !isAudio(item)
    ) {
      const details = await metadata
        .lookup(item.title.replace(/\s*\(\d{4}\)$/, ""), item.type)
        .catch(() => null);
      if (details)
        setSelected((old) =>
          old?.id === item.id ? { ...old, ...details } : old,
        );
    }
  };
  const selectedEpisodes = useMemo(
    () =>
      selected && (selected.type === "series" || selected.seriesId)
        ? sortedEpisodes(
            visible,
            selected.type === "series" ? selected.id : selected.seriesId!,
          )
        : [],
    [selected, visible],
  );
  const selectedResume = useMemo(
    () =>
      selected?.type !== "series"
        ? undefined
        : resumeEpisode(
            selectedEpisodes,
            user.history,
            (c) => progressFor(user, c),
            contentAliases,
          ),
    [selected, selectedEpisodes, user],
  );
  return { selectedPermitted, select, close, selectedResume };
}
