// Talking to a page inside a cross-origin frame.
//
// The only channel across that boundary is postMessage, there is no standard for a player's
// messages, and the frame's keyboard events never reach us. So the bridge speaks one clean
// protocol and understands three older shapes:
//
//   opentv    { opentv: 1, type: ... }                      this app's protocol (SERVER_CONTRACT.md)
//   legacy    { source: "opentv", type: ... }               the first version of it
//   playerjs  Player.js events and methods                  many embeddable players already speak it
//   events    { type: "PLAYER_EVENT", data: { event } }     one-way progress only (no control)
//
// Everything arriving is untrusted: parseBridgeMessage returns a small closed shape or null.

export type BridgeKind = "opentv" | "legacy" | "playerjs" | "events";
export type KeyName = "back" | "menu" | "up" | "down" | "left" | "right" | "ok";
const KEYS: KeyName[] = ["back", "menu", "up", "down", "left", "right", "ok"];

export interface Caps {
  seek: boolean;
  volume: boolean;
  mute: boolean;
}
export interface BridgeState {
  kind: BridgeKind | null;
  ready: boolean;
  playing: boolean;
  buffering: boolean;
  ended: boolean;
  time: number;
  duration: number;
  volume: number; // 0..1
  muted: boolean;
  caps: Caps;
  error: string;
}
const NO_CAPS: Caps = { seek: false, volume: false, mute: false };
export const emptyBridge: BridgeState = {
  kind: null,
  ready: false,
  playing: false,
  buffering: false,
  ended: false,
  time: 0,
  duration: 0,
  volume: 1,
  muted: false,
  caps: NO_CAPS,
  error: "",
};

export type BridgeEvent =
  | { k: "ready"; kind: BridgeKind; caps?: Caps }
  | {
      k: "state";
      kind: BridgeKind;
      playing?: boolean;
      buffering?: boolean;
      time?: number;
      duration?: number;
      volume?: number;
      muted?: boolean;
    }
  | { k: "ended"; kind: BridgeKind }
  | { k: "error"; kind: BridgeKind; message: string }
  | { k: "key"; key: KeyName };

