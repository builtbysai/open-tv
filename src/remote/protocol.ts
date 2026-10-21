// The control protocol between phones (controllers), the TV (the playback device) and the
// control relay. It carries control only: what to play and how, never media or guide
// bytes. The TV fetches every stream itself. Shared by the web app and the relay Worker,
// so it depends on nothing.

export const PROTOCOL = "opentv.v1";
export const MAX_MESSAGE = 256 * 1024;
export const CLAIM_LIFETIME = 10 * 60 * 1000;

// Close codes the relay uses; a client stops reconnecting on the first three.
export const CLOSE = {
  revoked: 4401,
  badSecret: 4403,
  badRequest: 4400,
  replaced: 4409,
} as const;

export type Classification = "general" | "adult" | "unknown";
export interface StreamRef {
  url: string;
  format: string;
  // How an embedded page is held back on the TV, as set for that server on the phone.
  guard?: "open" | "click" | "sandbox";
}
// Enough for the TV to play an item without having its source connected: the phone sends
// the stream addresses it already resolved.
export interface ItemRef {
  sourceId: string;
  itemId: string;
  type: string;
  title: string;
  subtitle?: string;
  artwork?: string;
  classification: Classification;
  streams: StreamRef[];
}
export type CommandName =
  | "play"
  | "pause"
  | "resume"
  | "seek"
  | "stop"
  | "next"
  | "previous"
  | "volume"
  | "adult";
export type Command =
  | { t: "play"; id: string; item: ItemRef; queue?: ItemRef[]; start?: number }
  | { t: "seek"; id: string; seconds: number }
  // One step up (1) or down (-1), or mute on/off (0).
  | { t: "volume"; id: string; step: -1 | 0 | 1 }
  // Show or hide 18+ content on the TV, from a phone that shows it itself. The TV
  // allows "show" only when its owner has let paired phones do that.
  | { t: "adult"; id: string; show: boolean }
  | { t: "pause" | "resume" | "stop" | "next" | "previous"; id: string };
// WebRTC signaling for a direct connection on the home network, relayed as is.
export interface Signal {
  kind: "offer" | "answer" | "candidate" | "bye";
  sdp?: string;
  candidate?: string;
  mid?: string | null;
  line?: number | null;
}
export type Phase =
  "idle" | "loading" | "playing" | "paused" | "buffering" | "ended" | "error";
export interface NowPlaying {
  phase: Phase;
  // Seconds, sampled at `at` (epoch ms). A controller moves it on while playing.
  position: number;
  duration: number;
  at: number;
  title: string;
  itemId?: string;
  artwork?: string;
  canSeek: boolean;
  canStep: boolean;
  // Whether the TV app is on screen (false when it runs in the background).
  visible?: boolean;
}
export interface Peer {
  id: string;
  name: string;
  online: boolean;
}

// From a client to the relay.
export type ControllerMessage =
  | Command
  | { t: "revoke" }
  | { t: "name"; name: string }
  | { t: "signal"; data: Signal };
export type TvMessage =
  | { t: "state"; state: NowPlaying }
  | { t: "ack"; id: string; to: string; ok: boolean; error?: string }
  | { t: "claim"; code: string }
  | { t: "revoke"; id: string }
  | { t: "name"; name: string }
  | { t: "signal"; to: string; data: Signal };

// From the relay to a client.
export type RelayMessage =
  | {
      t: "hello";
      role: "tv" | "controller";
      tvId: string;
      controllerId?: string;
    }
  | { t: "paired"; controllerId: string; token: string }
  | { t: "presence"; tv: boolean; tvName: string; controllers: Peer[] }
  | { t: "state"; state: NowPlaying }
  | { t: "ack"; id: string; ok: boolean; error?: string }
  // To the TV: from which phone; to a phone: from the TV.
  | { t: "signal"; from?: string; data: Signal }
  | (Command & { from: string });

const ID = /^[A-Za-z0-9_-]{8,64}$/;
export const validId = (value: unknown): value is string =>
  typeof value === "string" && ID.test(value);
const text = (value: unknown, max: number) =>
  typeof value === "string"
    ? value.replace(/[\p{Cc}]/gu, "").slice(0, max)
    : "";
