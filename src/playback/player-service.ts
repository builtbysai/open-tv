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
export interface Track {
  id: number;
  label: string;
}
export interface PlaybackSnapshot {
  phase: PlaybackPhase;
  message?: string;
  // How the stream reached the player (direct, its HTTPS version, the TV app, the relay).
  route?: Route;
  quality: Track[];
  audio: Track[];
  subtitles: Track[];
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
    this.snapshot = { ...this.snapshot, quality: [], audio: [], subtitles: [] };
    this.publish("loading");
    const watchdog = () => {
      clearTimeout(this.stallTimer);
      this.stallTimer = setTimeout(() => void this.recover(), 20000);
    };
    this.listen("playing", () => {
      clearTimeout(this.stallTimer);
      this.publish("playing");
    });
    this.listen("pause", () => {
      clearTimeout(this.stallTimer);
      if (!this.video.ended) this.publish("paused");
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
        hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
          if (generation !== this.generation) return;
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
          this.snapshot.audio = hls.audioTracks.map((track, id) => ({
            id,
            label: track.name || track.lang || `Audio ${id + 1}`,
          }));
          this.notify({ ...this.snapshot });
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
          if (data.fatal && generation === this.generation) void this.recover();
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
      this.video.src = url;
      void start();
    }
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
    this.snapshot = { phase: "loading", quality: [], audio: [], subtitles: [] };
    this.publish("loading");
    await this.attach(this.item.streams[this.index], 0);
    return this.index;
  }
  setQuality(id: number) {
    if (this.hls) this.hls.currentLevel = id;
  }
  setAudio(id: number) {
    if (this.hls) this.hls.audioTrack = id;
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