const finite = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
const bool = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : undefined;
const msg = (v: unknown) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").slice(0, 160) : "";
function asObject(data: unknown): Record<string, unknown> | null {
  if (typeof data === "string") {
    if (data.length > 20000 || data.charAt(0) !== "{") return null;
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

const GENERIC: Record<string, "ready" | "play" | "pause" | "ended" | "time" | "error"> = {
  ready: "ready",
  loaded: "ready",
  play: "play",
  playing: "play",
  pause: "pause",
  paused: "pause",
  ended: "ended",
  complete: "ended",
  timeupdate: "time",
  seeked: "time",
  progress: "time",
  error: "error",
};
const FULL: Caps = { seek: true, volume: true, mute: true };

export function parseBridgeMessage(data: unknown): BridgeEvent | null {
  const m = asObject(data);
  if (!m) return null;

  if (m.opentv === 1) {
    switch (m.type) {
      case "ready": {
        const c = (m.caps ?? {}) as Record<string, unknown>;
        return {
          k: "ready",
          kind: "opentv",
          caps: { seek: c.seek === true, volume: c.volume === true, mute: c.mute === true },
        };
      }
      case "state":
        return {
          k: "state",
          kind: "opentv",
          playing: bool(m.playing),
          buffering: bool(m.buffering),
          time: finite(m.time),
          duration: finite(m.duration),
          volume: finite(m.volume) === undefined ? undefined : Math.min(1, finite(m.volume)!),
          muted: bool(m.muted),
        };
      case "ended":
        return { k: "ended", kind: "opentv" };
      case "error":
        return { k: "error", kind: "opentv", message: msg(m.message) || msg(m.code) || "error" };
      case "key":
        return KEYS.includes(m.key as KeyName) ? { k: "key", key: m.key as KeyName } : null;
      default:
        return null;
    }
  }

  if (m.source === "opentv") {
    switch (m.type) {
      case "ready":
        return { k: "ready", kind: "legacy", caps: FULL };
      case "playing":
      case "play":
        return { k: "state", kind: "legacy", playing: true };
      case "pause":
        return { k: "state", kind: "legacy", playing: false };
      case "ended":
        return { k: "ended", kind: "legacy" };
      case "timeupdate":
        return { k: "state", kind: "legacy", time: finite(m.time), duration: finite(m.duration) };
      case "mute":
        return { k: "state", kind: "legacy", muted: m.muted === true };
      case "error":
      case "unavailable":
        return { k: "error", kind: "legacy", message: msg(m.message) || "unavailable" };
      default:
        return null;
    }
  }

  if (m.context === "player.js") {
    const kind = GENERIC[String(m.event)];
    if (!kind) return null;
    const value = (m.value ?? {}) as Record<string, unknown>;
    return fromGeneric("playerjs", kind, finite(value.seconds), finite(value.duration), msg(value.msg));
  }

  const inner = (m.type === "PLAYER_EVENT" && asObject(m.data)) || m;
  const kind = GENERIC[String(inner.event)];
  if (!kind) return null;
  const time = finite(inner.currentTime ?? inner.time ?? inner.seconds);
  if (kind === "time" && time === undefined) return null;
  return fromGeneric("events", kind, time, finite(inner.duration), "");
}

function fromGeneric(
  kind: BridgeKind,
  what: "ready" | "play" | "pause" | "ended" | "time" | "error",
  time: number | undefined,
  duration: number | undefined,
  message: string,
): BridgeEvent {
  switch (what) {
    case "ready":
      return { k: "ready", kind, caps: kind === "playerjs" ? FULL : NO_CAPS };
    case "play":
      return { k: "state", kind, playing: true, time, duration };
    case "pause":
      return { k: "state", kind, playing: false, time, duration };
    case "ended":
      return { k: "ended", kind };
    case "time":
      return { k: "state", kind, time, duration };
    default:
      return { k: "error", kind, message: message || "error" };
  }
}

export function reduceBridge(state: BridgeState, ev: BridgeEvent): BridgeState {
  if (ev.k === "key") return state;
  const kind = state.kind ?? ev.kind;
  const base = { ...state, kind };
  switch (ev.k) {
    case "ready":
      return { ...base, ready: true, caps: ev.caps ?? state.caps, error: "" };
    case "ended":
      return { ...base, ready: true, playing: false, ended: true };
    case "error":
      return { ...base, error: ev.message };
    case "state": {
      const time = ev.time ?? state.time;
      // Time creeping forward means it is playing even if no "play" was ever sent; a big
      // jump is a seek and says nothing.
      const creeping =
        ev.playing === undefined &&
        ev.time !== undefined &&
        ev.time > state.time &&
        ev.time - state.time <= 2.5;
      return {
        ...base,
        ready: true,
        playing: ev.playing ?? (creeping ? true : state.playing),
        buffering: ev.buffering ?? (ev.playing ? false : state.buffering),
        ended: ev.playing === true || (ev.time !== undefined && ev.time < state.time - 3) ? false : state.ended,
        time,
        duration: ev.duration ?? state.duration,
        volume: ev.volume ?? state.volume,
        muted: ev.muted ?? state.muted,
        error: "",
      };
    }
  }
}

// Commands from the app (TV or phone) to the frame.
export type BridgeCommand =
  | { c: "play" }
  | { c: "pause" }
  | { c: "toggle" }
  | { c: "seek"; to: number }
  | { c: "seekBy"; by: number }
  | { c: "mute"; on: boolean }
  | { c: "volume"; to: number };

export const hello = () => ({ opentv: 1, type: "hello" });

// A Player.js player only reports to a parent that asks for each event.
export const playerJsSubscriptions = () =>
  ["ready", "play", "pause", "ended", "timeupdate", "error"].map((event) => ({
    context: "player.js",
    version: "0.0.10",
    method: "addEventListener",
    value: event,
    listener: event,
  }));

export const canControl = (s: BridgeState) =>
  s.ready && (s.kind === "opentv" || s.kind === "legacy" || s.kind === "playerjs");

export function canDo(s: BridgeState, cmd: BridgeCommand): boolean {
  if (!canControl(s)) return false;
  switch (cmd.c) {
    case "seek":
    case "seekBy":
      return s.caps.seek;
    case "volume":
      return s.caps.volume;
    case "mute":
      return s.caps.mute;
    default:
      return true;
  }
}

// The message that asks the frame to do `cmd`, or null when this protocol cannot.
export function encodeCommand(s: BridgeState, cmd: BridgeCommand): unknown {
  if (!canDo(s, cmd)) return null;
  const clamp = (t: number) => Math.max(0, s.duration > 0 ? Math.min(t, s.duration) : t);
  const toggled = s.playing ? "pause" : "play";
  if (s.kind === "opentv") {
    switch (cmd.c) {
      case "seek":
        return { opentv: 1, type: "cmd", cmd: "seek", value: clamp(cmd.to) };
      case "seekBy":
        return { opentv: 1, type: "cmd", cmd: "seekBy", value: cmd.by };
      case "mute":
        return { opentv: 1, type: "cmd", cmd: cmd.on ? "mute" : "unmute" };
      case "volume":
        return { opentv: 1, type: "cmd", cmd: "volume", value: Math.max(0, Math.min(1, cmd.to)) };
      default:
        return { opentv: 1, type: "cmd", cmd: cmd.c };
    }
  }
  if (s.kind === "legacy") {
    const action = (a: string, value?: number) => ({
      source: "opentv-host",
      type: "command",
      action: a,
      ...(value === undefined ? {} : { value }),
    });
    switch (cmd.c) {
      case "toggle":
        return action(toggled);
      case "seek":
        return action("seek", clamp(cmd.to));
      case "seekBy":
        return action("seek", clamp(s.time + cmd.by));
      case "mute":
        return action(cmd.on ? "mute" : "unmute");
      case "volume":
        return action("volume", Math.max(0, Math.min(1, cmd.to)));
      default:
        return action(cmd.c);
    }
  }
  if (s.kind === "playerjs") {
    const call = (method: string, value?: number) => ({
      context: "player.js",
      version: "0.0.10",
      method,
      ...(value === undefined ? {} : { value }),
    });
    switch (cmd.c) {
      case "toggle":
        return call(toggled);
      case "seek":
        return call("setCurrentTime", clamp(cmd.to));
      case "seekBy":
        return call("setCurrentTime", clamp(s.time + cmd.by));
      case "mute":
        return call(cmd.on ? "mute" : "unmute");
      case "volume":
        return call("setVolume", Math.round(Math.max(0, Math.min(1, cmd.to)) * 100));
      default:
        return call(cmd.c);
    }
  }
  return null;
}
