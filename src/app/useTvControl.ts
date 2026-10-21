import { useEffect, useRef } from "react";
import { isAudio, type Content } from "../domain/content";
import { canView } from "../domain/privacy";
import { musicClient, musicIdOf } from "../music/client";
import type { RemoteAction } from "../components/Player";
import { contentFromRef, toItemRef } from "../remote/items";
import type { Command, NowPlaying, Phase } from "../remote/protocol";
import { remoteMessage, type Remote } from "../remote/useRemote";
import { useReceiver } from "../remote/useReceiver";
import { postDeviceMessage } from "../tv/device";

const PHASES: Phase[] = [
  "idle",
  "loading",
  "playing",
  "paused",
  "buffering",
  "ended",
  "error",
];
interface MediaDetail {
  phase: string;
  position?: number;
  duration?: number;
  title?: string;
  itemId?: string;
  artwork?: string;
  live?: boolean;
  embed?: boolean;
  controllable?: boolean;
}
function ask(action: RemoteAction["action"], seconds?: number) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    let answered = false;
    window.dispatchEvent(
      new CustomEvent<RemoteAction>("opentv:remote", {
        detail: {
          action,
          seconds,
          respond: (error) => {
            answered = true;
            resolve(error ? { ok: false, error } : { ok: true });
          },
        },
      }),
    );
    // No player listening: nothing is open.
    if (!answered) resolve({ ok: false, error: "idle" });
  });
}

// Asks the Android app to come back to the front, and waits briefly for it.
function foreground(): Promise<boolean> {
  postDeviceMessage({ type: "foreground" });
  return new Promise((resolve) => {
    if (document.visibilityState === "visible") return resolve(true);
    const done = () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", seen);
      resolve(document.visibilityState === "visible");
    };
    const seen = () => {
      if (document.visibilityState === "visible") done();
    };
    const timer = setTimeout(done, 2500);
    document.addEventListener("visibilitychange", seen);
  });
}
// The Android app turns the TV's own volume; in a browser the player's volume moves.
function volume(step: -1 | 0 | 1): { ok: boolean; error?: string } {
  if (/OpenTVAndroid\//.test(navigator.userAgent)) {
    postDeviceMessage({ type: "volume", step });
    return { ok: true };
  }
  const media = document.querySelector<HTMLMediaElement>(
    "dialog.player-dialog video, dialog.player-dialog audio, .mini-player audio",
  );
  if (!media) return { ok: false, error: "idle" };
  if (step === 0) media.muted = !media.muted;
  else {
    media.muted = false;
    media.volume = Math.min(1, Math.max(0, media.volume + step * 0.1));
  }
  return { ok: true };
}

