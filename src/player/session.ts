import { computed, signal } from "@preact/signals";
import type { MediaRef, PlaySource } from "../core/module";
import { emptyBridge, type BridgeCommand, type BridgeState } from "./bridge";
import type { Phase } from "../remote/protocol";

// What a renderer (the embed frame today, a native video later) gives the session so the
// rest of the app can drive it without knowing which kind it is.
export interface PlayerApi {
  send(cmd: BridgeCommand): boolean;
  focus(): void; // give the picture the keyboard
  blur(): void; // take it back for our own overlay
}

// loading: waiting for the frame. live: it answered (or loaded and may simply be silent).
// silent: loaded but never spoke the bridge, so it cannot be controlled. failed: it never
// came up, or the server said it has no such title.
export type Status = "idle" | "loading" | "live" | "silent" | "failed" | "ended";

export interface SessionDeps {
  resolve(ref: MediaRef, start: number): PlaySource[];
  next(ref: MediaRef): Promise<MediaRef | null>;
  onProgress(ref: MediaRef, time: number, duration: number): void;
  // Playback reached the end. `next` is what plays after it, if anything.
  onEnded(ref: MediaRef, next: MediaRef | null): void;
}

// One playback, from "play this title" to "stopped". The TV runs one for the big screen; the
// phone runs one when you watch on the phone itself. UI and remote commands both go through it.
export class PlaybackSession {
  ref = signal<MediaRef | null>(null);
  sources = signal<PlaySource[]>([]);
  index = signal(0);
  status = signal<Status>("idle");
  state = signal<BridgeState>(emptyBridge);
  // Remounts the renderer (a retry, or the next server) so a stale frame is never reused.
  nonce = signal(0);
  upNext = signal<MediaRef | null>(null);
  hasNext = signal(false);
  failure = signal("");
  startAt = 0;

  current = computed(() => this.sources.value[this.index.value] ?? null);
  // The phase the remote shows.
  phase = computed<Phase>(() => {
    if (!this.ref.value) return "idle";
    switch (this.status.value) {
      case "loading":
        return "loading";
      case "failed":
        return "error";
      case "ended":
        return "ended";
      case "idle":
        return "idle";
    }
    const s = this.state.value;
    if (s.ended) return "ended";
    if (s.buffering) return "buffering";
    // Without a bridge we cannot know: a frame that loaded is assumed to be playing.
    return s.ready && !s.playing ? "paused" : "playing";
  });

  private api: PlayerApi | null = null;
  private nextRef: MediaRef | null = null;
  private lastSave = 0;
  private serial = 0;

  constructor(private deps: SessionDeps) {
    this.state.subscribe((s) => {
      const ref = this.ref.value;
      if (!ref) return;
      if (s.ended && this.status.value !== "ended") {
        this.status.value = "ended";
        this.deps.onEnded(ref, this.nextRef);
        if (this.nextRef) this.upNext.value = this.nextRef;
      } else if (s.time > 5 && s.playing && Date.now() - this.lastSave > 10_000) {
        this.lastSave = Date.now();
        this.deps.onProgress(ref, s.time, s.duration);
      }
    });
  }

  attach(api: PlayerApi | null) {
    this.api = api;
  }
  setStatus(status: Status, failure = "") {
    // A late "silent" must not undo a frame that has already answered.
    if (status === "silent" && this.status.value === "live") return;
    this.status.value = status;
    this.failure.value = failure;
  }
  setState(state: BridgeState) {
    this.state.value = state;
  }

  play(ref: MediaRef, start = 0) {
    const mine = ++this.serial;
    this.finishCurrent();
    this.ref.value = ref;
    this.startAt = start;
    this.state.value = emptyBridge;
    this.upNext.value = null;
    this.nextRef = null;
    this.hasNext.value = false;
    this.index.value = 0;
    this.lastSave = Date.now();
    const sources = this.deps.resolve(ref, start);
    this.sources.value = sources;
    this.nonce.value++;
    if (!sources.length) this.setStatus("failed", "No server is set up for this title.");
    else this.setStatus("loading");
    void this.deps.next(ref).then(
      (next) => {
        if (mine !== this.serial) return;
        this.nextRef = next;
        this.hasNext.value = !!next;
      },
      () => {},
    );
  }

  // Saves where we got to, once, when leaving a title.
  private finishCurrent() {
    const ref = this.ref.value;
    const s = this.state.value;
    if (ref && s.time > 5 && this.status.value !== "ended") this.deps.onProgress(ref, s.time, s.duration);
  }

  stop() {
    this.serial++;
    this.finishCurrent();
    this.ref.value = null;
    this.sources.value = [];
    this.state.value = emptyBridge;
    this.upNext.value = null;
    this.hasNext.value = false;
    this.nextRef = null;
    this.status.value = "idle";
    this.api = null;
  }

  // Try the next server for the same title, from the start (or where we were).
  nextSource(): boolean {
    if (this.index.value + 1 >= this.sources.value.length) {
      this.setStatus("failed", "No other server has this title.");
      return false;
    }
    this.index.value++;
    this.state.value = emptyBridge;
    this.nonce.value++;
    this.setStatus("loading");
    return true;
  }
  select(id: string): boolean {
    const i = this.sources.value.findIndex((s) => s.id === id);
    if (i < 0) return false;
    this.index.value = i;
    this.state.value = emptyBridge;
    this.nonce.value++;
    this.setStatus("loading");
    return true;
  }
  retry() {
    this.state.value = emptyBridge;
    this.nonce.value++;
    this.setStatus("loading");
  }
  playNext(): boolean {
    const next = this.upNext.value ?? this.nextRef;
    if (!next) return false;
    this.play(next);
    return true;
  }
  cancelUpNext() {
    this.upNext.value = null;
  }

  // What the TV and phone can do with the current picture.
  caps = computed(() => {
    const s = this.state.value;
    const live = s.ready && (s.kind === "opentv" || s.kind === "legacy" || s.kind === "playerjs");
    return { seek: live && s.caps.seek, volume: live && s.caps.volume, mute: live && s.caps.mute, controlled: live };
  });

  command(cmd: BridgeCommand): boolean {
    return this.api?.send(cmd) ?? false;
  }
  focusPicture() {
    this.api?.focus();
  }
  releasePicture() {
    this.api?.blur();
  }
}
