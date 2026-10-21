import { UpNext } from "./UpNext";
import { SITE_NAME } from "../config/site";
import { routeLabels } from "../playback/route";
import { useEffect, useRef, useState } from "react";
import {
  X,
  ExternalLink,
  Play,
  Pause,
  Rewind,
  FastForward,
  Tv,
} from "lucide-react";
import { ToolCluster } from "./player/ToolCluster";
import { PlaybackError } from "./player/PlaybackError";
import { VideoControls } from "./player/VideoControls";
import { useSleepTimer } from "./player/useSleepTimer";
import { isAudio, type Content } from "../domain/content";
import { EmbedFrame, type EmbedApi } from "./EmbedFrame";
import { EmbedDock } from "./player/EmbedDock";
import {
  canControl,
  emptyEmbedState,
  type EmbedState,
} from "../playback/embed-bridge";
import { useDeviceSettings } from "../persistence/device-settings";
import { musicClient, musicIdOf } from "../music/client";
import { useTrackInfo } from "../music/useTrackInfo";
import { AudioStage } from "./AudioStage";
import { MiniPlayer } from "./MiniPlayer";
import { connectAnalyser, corsReadable } from "../playback/analyser";
import { seekBy } from "../playback/seek";
import { clock } from "../playback/clock";
import { mixedContent } from "../domain/urls";
import { postDeviceMessage } from "../tv/device";
import {
  PlayerService,
  httpsVariant,
  type PlaybackSnapshot,
} from "../playback/player-service";
export interface RemoteAction {
  action: "pause" | "resume" | "seek";
  seconds?: number;
  respond(error?: string): void;
}
interface Props {
  // A paired TV is reachable: hand this over to it, from this position.
  onSendToTv?(seconds: number): void;
  tvLabel?: string;
  resolveUrl?: import("../playback/transport").PlaybackResolver;
  tv?: boolean;
  item: Content;
  startAt: number;
  // Brought back after a reload: load at startAt and wait for Play.
  startPaused?: boolean;
  volume: number;
  muted: boolean;
  onClose(): void;
  onNext(direction: number): void;
  onProgress(id: string, time: number, finished: boolean): void;
  onVolume(volume: number, muted: boolean): void;
  onEnded(): void;
  upNext?: Content;
  // Audio can dock to a bar and keep playing while you browse.
  minimized?: boolean;
  onMinimize?(): void;
  onExpand?(): void;
  // Audio waiting to play after this one.
  queue?: Content[];
  onClearQueue?(): void;
  onRemoveFromQueue?(id: string): void;
  onMoveInQueue?(id: string, step: -1 | 1): void;
  // An embedded server that never answered: the app drops it and plays the next one.
  onEmbedFailed?(item: Content, url: string): void;
  // A song whose audio would not play: offer the provider's player page instead.
  onMusicEmbed?(item: Content): void;
}
export function Player({
  resolveUrl,
  tv = false,
  item,
  startAt,
  startPaused = false,
  volume,
  muted,
  onClose,
  onNext,
  onEmbedFailed,
  onMusicEmbed,
  onProgress,
  onVolume,
  onEnded,
  upNext,
  minimized = false,
  onMinimize,
  onExpand,
  queue = [],
  onClearQueue,
  onRemoveFromQueue,
  onMoveInQueue,
  onSendToTv,
  tvLabel,
}: Props) {
  // An 18+ title is kept off the system's media controls, picture-in-picture and casting.
  const privateView = item.classification !== "general";
  const video = useRef<HTMLVideoElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    service = useRef<PlayerService | null>(null);
  const callbacks = useRef({ onClose, onNext, onProgress, onVolume, onEnded });
  callbacks.current = { onClose, onNext, onProgress, onVolume, onEnded };
  const docked = useRef(false);
  docked.current = minimized;
  const [snapshot, setSnapshot] = useState<PlaybackSnapshot>({
    phase: "loading",
    quality: [],
    audio: [],
    subtitles: [],
  });
  const [timeline, setTimeline] = useState({ time: 0, duration: 0 }),
    [upNextDismissed, setUpNextDismissed] = useState("");
  useEffect(() => {
    postDeviceMessage({
      type: "media",
      phase: snapshot.phase,
      title: privateView ? SITE_NAME : item.title.slice(0, 120),
      position: timeline.time * 1000,
      duration: timeline.duration * 1000,
    });
  }, [snapshot.phase, timeline, item.title, privateView]);
  useEffect(
    () => () => {
      postDeviceMessage({
        type: "media",
        phase: "idle",
        title: SITE_NAME,
        position: 0,
        duration: 0,
      });
    },
    [],
  );
  const [notice, setNotice] = useState(""),
    [showShortcuts, setShowShortcuts] = useState(false),
    [speed, setSpeed] = useState(1),
    [menuOpen, setMenuOpen] = useState(false),
    [idle, setIdle] = useState(false),
    [isFullscreen, setFullscreen] = useState(false),
    [pipActive, setPipActive] = useState(false);
  // A hint stays for a few seconds and then goes, so it never lingers as stale text.
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = (message: string) => {
    clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(""), 5000);
  };
  const sleep = useSleepTimer(() => callbacks.current.onClose());
  const shell = useRef<HTMLDivElement>(null);
  const [device] = useDeviceSettings();
  const skipRef = useRef(device.skipSeconds);
  skipRef.current = device.skipSeconds;
  const [embed, setEmbed] = useState<EmbedState>(emptyEmbedState);
  const [embedApi, setEmbedApi] = useState<EmbedApi | null>(null);
  const lastFullscreenExit = useRef(0);
  const isEmbed = item.streams[0]?.format === "embed";
  const audioMode =
    !isEmbed && (isAudio(item) || item.streams[0]?.format === "audio");
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const trackInfo = useTrackInfo(item);
  // An HTTP embed cannot load inside this secure page; its HTTPS address often works.
  const [upgraded, setUpgraded] = useState<{
    id: string;
    url: string | null;
  }>();
  const [probeAttempt, setProbeAttempt] = useState(0);
  useEffect(() => {
    setUpgraded(undefined);
    if (!isEmbed || !mixedContent(item.streams[0].url)) return;
    const probe = new AbortController();
    void httpsVariant(item.streams[0].url, probe.signal).then((url) => {
      if (!probe.signal.aborted) setUpgraded({ id: item.id, url });
    });
    return () => probe.abort();
  }, [item, isEmbed, probeAttempt]);
  const embedPending =
    isEmbed && mixedContent(item.streams[0].url) && upgraded?.id !== item.id;
  const blockedEmbed =
    isEmbed &&
    mixedContent(item.streams[0].url) &&
    upgraded?.id === item.id &&
    !upgraded.url;
  const embedItem: Content =
    isEmbed && upgraded?.id === item.id && upgraded.url
      ? {
          ...item,
          streams: [
            { ...item.streams[0], url: upgraded.url },
            ...item.streams.slice(1),
          ],
        }
      : item;
  const initial = useRef({ startAt, volume, muted, startPaused });
  initial.current = { startAt, volume, muted, startPaused };
  useEffect(() => {
    const previously = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    if (tv)
      (
        dialog.current?.querySelector<HTMLElement>("[data-remote-seek]") ||
        dialog.current?.querySelector<HTMLElement>("button")
      )?.focus();
    return () => previously?.focus();
  }, [tv]);
  // On a television the remote cannot reach into a server's frame, so once Open TV can
  // drive that player the focus moves to its own play button.
  const dockFocused = useRef("");
  useEffect(() => {
    if (!tv || !isEmbed || !embed.ready || !canControl(embed.protocol)) return;
    if (dockFocused.current === item.id) return;
    const play = dialog.current?.querySelector<HTMLElement>(
      ".embed-dock .pc-play",
    );
    if (!play) return;
    dockFocused.current = item.id;
    play.focus({ preventScroll: true });
  }, [tv, isEmbed, embed.ready, embed.protocol, item.id]);
  const dockable = audioMode && Boolean(onMinimize);
  // Minimizing closes the dialog but keeps this component, and its audio element, alive.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (minimized && dockable) {
      if (element.open) element.close();
    } else if (!element.open) {
      element.showModal();
      if (tv)
        (
          element.querySelector<HTMLElement>("[data-remote-seek]") ||
          element.querySelector<HTMLElement>("button")
        )?.focus();
    }
  }, [minimized, dockable, tv]);
  useEffect(() => {
    if (isEmbed || !video.current) return;
    const element = video.current;
    element.volume = initial.current.volume;
    element.muted = initial.current.muted;
    const engine = new PlayerService(element, setSnapshot, resolveUrl);
    service.current = engine;
    const abort = new AbortController();
    const start = async () => {
      const stream = item.streams[0];
      // A direct audio file can only feed the visualizer when the server allows this
      // page to read it; the attribute must be set before the file loads.
      if (audioMode && stream && stream.format !== "hls" && !resolveUrl) {
        if (await corsReadable(stream.url, abort.signal))
          element.crossOrigin = "anonymous";
        else element.removeAttribute("crossorigin");
      }
      // A song's real address is only known now; the visualizer can read it when its
      // server allows this page to.
      if (audioMode && stream && musicIdOf(stream.url)) {
        try {
          const real = await musicClient.resolveUrl(stream.url, abort.signal);
          if (await corsReadable(real, abort.signal))
            element.crossOrigin = "anonymous";
          else element.removeAttribute("crossorigin");
        } catch {
          /* The player reports the failure when it tries to play. */
        }
      }
      if (!abort.signal.aborted)
        void engine.play(
          item,
          initial.current.startAt,
          initial.current.startPaused,
        );
    };
    void start();
    // Connect the analyser only for audio the browser will let us read: an in-page
    // stream (HLS through MSE), a same-origin file, or a CORS-approved file.
    const attach = () => {
      if (!audioMode) return;
      const src = element.currentSrc;
      let sameOrigin = false;
      try {
        sameOrigin = new URL(src, location.href).origin === location.origin;
      } catch {
        /* Unreadable address: stay unconnected. */
      }
      if (
        src.startsWith("blob:") ||
        element.crossOrigin === "anonymous" ||
        sameOrigin
      )
        setAnalyser(connectAnalyser(element));
    };
    element.addEventListener("playing", attach);
    let lastSave = 0;
    const save = () => {
      if (
        Number.isFinite(element.duration) &&
        element.duration > 60 &&
        element.currentTime >= 0
      )
        callbacks.current.onProgress(
          item.id,
          element.currentTime,
          element.duration - element.currentTime < 15,
        );
    };
    const progress = () => {
      if (tv || audioMode)
        setTimeline((old) => {
          const time = Math.floor(element.currentTime),
            duration = Number.isFinite(element.duration)
              ? Math.floor(element.duration)
              : 0;
          return old.time === time && old.duration === duration
            ? old
            : { time, duration };
        });
      if (Date.now() - lastSave > 5000) {
        save();
        lastSave = Date.now();
      }
    };
    const volumeChange = () =>
      callbacks.current.onVolume(element.volume, element.muted);
    const ended = () => {
      save();
      callbacks.current.onEnded();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") save();
    };
    element.addEventListener("timeupdate", progress);
    element.addEventListener("loadedmetadata", progress);
    element.addEventListener("volumechange", volumeChange);
    element.addEventListener("ended", ended);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      abort.abort();
      element.removeEventListener("playing", attach);
      save();
      element.removeEventListener("timeupdate", progress);
      element.removeEventListener("loadedmetadata", progress);
      element.removeEventListener("volumechange", volumeChange);
      element.removeEventListener("ended", ended);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", visibility);
      if (document.pictureInPictureElement === element)
        void document.exitPictureInPicture().catch(() => {});
      engine.destroy();
      service.current = null;
    };
  }, [item, isEmbed, tv, resolveUrl, audioMode]);
  useEffect(() => {
    const change = () => {
      const active = document.fullscreenElement === shell.current;
      setFullscreen(active);
      if (!document.fullscreenElement) lastFullscreenExit.current = Date.now();
    };
    document.addEventListener("fullscreenchange", change);
    return () => {
      document.removeEventListener("fullscreenchange", change);
      clearTimeout(noticeTimer.current);
    };
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const enter = () => setPipActive(true);
    const leave = () => setPipActive(false);
    element.addEventListener("enterpictureinpicture", enter);
    element.addEventListener("leavepictureinpicture", leave);
    return () => {
      element.removeEventListener("enterpictureinpicture", enter);
      element.removeEventListener("leavepictureinpicture", leave);
    };
  }, [item, isEmbed]);
  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed, item]);
  // The shell (not the dialog, which the browser will not fullscreen) goes fullscreen, so the
  // controls, title and audio stage all come with it.
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    const target = shell.current;
    if (target?.requestFullscreen)
      try {
        await target.requestFullscreen();
        return;
      } catch {
        /* Try the video itself. */
      }
    const native = video.current as
      (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    try {
      if (native?.webkitEnterFullscreen) return native.webkitEnterFullscreen();
    } catch {
      /* Fall through to the hint. */
    }
    flash("Fullscreen is unavailable here. Try F11 in your browser.");
  };
  const togglePip = async () => {
    const element = video.current;
    if (!element) return;
    try {
      if (document.pictureInPictureElement === element)
        await document.exitPictureInPicture();
      else await element.requestPictureInPicture();
    } catch {
      flash("Picture in picture is unavailable for this stream.");
    }
  };
  const togglePlayback = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      void element
        .play()
        .catch(() => flash("Choose Play to start this stream."));
    } else element.pause();
  };
  const seek = (seconds: number) => {
    const element = video.current;
    if (element) seekBy(element, seconds);
  };
  const fullscreen = useRef(toggleFullscreen);
  fullscreen.current = toggleFullscreen;
  const transport = useRef({ togglePlayback, seek });
  transport.current = { togglePlayback, seek };
  // Lock-screen and headset controls, and the now-playing card on phones and TVs.
  useEffect(() => {
    if (!("mediaSession" in navigator) || isEmbed) return;
    const session = navigator.mediaSession;
    const hidden = privateView;
    const art = item.poster || item.artwork;
    session.metadata = new MediaMetadata({
      title: hidden ? SITE_NAME : item.title,
      artist: hidden ? "" : item.genres[0] || "",
      artwork: !hidden && art?.startsWith("https:") ? [{ src: art }] : [],
    });
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => transport.current.togglePlayback()],
      ["pause", () => transport.current.togglePlayback()],
      ["previoustrack", () => callbacks.current.onNext(-1)],
      ["nexttrack", () => callbacks.current.onNext(1)],
      ["seekbackward", () => transport.current.seek(-skipRef.current)],
      ["seekforward", () => transport.current.seek(skipRef.current)],
    ];
    for (const [action, handler] of actions) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        /* Unsupported action. */
      }
    }
    return () => {
      for (const [action] of actions) {
        try {
          session.setActionHandler(action, null);
        } catch {
          /* Unsupported action. */
        }
      }
      session.metadata = null;
    };
  }, [item, isEmbed, privateView]);
  useEffect(() => {
    const absoluteSeek = (event: Event) => {
      const seconds = (event as CustomEvent<{ seconds?: number }>).detail
        ?.seconds;
      if (
        video.current &&
        typeof seconds === "number" &&
        Number.isFinite(seconds) &&
        seconds >= 0
      )
        seekBy(video.current, seconds - video.current.currentTime);
    };
    window.addEventListener("opentv:seek", absoluteSeek);
    return () => window.removeEventListener("opentv:seek", absoluteSeek);
  }, []);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const v = video.current;
      const media = e.key.startsWith("Media");
      // While docked, the page keeps its own keys; only the media keys reach the player.
      if (docked.current && !media) return;
      if (
        !media &&
        (e.target as HTMLElement).matches(
          "input,select,textarea,button:not([data-remote-seek])",
        )
      )
        return;
      if (
        ["MediaTrackNext", "MediaTrackPrevious", "PageDown", "PageUp"].includes(
          e.key,
        )
      ) {
        e.preventDefault();
        if (!e.repeat)
          callbacks.current.onNext(
            ["MediaTrackNext", "PageDown"].includes(e.key) ? 1 : -1,
          );
        return;
      }
      if (!v) return;
      if ([" ", "k", "MediaPlayPause"].includes(e.key)) {
        e.preventDefault();
        if (!e.repeat) transport.current.togglePlayback();
      }
      if (e.key === "MediaPlay") {
        e.preventDefault();
        void v.play().catch(() => flash("Choose Play to start this stream."));
      }
      if (e.key === "MediaPause") {
        e.preventDefault();
        v.pause();
      }
      if (e.key === "MediaStop") {
        e.preventDefault();
        callbacks.current.onClose();
      }
      if (["ArrowRight", "MediaFastForward"].includes(e.key)) {
        e.preventDefault();
        transport.current.seek(skipRef.current);
      }
      if (["ArrowLeft", "MediaRewind"].includes(e.key)) {
        e.preventDefault();
        transport.current.seek(-skipRef.current);
      }
      if (!tv && e.key === "ArrowUp") {
        e.preventDefault();
        v.volume = Math.min(1, v.volume + 0.05);
      }
      if (!tv && e.key === "ArrowDown") {
        e.preventDefault();
        v.volume = Math.max(0, v.volume - 0.05);
      }
      if (e.key === "m") v.muted = !v.muted;
      if (e.key === "f") void fullscreen.current();
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [tv]);
  // Previous and Next only make sense where a title belongs to a run of others.
  const sequence =
    item.type === "live" || item.type === "radio"
      ? "channel"
      : item.seriesId || item.type === "episode" || item.type === "anime"
        ? "episode"
        : isAudio(item)
          ? "track"
          : null;
  const paused = snapshot.phase === "paused" || snapshot.phase === "ended";
  // An embedded server that reports its time gets the same resume and progress as a file.
  const embedSaved = useRef(0);
  useEffect(() => {
    if (!isEmbed || embed.duration < 60 || embed.time <= 0) return;
    if (Date.now() - embedSaved.current < 5000) return;
    embedSaved.current = Date.now();
    callbacks.current.onProgress(
      item.id,
      embed.time,
      embed.duration - embed.time < 15,
    );
  }, [embed.time, embed.duration, isEmbed, item.id]);
  const embedResumed = useRef("");
  useEffect(() => {
    if (!isEmbed || !embed.ready || !canControl(embed.protocol) || !embedApi)
      return;
    if (embedResumed.current === item.id) return;
    embedResumed.current = item.id;
    if (initial.current.startAt > 5)
      embedApi.command("seek", initial.current.startAt);
  }, [isEmbed, embed.ready, embed.protocol, embedApi, item.id]);
  const embedEnded = useRef("");
  useEffect(() => {
    if (!isEmbed || !embed.ended || embedEnded.current === item.id) return;
    embedEnded.current = item.id;
    callbacks.current.onEnded();
  }, [isEmbed, embed.ended, item.id]);
  useEffect(() => {
    setEmbed(emptyEmbedState);
  }, [item.id]);
  const overlay = !tv && !isEmbed && !audioMode;
  const live = item.type === "live" || item.type === "radio";
  const nextChannel = live ? () => onNext(1) : undefined;
  // Commands from a paired phone: the same actions the on-screen controls take.
  const remoteTarget = useRef({ isEmbed, embed, embedApi });
  remoteTarget.current = { isEmbed, embed, embedApi };
  useEffect(() => {
    const command = (event: Event) => {
      const detail = (event as CustomEvent<RemoteAction>).detail;
      const {
        isEmbed: framed,
        embed: state,
        embedApi: api,
      } = remoteTarget.current;
      if (framed) {
        if (!api || !state.ready || !canControl(state.protocol))
          return detail.respond("unsupported");
        if (detail.action === "seek")
          api.command("seek", Math.max(0, detail.seconds ?? 0));
        else api.command(detail.action === "pause" ? "pause" : "play");
        return detail.respond();
      }
      const element = video.current;
      if (!element) return detail.respond("idle");
      if (detail.action === "pause") element.pause();
      else if (detail.action === "resume")
        void element.play().catch(() => undefined);
      else if (Number.isFinite(element.duration))
        seekBy(element, (detail.seconds ?? 0) - element.currentTime);
      else return detail.respond("unsupported");
      detail.respond();
    };
    window.addEventListener("opentv:remote", command);
    return () => window.removeEventListener("opentv:remote", command);
  }, []);
  // What is playing, for the phone remote. Private titles are reported only by name of
  // the app, the same as to the TV's system media controls.
  useEffect(() => {
    const hidden = privateView;
    window.dispatchEvent(
      new CustomEvent("opentv:media", {
        detail: {
          phase: isEmbed
            ? embed.ready
              ? embed.playing
                ? "playing"
                : "paused"
              : "loading"
            : snapshot.phase,
          position: isEmbed ? embed.time : timeline.time,
          duration: isEmbed ? embed.duration : timeline.duration,
          title: hidden ? SITE_NAME : item.title.slice(0, 120),
          itemId: hidden ? undefined : item.id,
          artwork: hidden ? undefined : item.poster || item.artwork,
          live,
          embed: isEmbed,
          controllable: !isEmbed || (embed.ready && canControl(embed.protocol)),
        },
      }),
    );
  }, [
    snapshot.phase,
    timeline,
    embed.ready,
    embed.playing,
    embed.time,
    embed.duration,
    embed.protocol,
    isEmbed,
    item,
    live,
    privateView,
  ]);
  useEffect(
    () => () => {
      window.dispatchEvent(
        new CustomEvent("opentv:media", { detail: { phase: "idle" } }),
      );
    },
    [],
  );
  // The controls fade away while a picture plays and come back with any movement.
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const quiet =
    overlay &&
    device.autoHideControls &&
    snapshot.phase === "playing" &&
    !menuOpen &&
    !showShortcuts &&
    !notice;
  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    if (quiet) idleTimer.current = setTimeout(() => setIdle(true), 3200);
  };
  const wakeRef = useRef(wake);
  wakeRef.current = wake;
  useEffect(() => {
    wakeRef.current();
    return () => clearTimeout(idleTimer.current);
  }, [quiet]);
  // Keyboard users land on play/pause, so Space does what the shortcut hint says.
  useEffect(() => {
    if (tv || isEmbed) return;
    const id = requestAnimationFrame(() =>
      dialog.current
        ?.querySelector<HTMLElement>(".pc-play, .audio-play")
        ?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(id);
  }, [item, tv, isEmbed]);
  const cluster = (
    <ToolCluster
      tv={tv}
      sequence={sequence}
      onStep={onNext}
      snapshot={snapshot}
      service={service}
      sleep={sleep}
      onSleepSet={(minutes) => {
        sleep.set(minutes);
        flash(`Sleep timer set for ${minutes} minutes.`);
      }}
      onSleepCancel={() => {
        sleep.cancel();
        flash("Sleep timer cancelled.");
      }}
      showPip={
        !tv && !privateView && !isEmbed && document.pictureInPictureEnabled
      }
      pipActive={pipActive}
      onPip={() => void togglePip()}
      fullscreen={isFullscreen}
      onFullscreen={() => void toggleFullscreen()}
      shortcutsOpen={showShortcuts}
      onShortcuts={() => setShowShortcuts((value) => !value)}
      onMenuOpen={setMenuOpen}
      speed={overlay && !live ? { value: speed, set: setSpeed } : null}
      extra={
        onSendToTv && (
          <button
            type="button"
            className="pc-button"
            aria-label={`Move to ${tvLabel || "TV"}`}
            title={`Move to ${tvLabel || "TV"}`}
            onClick={() =>
              onSendToTv(
                isEmbed ? embed.time : (video.current?.currentTime ?? 0),
              )
            }
          >
            <Tv size={19} />
          </button>
        )
      }
    />
  );
  return (
    <>
      <dialog
        ref={dialog}
        className="player-dialog"
        onCancel={(event) => {
          // Escape leaves fullscreen first; it only closes the player from a normal view.
          if (
            document.fullscreenElement ||
            Date.now() - lastFullscreenExit.current < 600
          ) {
            event.preventDefault();
            return;
          }
          if (dockable) {
            event.preventDefault();
            onMinimize?.();
          } else onClose();
        }}
      >
        <div
          ref={shell}
          className={`player-shell ${overlay ? "overlay" : ""} ${overlay && idle ? "ui-idle" : ""}`}
          onPointerMove={wake}
          onPointerDown={wake}
          onKeyDown={wake}
          onFocus={wake}
        >
          <div className="player-bar">
            <div>
              {live && item.type === "live" && (
                <span className="player-live">Live</span>
              )}
              <h2>{item.title}</h2>
              {item.rights.attribution && (
                <p className="player-source">
                  {item.rights.attribution}
                  {item.rights.url && (
                    <a
                      href={item.rights.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Content rights information"
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                </p>
              )}
            </div>
            <button
              className="icon-button"
              onClick={onClose}
              aria-label="Close player"
            >
              <X />
            </button>
          </div>
          <div className="player-stage">
            {upNext &&
              snapshot.phase === "ended" &&
              upNextDismissed !== item.id && (
                <UpNext
                  key={upNext.id}
                  item={upNext}
                  onPlay={() => onNext(1)}
                  onCancel={() => setUpNextDismissed(item.id)}
                />
              )}
            {blockedEmbed ? (
              <PlaybackError
                title="This embedded player needs HTTPS"
                message="Use the provider’s HTTPS player or open another stream."
                onRetry={() => setProbeAttempt((n) => n + 1)}
                onNextSource={
                  item.streams.length > 1 && onEmbedFailed
                    ? () => onEmbedFailed(item, item.streams[0].url)
                    : undefined
                }
                onNextChannel={nextChannel}
                onBack={onClose}
              />
            ) : embedPending ? (
              <div className="player-loading" role="status">
                <span className="spinner" />
                Checking the secure address…
              </div>
            ) : isEmbed ? (
              <EmbedFrame
                item={embedItem}
                onFailed={onEmbedFailed}
                onNextChannel={nextChannel}
                onBack={onClose}
                onState={setEmbed}
                onApi={setEmbedApi}
              />
            ) : (
              <video
                ref={video}
                className={audioMode ? "audio-element" : undefined}
                controls={false}
                disablePictureInPicture={privateView}
                disableRemotePlayback={privateView}
                playsInline
                preload="metadata"
                tabIndex={tv ? -1 : 0}
                onClick={overlay ? togglePlayback : undefined}
                onDoubleClick={
                  overlay ? () => void toggleFullscreen() : undefined
                }
              />
            )}
            {audioMode && (
              <AudioStage
                item={item}
                video={video}
                analyser={analyser}
                playing={snapshot.phase === "playing"}
                paused={paused}
                timeline={timeline}
                muted={muted}
                volume={volume}
                tv={tv}
                onToggle={togglePlayback}
                onSeek={seek}
                onMinimize={dockable ? onMinimize : undefined}
                queue={queue}
                onClearQueue={onClearQueue}
                info={trackInfo}
                onRemoveFromQueue={onRemoveFromQueue}
                onMoveInQueue={onMoveInQueue}
              />
            )}
            {tv && !isEmbed && !audioMode && (
              <button
                className="tv-play-surface"
                data-remote-seek
                aria-label="Video: play or pause"
                onClick={togglePlayback}
              >
                <span>
                  {paused ? <Play size={32} /> : <Pause size={32} />}
                  <span>{paused ? "Play" : "Pause"}</span>
                </span>
              </button>
            )}
            {!isEmbed &&
              ["loading", "buffering", "recovering"].includes(
                snapshot.phase,
              ) && (
                <div className="player-loading" role="status">
                  <span className="spinner" />
                  {snapshot.message ||
                    (snapshot.phase === "buffering"
                      ? "Buffering…"
                      : "Opening your stream…")}
                </div>
              )}
            {!isEmbed && snapshot.phase === "error" && (
              <PlaybackError
                title="We couldn’t open this stream"
                message={snapshot.message}
                detail={
                  snapshot.route && (
                    <p className="fine-print player-route">
                      Tried: {routeLabels[snapshot.route].toLowerCase()}.
                    </p>
                  )
                }
                onRetry={() =>
                  void service.current?.play(item, initial.current.startAt)
                }
                onNextSource={
                  item.streams.length > 1
                    ? () => void service.current?.nextSource()
                    : undefined
                }
                onNextChannel={nextChannel}
                onBack={onClose}
              >
                {item.providerId === "music" && onMusicEmbed && (
                  <button
                    className="button secondary"
                    onClick={() => onMusicEmbed(item)}
                  >
                    Open the player page
                  </button>
                )}
              </PlaybackError>
            )}
            {overlay && snapshot.phase !== "error" && (
              <VideoControls
                video={video}
                live={live}
                skip={device.skipSeconds}
                onToggle={togglePlayback}
                trailing={cluster}
              />
            )}
          </div>
          {tv && !isEmbed && !audioMode && (
            <div className="tv-transport">
              <button className="button secondary" onClick={togglePlayback}>
                {paused ? <Play size={20} /> : <Pause size={20} />}
                {paused ? "Play" : "Pause"}
              </button>
              {timeline.duration > 0 ? (
                <>
                  <button
                    className="icon-button"
                    aria-label="Rewind 10 seconds"
                    onClick={() => seek(-10)}
                  >
                    <Rewind size={20} />
                  </button>
                  {/* Shown, not focused: on a remote the arrows would be stuck inside it.
                      Rewind, Forward and left/right on the picture seek instead. */}
                  <input
                    type="range"
                    tabIndex={-1}
                    aria-label="Seek video"
                    min="0"
                    max={timeline.duration}
                    step="1"
                    value={Math.min(timeline.time, timeline.duration)}
                    onChange={(e) => {
                      if (video.current)
                        video.current.currentTime = Number(e.target.value);
                    }}
                  />
                  <button
                    className="icon-button"
                    aria-label="Forward 10 seconds"
                    onClick={() => seek(10)}
                  >
                    <FastForward size={20} />
                  </button>
                  <output aria-label="Playback time">
                    {clock(timeline.time)} / {clock(timeline.duration)}
                  </output>
                </>
              ) : (
                <span className="eyebrow">
                  {live ? "Live stream" : "Loading duration…"}
                </span>
              )}
            </div>
          )}
          {isEmbed && device.embedSync && (
            <EmbedDock state={embed} api={embedApi} skip={device.skipSeconds} />
          )}
          {!overlay && cluster}
          {notice && (
            <p className="player-hint" role="status">
              {notice}
            </p>
          )}
          {showShortcuts && (
            <p className="player-hint" id="playback-shortcuts">
              {isEmbed
                ? tv
                  ? "Back closes. If the remote cannot reach this player, use a phone or mouse for its controls."
                  : "Use the provider’s player controls."
                : tv
                  ? "OK: play/pause · Left/right on video: seek · Back: close"
                  : "Space: pause · Left/right: seek · Up/down: volume · M: mute · F: fullscreen · Esc: close"}
            </p>
          )}
        </div>
      </dialog>
      {dockable && minimized && (
        <MiniPlayer
          item={item}
          paused={paused}
          loading={["loading", "buffering", "recovering"].includes(
            snapshot.phase,
          )}
          timeline={timeline}
          onToggle={togglePlayback}
          onNext={onNext}
          onExpand={() => onExpand?.()}
          onClose={onClose}
        />
      )}
    </>
  );
}