// The TV as a receiver: paired phones' commands start and steer playback here, and what
// is playing goes back to them.
export function useTvReceiver({
  tv,
  name,
  visible,
  adult,
  playing,
  play,
  closePlayer,
  changeChannel,
  startAt,
  setAdult,
}: {
  tv: boolean;
  name: string;
  visible: Content[];
  adult: boolean;
  playing: Content | null;
  play(item: Content, userIntent?: boolean, within?: Content[]): void;
  closePlayer(): void;
  changeChannel(direction: number): void;
  // Where the next item should start, when a phone hands over a position.
  startAt(itemId: string, seconds: number): void;
  // Shows or hides 18+ for a phone; resolves false when this TV doesn't allow it.
  setAdult(show: boolean): Promise<boolean> | boolean;
}) {
  const current = useRef({
    visible,
    adult,
    playing,
    play,
    closePlayer,
    changeChannel,
  });
  current.current = {
    visible,
    adult,
    playing,
    play,
    closePlayer,
    changeChannel,
  };
  const steppable = useRef(false);
  const startRef = useRef(startAt);
  startRef.current = startAt;
  const setAdultRef = useRef(setAdult);
  setAdultRef.current = setAdult;
  const receiver = useReceiver(tv, name, async (command: Command) => {
    const now = current.current;
    switch (command.t) {
      case "play": {
        // Started from the phone while the app is behind another one: ask to come back
        // to the front first, so nothing plays unseen.
        if (document.visibilityState !== "visible" && !(await foreground()))
          return { ok: false, error: "background" };
        const item = contentFromRef(command.item, now.visible);
        if (!canView(item, now.adult)) return { ok: false, error: "adult" };
        if (item.availability !== "playable")
          return { ok: false, error: "unplayable" };
        const within = command.queue
          ?.map((ref) => contentFromRef(ref, now.visible))
          .filter((c) => canView(c, now.adult));
        steppable.current = Boolean(within && within.length > 1);
        if (command.start) startRef.current(item.id, command.start);
        now.play(
          item,
          true,
          within?.some((c) => c.id === item.id) ? within : undefined,
        );
        return { ok: true };
      }
      case "stop":
        if (now.playing) now.closePlayer();
        return { ok: true };
      case "next":
      case "previous":
        if (!now.playing) return { ok: false, error: "idle" };
        now.changeChannel(command.t === "next" ? 1 : -1);
        return { ok: true };
      case "adult":
        return (await setAdultRef.current(command.show))
          ? { ok: true }
          : { ok: false, error: "adult-locked" };
      case "volume":
        return volume(command.step);
      case "seek":
        return now.playing
          ? ask("seek", command.seconds)
          : { ok: false, error: "idle" };
      default:
        return now.playing ? ask(command.t) : { ok: false, error: "idle" };
    }
  });
  const report = receiver.report;
  useEffect(() => {
    if (!receiver.enabled) return;
    const media = (event: Event) => {
      const d = (event as CustomEvent<MediaDetail>).detail;
      const phase: Phase =
        d.phase === "recovering"
          ? "buffering"
          : PHASES.includes(d.phase as Phase)
            ? (d.phase as Phase)
            : "loading";
      const playingNow = current.current.playing;
      const state: NowPlaying = {
        phase,
        position: Math.max(0, d.position ?? 0),
        duration: Number.isFinite(d.duration)
          ? Math.max(0, d.duration ?? 0)
          : 0,
        at: Date.now(),
        title: d.title ?? "",
        ...(d.itemId ? { itemId: d.itemId } : {}),
        ...(d.artwork && /^https?:/.test(d.artwork)
          ? { artwork: d.artwork }
          : {}),
        canSeek:
          phase !== "idle" &&
          !d.live &&
          d.controllable !== false &&
          Number.isFinite(d.duration) &&
          (d.duration ?? 0) > 0,
        canStep:
          phase !== "idle" &&
          !!playingNow &&
          (playingNow.type === "live" ||
            isAudio(playingNow) ||
            !!playingNow.seriesId ||
            steppable.current),
        visible: document.visibilityState === "visible",
      };
      lastDetail = d;
      report(state);
    };
    let lastDetail: MediaDetail = { phase: "idle" };
    // Phones learn when the TV app goes behind another app, and when it comes back.
    const visibility = () =>
      media(new CustomEvent("opentv:media", { detail: lastDetail }));
    visibility();
    window.addEventListener("opentv:media", media);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("opentv:media", media);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [receiver.enabled, report]);
  return receiver;
}

// "Play on TV" from a phone or computer: sends the item, the streams it already has (a
// song's address resolved here first), where to start, and the list to step through:
// the channels around a channel, or for songs the queue and what follows in the list.
export async function playOnTv(
  remote: Remote,
  item: Content,
  list: Content[],
  options: { start?: number; queue?: Content[] } = {},
): Promise<void> {
  const ref = toItemRef(item);
  const placeholder = ref.streams.find((s) => musicIdOf(s.url));
  if (placeholder) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      placeholder.url = await musicClient.resolveUrl(
        placeholder.url,
        controller.signal,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  const playable = (c: Content) =>
    c.availability === "playable" && c.streams.length > 0;
  let queue: ReturnType<typeof toItemRef>[] | undefined;
  if (item.type === "live" || item.type === "radio") {
    const same = list.filter(
      (c) =>
        c.type === item.type &&
        playable(c) &&
        !c.streams.some((s) => musicIdOf(s.url)),
    );
    const at = same.findIndex((c) => c.id === item.id);
    if (at >= 0) {
      // Up to 300 channels, centred on this one.
      const start = Math.max(0, Math.min(at - 150, same.length - 300));
      queue = same.slice(start, start + 300).map(toItemRef);
    }
  } else if (item.type === "audio") {
    // Songs: this one, the queue, then the rest of the list. Song addresses stay
    // placeholders; the TV looks them up when their turn comes.
    const after = list.slice(list.findIndex((c) => c.id === item.id) + 1);
    const songs = [...(options.queue ?? []), ...after].filter(
      (c) => c.type === "audio" && playable(c) && c.id !== item.id,
    );
    if (songs.length) queue = [ref, ...songs.slice(0, 199).map(toItemRef)];
  }
  const start =
    options.start && options.start > 5 && item.type !== "live"
      ? Math.floor(options.start)
      : undefined;
  await remote.send({
    t: "play",
    item: ref,
    ...(queue ? { queue } : {}),
    ...(start ? { start } : {}),
  });
}
export { remoteMessage };
