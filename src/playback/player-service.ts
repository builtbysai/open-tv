import type Hls from "hls.js";
import type { Content, Stream } from "../domain/content";
import { diagnose, AppError } from "../domain/errors";
import {
  createTransport,
  type PlaybackResolver,
  type Resolution,
  type Route,
} from "./route";
import { mediaUrl } from "../domain/urls";
import { RecoveryBudget, type PlaybackPhase } from "./recovery";
import {
  chooseAudioTrack,
  canDecode,
  codecName,
  describeTrack,
  deviceProbe,
  transcodeAudioUrl,
  undecodableMessage,
  type AudioChoice,
  type AudioTrackInfo,
} from "./audio-tracks";
import { logMedia } from "./media-log";
import { readAudioChoice, saveAudioChoice } from "../persistence/audio-choice";
export interface Track {
  id: number;
  label: string;
}
type MediaWithCounters = HTMLVideoElement & {
  webkitAudioDecodedByteCount?: number;
  webkitVideoDecodedByteCount?: number;
  mozHasAudio?: boolean;
  audioTracks?: ArrayLike<{
    language: string;
    label: string;
    enabled: boolean;
  }>;
};
const unique = (values: (string | undefined)[]) => [
  ...new Set(values.filter((v): v is string => Boolean(v))),
];
const trackInfo = (
  t: {
    audioCodec?: string;
    lang?: string;
    name: string;
    channels?: string;
    default: boolean;
  },
  id: number,
): AudioTrackInfo => ({
  id,
  codec: t.audioCodec,
  lang: t.lang,
  name: t.name || undefined,
  channels: Number.parseInt(t.channels ?? "", 10) || undefined,
  default: t.default,
});
export interface PlaybackSnapshot {
  phase: PlaybackPhase;
  message?: string;
  // How the stream reached the player (direct, its HTTPS version, the TV app, the relay).
  route?: Route;
  quality: Track[];
  audio: Track[];
  subtitles: Track[];
  // The audio track playing, and a note when it is a fallback (another track, or the
  // server converting the audio).
  audioId?: number;
  audioNote?: string;
  // The picture plays but no sound has been decoded: likely an audio codec this device lacks.
  silentAudio?: boolean;
}
export interface PlaybackEngine {
  play(item: Content, startAt?: number, paused?: boolean): Promise<void>;
  stop(): void;
  destroy(): void;
}
// The HTTPS form of an HTTP address when the host answers on it, otherwise null. The probe
// only learns that something answered; the stream's own checks follow.
export async function httpsVariant(
  url: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (!url.startsWith("http://")) return null;
  const secure = `https://${url.slice("http://".length)}`;
  try {
    await fetch(secure, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
    });
    return secure;
  } catch {
    return null;
  }
}
export class PlayerService implements PlaybackEngine {
  private hls: Hls | null = null;
  private generation = 0;
  private budget = new RecoveryBudget();
  private item: Content | null = null;
  private index = 0;
  private recovering = false;
  private cleanups: (() => void)[] = [];
  private stallTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  // Set for a title brought back after a reload: it loads and waits for Play.
  private hold = false;
  private connection: AbortController | null = null;
  private resolution: Resolution | null = null;
  // Where the current attempt started, and why the last one failed, for the recovery path.
  private startAt = 0;
  private failure: string | undefined;
  private audioTracks: AudioTrackInfo[] = [];
  private audioNote: string | undefined;
  // Sources already re-requested with converted audio, by index.
  private converted = new Set<number>();
  private snapshot: PlaybackSnapshot = {
    phase: "idle",
    quality: [],
    audio: [],
    subtitles: [],
  };
  constructor(
    private video: HTMLVideoElement,
    private notify: (snapshot: PlaybackSnapshot) => void,
    private resolveUrl?: PlaybackResolver,
  ) {}
  private publish(phase: PlaybackPhase, message?: string) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, phase, message };
    this.notify(this.snapshot);
  }
  async play(item: Content, startAt = 0, paused = false) {
    this.stop();
    this.disposed = false;
    this.hold = paused;
    this.item = item;
    this.budget = new RecoveryBudget(2);
    this.index = 0;
    this.failure = undefined;
    this.converted.clear();
    this.audioNote = undefined;
    if (!item.streams.length || item.availability !== "playable") {
      this.publish("error", "No playable media is available for this title.");
      return;
    }
    this.snapshot = { phase: "loading", quality: [], audio: [], subtitles: [] };
    await this.attach(item.streams[0], startAt);
  }
  private listen(type: string, listener: EventListener) {
    this.video.addEventListener(type, listener);
    this.cleanups.push(() => this.video.removeEventListener(type, listener));
  }
  private teardown() {
    this.connection?.abort();
    this.connection = null;
    clearTimeout(this.stallTimer);
    for (const off of this.cleanups.splice(0)) off();
    this.hls?.destroy();
    this.hls = null;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
  }
  private async attach(stream: Stream, startAt: number) {
    const generation = ++this.generation;
    this.teardown();
    this.recovering = false;
    this.startAt = startAt;
    let url = mediaUrl(stream.url);
    if (!url || stream.format === "embed") {
      this.publish("error", "This media format needs the external player.");
      return;
    }
    {
      const resolve = (this.resolveUrl ??= createTransport({ relay: null }));
      const connection = new AbortController();
      this.connection = connection;
      try {
        const resolved = await resolve(url, connection.signal, stream.format);
        url = resolved.url;
        this.resolution = resolved;
        this.failure = undefined;
        this.snapshot = { ...this.snapshot, route: resolved.route };
      } catch (error) {
        if (generation !== this.generation || connection.signal.aborted) return;
        const message =
          error instanceof AppError
            ? error.message
            : "The playback connection could not be prepared.";
        // A network hiccup (a slow music service, a dropped request) gets the same
        // retry as a media error; a refusal or a bad address is final at once.
        if (error instanceof AppError && error.code === "network") {
          this.failure = message;
          void this.recover();
        } else this.publish("error", message);
        return;
      }
      if (generation !== this.generation || connection.signal.aborted) return;
      if (!mediaUrl(url)) {
        this.publish(
          "error",
          "The playback connection returned an invalid media URL.",
        );
        return;
      }
    }
    this.snapshot = {
      ...this.snapshot,
      quality: [],
      audio: [],
      subtitles: [],
      audioId: undefined,
      audioNote: undefined,
      silentAudio: false,
    };
    this.audioTracks = [];
    this.publish("loading");
    const watchdog = () => {
      clearTimeout(this.stallTimer);
      this.stallTimer = setTimeout(() => void this.recover(), 20000);
    };
    // When it started and when it paused, so a pause a second in is plain in the log.
    let startedAt = 0;
    this.listen("playing", () => {
      clearTimeout(this.stallTimer);
      startedAt = Date.now();
      logMedia("player", `playing at ${Math.floor(this.video.currentTime)} s`);
      this.publish("playing");
    });
    this.watchSilence(stream);
    this.listen("pause", () => {
      clearTimeout(this.stallTimer);
      if (!this.video.ended) {
        const after = startedAt ? (Date.now() - startedAt) / 1000 : 0;
        logMedia(
          "player",
          `paused at ${Math.floor(this.video.currentTime)} s, ${after.toFixed(1)} s after it started`,
        );
        this.publish("paused");
      }
    });
    this.listen("waiting", () => {
      this.publish("buffering");
      watchdog();
    });
    // Frames moving means it is playing, even when the browser never said "playing" again
    // after a stall (some streams only resume with a progress event).
    let lastTime = -1;
    this.listen("timeupdate", () => {
      const moving = this.video.currentTime !== lastTime;
      lastTime = this.video.currentTime;
      if (
        moving &&
        !this.video.paused &&
        ["buffering", "loading", "recovering"].includes(this.snapshot.phase)
      ) {
        clearTimeout(this.stallTimer);
        this.publish("playing");
      }
    });
    this.listen("ended", () => this.publish("ended"));
    this.listen("error", () => void this.recover());
    // Resume where you left off, once the length is known. Some servers report it late,
    // so the first of several events that can do it wins.
    let resumed = startAt <= 0;
    const resume = () => {
      if (resumed || !Number.isFinite(this.video.duration)) return;
      resumed = true;
      if (startAt < this.video.duration - 10) this.video.currentTime = startAt;
    };
    for (const event of ["loadedmetadata", "durationchange", "canplay"])
      this.listen(event, resume);
    const start = async () => {
      if (generation !== this.generation) return;
      if (this.hold) {
        this.hold = false;
        clearTimeout(this.stallTimer);
        this.publish("paused", "Ready where you left off. Press play.");
        return;
      }
      try {
        await this.video.play();
      } catch (error) {
        if (generation !== this.generation) return;
        clearTimeout(this.stallTimer);
        if (error instanceof DOMException && error.name === "NotAllowedError")
          this.publish("paused", "Press play to start watching.");
        else void this.recover();
      }
    };
    watchdog();
    // Safari's native HLS supports OS-level media controls, AirPlay and subtitles.
    if (
      stream.format === "hls" &&
      !this.video.canPlayType("application/vnd.apple.mpegurl")
    ) {
      try {
        const { default: HlsClass } = await import("hls.js");
        if (generation !== this.generation) return;
        if (!HlsClass.isSupported()) {
          clearTimeout(this.stallTimer);
          this.publish(
            "error",
            "HLS playback is not supported in this browser. Try Safari, Chrome, Firefox, or Edge.",
          );
          return;
        }
        const hls = new HlsClass({
          lowLatencyMode: url === mediaUrl(stream.url),
          manifestLoadingMaxRetry: 1,
          levelLoadingMaxRetry: 1,
          fragLoadingMaxRetry: 1,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          maxBufferSize: 40_000_000,
          backBufferLength: 30,
          capLevelToPlayerSize: true,
        });
        this.hls = hls;
        logMedia("audio", "decode path: hls.js (MediaSource)");
        // What the playlist lists, before hls.js drops anything it cannot play.
        let listed: AudioTrackInfo[] = [];
        hls.on(HlsClass.Events.MANIFEST_LOADED, (_, data) => {
          if (generation !== this.generation) return;
          listed = data.audioTracks.length
            ? data.audioTracks.map(trackInfo)
            : unique(data.levels.map((l) => l.audioCodec)).map((codec, id) => ({
                id,
                codec,
              }));
          logMedia(
            "audio",
            `listed: ${listed.map((t) => describeTrack(t)).join("; ") || "no audio codecs named"}`,
          );
        });
        hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
          if (generation !== this.generation) return;
          // Audio muxed into the video (no separate renditions): only its codec can be checked.
          if (!hls.audioTracks.length && listed.length) {
            const choice = this.choose(listed);
            if (choice.id === null) {
              void this.audioUnplayable(choice.undecodable, stream, generation);
              return;
            }
            this.showAudio(
              listed.filter((t) => t.id === choice.id),
              choice,
            );
          }
          this.snapshot.quality = [
            { id: -1, label: "Auto" },
            ...hls.levels.map((level, id) => ({
              id,
              label: level.height
                ? `${level.height}p`
                : `${Math.round(level.bitrate / 1000)} kbps`,
            })),
          ];
          this.notify({ ...this.snapshot });
          void start();
        });
        hls.on(HlsClass.Events.AUDIO_TRACKS_UPDATED, () => {
          if (generation !== this.generation) return;
          const tracks = hls.audioTracks.map(trackInfo);
          if (!tracks.length) return;
          const choice = this.choose(tracks);
          if (choice.id === null) {
            void this.audioUnplayable(choice.undecodable, stream, generation);
            return;
          }
          if (hls.audioTrack !== choice.id) hls.audioTrack = choice.id;
          this.showAudio(tracks, choice);
        });
        hls.on(HlsClass.Events.SUBTITLE_TRACKS_UPDATED, () => {
          if (generation !== this.generation) return;
          this.snapshot.subtitles = hls.subtitleTracks.map((track, id) => ({
            id,
            label: track.name || track.lang || `Subtitles ${id + 1}`,
          }));
          this.notify({ ...this.snapshot });
        });
        hls.on(HlsClass.Events.ERROR, (_, data) => {
          if (generation !== this.generation) return;
          // A playlist or buffer whose audio codec this device cannot decode.
          if (
            [
              HlsClass.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR,
              HlsClass.ErrorDetails.BUFFER_INCOMPATIBLE_CODECS_ERROR,
              HlsClass.ErrorDetails.BUFFER_ADD_CODEC_ERROR,
            ].includes(data.details)
          ) {
            const probe = deviceProbe(this.video);
            const named = /codecs="?([^"]+)"?/.exec(data.mimeType ?? "")?.[1];
            const codecs = unique([
              ...listed.map((t) => t.codec),
              ...(named?.split(",").map((c) => c.trim()) ?? []),
            ]).filter((c) => canDecode(c, probe) === "no");
            logMedia(
              "audio",
              `${data.details}: ${codecs.join(", ") || "codec unnamed"}`,
            );
            if (
              codecs.length &&
              (data.fatal || data.mimeType?.startsWith("audio"))
            ) {
              void this.audioUnplayable(
                unique(codecs.map(codecName)),
                stream,
                generation,
              );
              return;
            }
          }
          if (data.fatal) void this.recover();
        });
        hls.attachMedia(this.video);
        hls.loadSource(url);
      } catch {
        if (generation !== this.generation) return;
        this.teardown();
        diagnose("playback.engine-load-failed");
        this.publish(
          "error",
          "The playback engine could not load. Reconnect and retry, or reload Open TV.",
        );
      }
    } else {
      logMedia(
        "audio",
        `decode path: ${stream.format === "hls" ? "native HLS" : "progressive file"}`,
      );
      this.listen("loadedmetadata", () => this.readElementTracks());
      this.video.src = url;
      void start();
    }
  }
  private choose(tracks: AudioTrackInfo[]): AudioChoice {
    let remembered;
    try {
      if (this.item) remembered = readAudioChoice(localStorage, this.item.id);
    } catch {
      /* No storage, no memory. */
    }
    const languages =
      typeof navigator === "undefined"
        ? []
        : navigator.languages?.length
          ? navigator.languages
          : [navigator.language];
    const choice = chooseAudioTrack(tracks, {
      languages,
      probe: deviceProbe(this.video),
      remembered,
    });
    const tried = tracks
      .map((t) => describeTrack(t, choice.decodable[t.id]))
      .join("; ");
    logMedia(
      "audio",
      `tracks: ${tried}; ${choice.id === null ? "none decodable" : `chose track ${choice.id + 1}`}${choice.fallback ? " (fallback)" : ""}`,
    );
    return choice;
  }
  private showAudio(tracks: AudioTrackInfo[], choice: AudioChoice) {
    this.audioTracks = tracks;
    this.snapshot = {
      ...this.snapshot,
      audio: tracks.map((t) => ({
        id: t.id,
        label: describeTrack(t, choice.decodable[t.id]),
      })),
      audioId: choice.id ?? undefined,
      audioNote: this.audioNote ?? choice.fallback,
    };
    if (!this.disposed) this.notify({ ...this.snapshot });
  }
  // A file's own tracks, where the browser lists them (it does not name their codecs).
  private readElementTracks() {
    const list = (this.video as MediaWithCounters).audioTracks;
    if (!list?.length) return;
    const tracks: AudioTrackInfo[] = Array.from(list, (t, id) => ({
      id,
      lang: t.language || undefined,
      name: t.label || undefined,
      default: t.enabled,
    }));
    const choice = this.choose(tracks);
    if (choice.id !== null && tracks.length > 1)
      Array.from(list).forEach((t, i) => (t.enabled = i === choice.id));
    this.showAudio(tracks, choice);
  }
  // A few seconds of moving picture with no audio decoded at all is almost always a file
  // whose audio codec (AC-3, E-AC-3, DTS) this device cannot decode.
  private watchSilence(stream: Stream) {
    if (stream.format === "audio" || this.item?.type === "radio") return;
    const video = this.video as MediaWithCounters;
    let from = -1,
      checked = false;
    this.listen("timeupdate", () => {
      if (checked || video.paused) return;
      if (from < 0) from = video.currentTime;
      if (video.currentTime - from < 3 || !video.videoWidth) return;
      checked = true;
      const silent =
        video.mozHasAudio === false ||
        (video.webkitAudioDecodedByteCount === 0 &&
          (video.webkitVideoDecodedByteCount ?? 0) > 0);
      if (!silent || video.audioTracks?.length === 0) return;
      logMedia("audio", "picture decoding, no audio decoded");
      this.snapshot = { ...this.snapshot, silentAudio: true };
      this.notify({ ...this.snapshot });
    });
  }
  // No track can be decoded here: ask a converting server for AAC, or say so plainly.
  private async audioUnplayable(
    codecs: string[],
    stream: Stream,
    generation: number,
  ) {
    if (generation !== this.generation) return;
    const converted = this.converted.has(this.index)
      ? null
      : transcodeAudioUrl(stream.url);
    const names = codecs.join(", ") || "its";
    if (converted) {
      this.converted.add(this.index);
      logMedia("audio", `asking the server to convert ${names} audio to AAC`);
      this.audioNote = `The server converts this title's ${names} audio to AAC for this device.`;
      await this.attach(
        { ...stream, url: converted, format: "hls" },
        this.video.currentTime > 0 ? this.video.currentTime : this.startAt,
      );
      return;
    }
    logMedia("audio", `cannot play ${names} audio here`);
    this.teardown();
    this.publish("error", undecodableMessage(codecs));
  }
  private async recover() {
    if (
      this.recovering ||
      !this.item ||
      this.snapshot.phase === "error" ||
      this.disposed
    )
      return;
    this.recovering = true;
    clearTimeout(this.stallTimer);
    const position =
      Number.isFinite(this.video.currentTime) && this.video.currentTime > 0
        ? this.video.currentTime
        : this.startAt;
    // A single initial retry, then an authorized alternative of this same item.
    // The budget belongs to the explicit user play, never to attach/channel changes.
    // A route that failed is forgotten, so the retry resolves again from the start
    // (and may find another one) instead of reusing it.
    const stream = this.item.streams[this.index];
    if (this.resolution && this.resolution.route !== "direct" && stream)
      this.resolveUrl?.invalidate?.(stream.url);
    if (this.budget.attempts === 0 && this.budget.retry()) {
      this.publish("recovering", "Reconnecting to the stream…");
      diagnose("playback.retry");
      await this.attach(this.item.streams[this.index], position);
      return;
    }
    const alternative = this.budget.alternative(this.item.streams.length);
    if (alternative !== null) {
      this.index = alternative;
      this.publish("recovering", "Trying an alternative stream…");
      await this.attach(this.item.streams[alternative], position);
      return;
    }
    this.teardown();
    diagnose("playback.unavailable");
    this.publish(
      "error",
      this.failure ??
        "This stream is unavailable or restricted in your region. Retry, choose another title, or check the source.",
    );
  }
  // After a failure: the same title from its next listed source, with a fresh budget.
  // Returns the source now playing (0-based), or null when there is no other.
  async nextSource(): Promise<number | null> {
    if (!this.item || this.item.streams.length < 2) return null;
    this.disposed = false;
    this.budget = new RecoveryBudget(2);
    this.failure = undefined;
    this.index = (this.index + 1) % this.item.streams.length;
    this.audioNote = undefined;
    this.snapshot = { phase: "loading", quality: [], audio: [], subtitles: [] };
    this.publish("loading");
    await this.attach(this.item.streams[this.index], 0);
    return this.index;
  }
  setQuality(id: number) {
    if (this.hls) this.hls.currentLevel = id;
  }
  setAudio(id: number) {
    const track = this.audioTracks.find((t) => t.id === id);
    if (!track) return;
    if (this.hls?.audioTracks.length) this.hls.audioTrack = id;
    const list = (this.video as MediaWithCounters).audioTracks;
    if (!this.hls && list && list.length > 1)
      Array.from(list).forEach((t, i) => (t.enabled = i === id));
    this.snapshot = { ...this.snapshot, audioId: id };
    this.notify({ ...this.snapshot });
    logMedia("audio", `viewer chose ${describeTrack(track)}`);
    try {
      if (this.item)
        saveAudioChoice(localStorage, this.item.id, {
          lang: track.lang,
          codec: track.codec,
          name: track.name,
        });
    } catch {
      /* Not remembered. */
    }
  }
  setSubtitles(id: number) {
    if (this.hls) {
      this.hls.subtitleTrack = id;
      this.hls.subtitleDisplay = id >= 0;
    }
  }
  stop() {
    this.generation++;
    this.item = null;
    this.teardown();
    this.publish("idle");
  }
  destroy() {
    this.stop();
    this.disposed = true;
  }
}