const number = (value: unknown, max: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(value, max)
    : null;
const httpUrl = (value: unknown) => {
  if (typeof value !== "string" || value.length > 4000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
};
const WEEK = 7 * 24 * 3600;

export function parseItem(value: unknown): ItemRef | null {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return null;
  const sourceId = text(raw.sourceId, 200),
    itemId = text(raw.itemId, 400),
    title = text(raw.title, 200);
  if (!sourceId || !itemId || !title) return null;
  const streams: StreamRef[] = [];
  for (const entry of Array.isArray(raw.streams)
    ? raw.streams.slice(0, 6)
    : []) {
    const stream = entry as Record<string, unknown> | null;
    const url = httpUrl(stream?.url);
    const format = text(stream?.format, 20);
    const guard =
      stream?.guard === "open" || stream?.guard === "click"
        ? stream.guard
        : stream?.guard === "sandbox"
          ? "sandbox"
          : undefined;
    if (url && /^[a-z0-9-]+$/.test(format))
      streams.push({ url, format, ...(guard ? { guard } : {}) });
  }
  const artwork = httpUrl(raw.artwork) ?? undefined;
  const subtitle = text(raw.subtitle, 200) || undefined;
  return {
    sourceId,
    itemId,
    type: text(raw.type, 20) || "movie",
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(artwork ? { artwork } : {}),
    classification:
      raw.classification === "general" || raw.classification === "adult"
        ? raw.classification
        : "unknown",
    streams,
  };
}

export function parseCommand(raw: Record<string, unknown>): Command | null {
  if (!validId(raw.id)) return null;
  const id = raw.id;
  switch (raw.t) {
    case "play": {
      const item = parseItem(raw.item);
      if (!item) return null;
      const queue = Array.isArray(raw.queue)
        ? raw.queue
            .slice(0, 300)
            .map(parseItem)
            .filter((i): i is ItemRef => !!i)
        : undefined;
      const start = number(raw.start, WEEK);
      return {
        t: "play",
        id,
        item,
        ...(queue?.length ? { queue } : {}),
        ...(start ? { start } : {}),
      };
    }
    case "seek": {
      const seconds = number(raw.seconds, WEEK);
      return seconds === null ? null : { t: "seek", id, seconds };
    }
    case "volume":
      return raw.step === 1 || raw.step === -1 || raw.step === 0
        ? { t: "volume", id, step: raw.step }
        : null;
    case "adult":
      return typeof raw.show === "boolean"
        ? { t: "adult", id, show: raw.show }
        : null;
    case "pause":
    case "resume":
    case "stop":
    case "next":
    case "previous":
      return { t: raw.t, id };
    default:
      return null;
  }
}

const PHASES: Phase[] = [
  "idle",
  "loading",
  "playing",
  "paused",
  "buffering",
  "ended",
  "error",
];
export function parseState(value: unknown): NowPlaying | null {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || !PHASES.includes(raw.phase as Phase))
    return null;
  const artwork = httpUrl(raw.artwork) ?? undefined;
  const itemId = text(raw.itemId, 400) || undefined;
  return {
    phase: raw.phase as Phase,
    position: number(raw.position, WEEK) ?? 0,
    duration: number(raw.duration, WEEK) ?? 0,
    at: number(raw.at, 1e13) ?? 0,
    title: text(raw.title, 200),
    ...(itemId ? { itemId } : {}),
    ...(artwork ? { artwork } : {}),
    canSeek: raw.canSeek === true,
    canStep: raw.canStep === true,
    ...(typeof raw.visible === "boolean" ? { visible: raw.visible } : {}),
  };
}

function json(data: string): Record<string, unknown> | null {
  if (data.length > MAX_MESSAGE) return null;
  try {
    const value = JSON.parse(data);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function parseSignal(value: unknown): Signal | null {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return null;
  if (!["offer", "answer", "candidate", "bye"].includes(raw.kind as string))
    return null;
  const sdp = typeof raw.sdp === "string" ? raw.sdp : undefined;
  const candidate =
    typeof raw.candidate === "string" ? raw.candidate : undefined;
  if ((sdp?.length ?? 0) > 16000 || (candidate?.length ?? 0) > 2000)
    return null;
  return {
    kind: raw.kind as Signal["kind"],
    ...(sdp !== undefined ? { sdp } : {}),
    ...(candidate !== undefined ? { candidate } : {}),
    ...(typeof raw.mid === "string" || raw.mid === null
      ? { mid: raw.mid as string | null }
      : {}),
    ...(typeof raw.line === "number" || raw.line === null
      ? { line: raw.line as number | null }
      : {}),
  };
}

export function parseControllerMessage(data: string): ControllerMessage | null {
  const raw = json(data);
  if (!raw) return null;
  if (raw.t === "revoke") return { t: "revoke" };
  if (raw.t === "signal") {
    const data = parseSignal(raw.data);
    return data ? { t: "signal", data } : null;
  }
  if (raw.t === "name") {
    const name = text(raw.name, 60).trim();
    return name ? { t: "name", name } : null;
  }
  return parseCommand(raw);
}

export function parseTvMessage(data: string): TvMessage | null {
  const raw = json(data);
  if (!raw) return null;
  switch (raw.t) {
    case "state": {
      const state = parseState(raw.state);
      return state ? { t: "state", state } : null;
    }
    case "ack":
      return validId(raw.id) && validId(raw.to)
        ? {
            t: "ack",
            id: raw.id,
            to: raw.to,
            ok: raw.ok === true,
            ...(raw.error ? { error: text(raw.error, 200) } : {}),
          }
        : null;
    case "claim":
      return validId(raw.code) ? { t: "claim", code: raw.code } : null;
    case "signal": {
      const data = parseSignal(raw.data);
      return data && validId(raw.to) ? { t: "signal", to: raw.to, data } : null;
    }
    case "revoke":
      return raw.id === "*" || validId(raw.id)
        ? { t: "revoke", id: raw.id as string }
        : null;
    case "name": {
      const name = text(raw.name, 60).trim();
      return name ? { t: "name", name } : null;
    }
    default:
      return null;
  }
}

// What a client asks for in the WebSocket subprotocol list, so secrets never sit in a URL.
export const credential = {
  tv: (secret: string) => `otv-tv.${secret}`,
  controller: (id: string, token: string) => `otv-ctl.${id}.${token}`,
  claim: (code: string) => `otv-claim.${code}`,
};
export type Credential =
  | { kind: "tv"; secret: string }
  | { kind: "controller"; id: string; token: string }
  | { kind: "claim"; code: string };
export function parseCredential(header: string | null): Credential | null {
  const offered = (header ?? "").split(",").map((p) => p.trim());
  if (!offered.includes(PROTOCOL)) return null;
  for (const entry of offered) {
    const [kind, a, b, ...rest] = entry.split(".");
    if (rest.length) continue;
    if (kind === "otv-tv" && validId(a) && b === undefined)
      return { kind: "tv", secret: a };
    if (kind === "otv-ctl" && validId(a) && validId(b))
      return { kind: "controller", id: a, token: b };
    if (kind === "otv-claim" && validId(a) && b === undefined)
      return { kind: "claim", code: a };
  }
  return null;
}
