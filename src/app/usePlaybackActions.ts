import { moveInList } from "../domain/queue";
import { useEffect, useState } from "react";
import {
  applyContentPolicy,
  type ContentPolicy,
} from "../domain/content-policy";
import { isAudio, type Content } from "../domain/content";
import { canView } from "../domain/privacy";
import { sortedEpisodes } from "../domain/episodes";
import { contentAliases, type UserState } from "../persistence/user-state";
import { useChannelEntry } from "./useChannelEntry";

interface Inputs {
  // The filtered list on screen when playback starts, so Next and Previous stay in it.
  browse: { current: Content[] };
  playing: Content | null;
  setPlaying(item: Content | null): void;
  adult: boolean;
  policy: { current: ContentPolicy | undefined };
  setSelected(item: Content | null): void;
  setRestore(value: boolean): void;
  setUser(update: (old: UserState) => UserState): void;
  setNotice(message: string): void;
  visible: Content[];
  live: Content[];
  audio: Content[];
  movies: Content[];
}
// Starting, stopping and stepping through playback, the docked mini-player, the audio
// queue and number-key channel entry.
export function usePlaybackActions({
  browse,
  playing,
  setPlaying,
  adult,
  policy,
  setSelected,
  setRestore,
  setUser,
  setNotice,
  visible,
  live,
  audio,
  movies,
}: Inputs) {
  const [queue, setQueue] = useState<Content[]>([]),
    [context, setContext] = useState<Content[] | null>(null);
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    document.body.classList.toggle(
      "has-miniplayer",
      minimized && playing !== null,
    );
    return () => document.body.classList.remove("has-miniplayer");
  }, [minimized, playing]);
  // `within` is the list Next and Previous step through when it isn't the one on screen,
  // such as the channels a phone sent along with a "Play on TV".
  const play = (item: Content, _userIntent = true, within?: Content[]) => {
    const permitted = applyContentPolicy([item], policy.current)[0];
    if (
      !permitted ||
      !canView(item, adult) ||
      item.availability !== "playable" ||
      !item.streams.length
    )
      return;
    setSelected(null);
    // Switching between audio items from the dock keeps the dock.
    if (!(minimized && playing && isAudio(playing) && isAudio(item)))
      setMinimized(false);
    setPlaying(permitted);
    // Stepping to the next item keeps the list it came from.
    setContext(
      (old) =>
        within ??
        (browse.current.some((c) => c.id === item.id)
          ? browse.current
          : old?.some((c) => c.id === item.id)
            ? old
            : null),
    );
    setRestore(false);
    setUser((old) => ({
      ...old,
      history: [
        { id: item.id, at: Date.now() },
        ...old.history.filter((h) => !contentAliases(item).includes(h.id)),
      ].slice(0, 100),
      session: { ...old.session, nowId: item.id, selectedId: undefined },
    }));
  };
  const closePlayer = () => {
    setMinimized(false);
    setPlaying(null);
    setUser((old) => ({
      ...old,
      session: { ...old.session, nowId: undefined },
    }));
  };
  const enqueue = (item: Content) => {
    if (!isAudio(item) || item.availability !== "playable") return;
    setQueue((old) =>
      old.some((q) => q.id === item.id) ? old : [...old, item],
    );
    setNotice(`Added “${item.title}” to the queue.`);
  };
  // A whole playlist at once, with one notice instead of one per song.
  const enqueueAll = (items: Content[]) => {
    const audio = items.filter(
      (item) => isAudio(item) && item.availability === "playable",
    );
    if (!audio.length) return;
    setQueue((old) => [
      ...old,
      ...audio.filter((item) => !old.some((q) => q.id === item.id)),
    ]);
  };
  const changeChannel = (direction: number, userIntent = true) => {
    if (!playing) return;
    // The queue plays before the list order, in either dock or full player.
    if (direction === 1 && isAudio(playing) && queue.length) {
      const [next, ...rest] = queue;
      setQueue(rest);
      play(next, userIntent);
      return;
    }
    if (playing.seriesId) {
      const episodes = sortedEpisodes(visible, playing.seriesId);
      const next =
        episodes[episodes.findIndex((c) => c.id === playing.id) + direction];
      if (next) play(next, userIntent);
    } else {
      const everything =
        playing.type === "live" ? live : isAudio(playing) ? audio : movies;
      // Within the list you were browsing when there is one, playable titles only.
      const items = (context ?? everything).filter(
        (c) =>
          c.id === playing.id ||
          (c.availability === "playable" && c.streams.length > 0),
      );
      if (items.length)
        play(
          items[
            (items.findIndex((c) => c.id === playing.id) +
              direction +
              items.length) %
              items.length
          ],
          userIntent,
        );
    }
  };
  const channelEntry = useChannelEntry(
    playing?.type === "live" || (playing !== null && isAudio(playing)),
    playing?.type === "live" ? live : audio,
    playing?.id,
    (item) => play(item),
  );
  return {
    play,
    closePlayer,
    changeChannel,
    channelEntry,
    minimized,
    setMinimized,
    queue,
    enqueue,
    enqueueAll,
    clearQueue: () => setQueue([]),
    removeFromQueue: (id: string) =>
      setQueue((old) => old.filter((q) => q.id !== id)),
    // Moves one entry a step earlier (-1) or later (1).
    moveInQueue: (id: string, step: -1 | 1) =>
      setQueue((old) => moveInList(old, id, step)),
  };
}
