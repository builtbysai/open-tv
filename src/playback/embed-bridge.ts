// Talking to an embedded server player. A frame from another site can only be reached by
// postMessage, and there is no standard for it, so the bridge understands the common
// shapes and quietly does nothing for a server that says nothing:
//
//   "opentv"   our own small protocol (docs/SERVERS.md), which a cooperating server can speak
//   "playerjs" the Player.js protocol many players implement (events on request, plus methods)
//   "events"   one-way progress messages such as { type: "PLAYER_EVENT", data: { event, currentTime } }
//
// Sandboxing does not stop any of this: messages cross the frame boundary either way.
export type EmbedProtocol = "opentv" | "playerjs" | "events";
export interface EmbedState {
  protocol: EmbedProtocol | null;
  ready: boolean;
  playing: boolean;
  ended: boolean;
  time: number;
  duration: number;
  muted: boolean;
}
export const emptyEmbedState: EmbedState = {
  protocol: null,
  ready: false,
  playing: false,
  ended: false,
  time: 0,
  duration: 0,
  muted: false,
};
export interface EmbedEvent {
  protocol: EmbedProtocol;
  kind: "ready" | "play" | "pause" | "ended" | "time" | "error" | "mute";
  time?: number;
  duration?: number;
  muted?: boolean;
  message?: string;
}
const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
const asObject = (data: unknown): Record<string, unknown> | null => {
  if (typeof data === "string") {
    if (data.length > 20000 || !data.startsWith("{")) return null;
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
};
const GENERIC_EVENTS: Record<string, EmbedEvent["kind"]> = {
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

// Reads one message from a frame. Returns null for anything it does not understand.
export function parseEmbedMessage(data: unknown): EmbedEvent | null {
  const m = asObject(data);
  if (!m) return null;
  if (m.source === "opentv") {
    const type = String(m.type);
    if (type === "ready") return { protocol: "opentv", kind: "ready" };
    if (type === "playing" || type === "play")
      return { protocol: "opentv", kind: "play" };
    if (type === "pause") return { protocol: "opentv", kind: "pause" };
    if (type === "ended") return { protocol: "opentv", kind: "ended" };
    if (type === "timeupdate")
      return {
        protocol: "opentv",
        kind: "time",
        time: finite(m.time),
        duration: finite(m.duration),
      };
    if (type === "mute")
      return { protocol: "opentv", kind: "mute", muted: m.muted === true };
    if (type === "error" || type === "unavailable")
      return {
        protocol: "opentv",
        kind: "error",
        message:
          typeof m.message === "string" ? m.message.slice(0, 160) : undefined,
      };
    return null;
  }
  if (m.context === "player.js") {
    const kind = GENERIC_EVENTS[String(m.event)];
    if (!kind) return null;
    const value = (m.value ?? {}) as Record<string, unknown>;
    return {
      protocol: "playerjs",
      kind,
      time: finite(value.seconds),
      duration: finite(value.duration),
      message:
        kind === "error" ? String(value.msg ?? "").slice(0, 160) : undefined,
    };
  }
  // { type: "PLAYER_EVENT", data: { event: "timeupdate", currentTime, duration } }
  const inner = (m.type === "PLAYER_EVENT" && asObject(m.data)) || m;
  const kind = GENERIC_EVENTS[String(inner.event)];
  if (kind) {
    const time = finite(inner.currentTime ?? inner.time ?? inner.seconds);
    if (kind === "time" && time === undefined) return null;
    return {
      protocol: "events",
      kind,
      time,
      duration: finite(inner.duration),
    };
  }
  return null;
}
export function reduceEmbed(state: EmbedState, event: EmbedEvent): EmbedState {
  const next = { ...state, protocol: state.protocol ?? event.protocol };
  switch (event.kind) {
    case "ready":
      return { ...next, ready: true };
    case "play":
      return { ...next, ready: true, playing: true, ended: false };
    case "pause":
      return { ...next, playing: false };
    case "ended":
      return { ...next, playing: false, ended: true };
    case "time":
      return {
        ...next,
        ready: true,
        // Time creeping forward means it is playing, even if no "play" was ever sent (a big
        // jump is a seek, and says nothing).
        playing:
          event.time !== undefined &&
          event.time > state.time &&
          event.time - state.time <= 2.5
            ? true
            : state.playing,
        ended: false,
        time: event.time ?? state.time,
        duration: event.duration ?? state.duration,
      };
    case "mute":
      return { ...next, muted: event.muted === true };
    default:
      return next;
  }
}

export type EmbedAction =
  "play" | "pause" | "seek" | "mute" | "unmute" | "volume";
// The message that asks a player to do something, or null when this protocol cannot.
export function embedCommand(
  protocol: EmbedProtocol | null,
  action: EmbedAction,
  value?: number,
): unknown {
  if (protocol === "opentv")
    return { source: "opentv-host", type: "command", action, value };
  if (protocol === "playerjs") {
    const method =
      action === "seek"
        ? "setCurrentTime"
        : action === "volume"
          ? "setVolume"
          : action;
    return {
      context: "player.js",
      version: "0.0.10",
      method,
      ...(value === undefined
        ? {}
        : { value: action === "volume" ? Math.round(value * 100) : value }),
    };
  }
  return null;
}
// What to say to a player.js frame so it reports back. It sends events only to a parent
// that asks for each one.
export const PLAYERJS_EVENTS = [
  "ready",
  "play",
  "pause",
  "ended",
  "timeupdate",
  "error",
];
export const playerJsSubscriptions = () =>
  PLAYERJS_EVENTS.map((event) => ({
    context: "player.js",
    version: "0.0.10",
    method: "addEventListener",
    value: event,
    listener: event,
  }));
export const canControl = (protocol: EmbedProtocol | null) =>
  protocol === "opentv" || protocol === "playerjs";
