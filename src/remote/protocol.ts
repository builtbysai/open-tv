// The control protocol between a TV, its paired phones and the relay. Shared by the app and
// the relay Worker, so it depends on nothing but the MediaRef validator.
//
// Control only: what to play and how. Media never passes through the relay, and neither does
// anything readable of the setup data: `sync` is end-to-end encrypted (see core/crypto.ts),
// so the relay forwards it without being able to read it. Commands carry an opaque MediaRef,
// so a new content module needs no protocol change.

import { parseRef, type MediaRef } from "../core/module";

export const PROTOCOL = "opentv.v2";
export const MAX_MESSAGE = 256 * 1024;
export const CLAIM_LIFETIME = 10 * 60 * 1000;
export const MAX_CONTROLLERS = 10;

// Close codes the relay uses; a client stops reconnecting on the first three.
export const CLOSE = {
  revoked: 4401,
  badSecret: 4403,
  badRequest: 4400,
  replaced: 4409,
} as const;

export type NavKey = "up" | "down" | "left" | "right" | "ok" | "back" | "home" | "menu";
const NAV_KEYS: NavKey[] = ["up", "down", "left", "right", "ok", "back", "home", "menu"];
export type CtlAction =
  | "play"
  | "pause"
  | "toggle"
  | "stop"
  | "next"
  | "prev"
  | "mute"
  | "unmute"
  | "volUp"
  | "volDown"
  | "nextSource";
const CTL_ACTIONS: CtlAction[] = [
  "play", "pause", "toggle", "stop", "next", "prev",
  "mute", "unmute", "volUp", "volDown", "nextSource",
];

export type Command =
  // Start a title on the TV; `start` is where to resume, in seconds.
  | { t: "play"; id: string; ref: MediaRef; start?: number }
  // Show a title's page on the TV without playing it.
  | { t: "open"; id: string; ref: MediaRef }
  | { t: "ctl"; id: string; a: CtlAction }
  // Absolute (`to`) or relative (`by`) seconds.
  | { t: "seek"; id: string; to?: number; by?: number }
  // The remote's D-pad, OK, Back and Home, exactly as a physical remote would press them.
  | { t: "nav"; id: string; key: NavKey }
  // Text typed on the phone into the TV's search box.
  | { t: "text"; id: string; value: string; submit?: boolean }
  // Play one specific source (server) of the current title.
  | { t: "source"; id: string; sid: string }
  // A tap in the middle of the picture, for a frame that has no bridge (Android host only).
  | { t: "tap"; id: string };

export type Phase = "idle" | "loading" | "playing" | "paused" | "buffering" | "ended" | "error";
export type Screen = "setup" | "idle" | "browse" | "details" | "player";
const PHASES: Phase[] = ["idle", "loading", "playing", "paused", "buffering", "ended", "error"];
const SCREENS: Screen[] = ["setup", "idle", "browse", "details", "player"];

export interface NowPlaying {
  screen: Screen;
  phase: Phase;
  title: string;
  subtitle?: string;
  ref?: MediaRef;
  // Seconds, sampled at `at` (epoch ms); a phone moves it on while playing.
  pos: number;
  dur: number;
  at: number;
  // What the TV can do with the current picture.
  caps: { seek: boolean; volume: boolean; mute: boolean; keys: boolean };
  muted: boolean;
  source?: { id: string; label: string; index: number; count: number };
  // The TV's search field has focus: the phone offers a box that types into it.
  typing: boolean;
  hasNext: boolean;
  ready: boolean;
}

export interface PeerInfo {
  id: string;
  name: string;
  online: boolean;
}

export interface Sealed {
  iv: string;
  ct: string;
}

// From a client to the relay.
export type ControllerMessage =
  | Command
  | { t: "revoke" }
  | { t: "name"; name: string }
  | ({ t: "sync" } & Sealed);
export type TvMessage =
  | { t: "state"; state: NowPlaying }
  | { t: "ack"; id: string; to: string; ok: boolean; error?: string }
  | { t: "claim"; code: string }
  | { t: "revoke"; id: string }
  | { t: "name"; name: string }
  // To one phone, or to every paired phone without `to`.
  | ({ t: "sync"; to?: string } & Sealed);

// From the relay to a client.
export type RelayMessage =
  | { t: "hello"; role: "tv" | "controller"; tvId: string; controllerId?: string }
  | { t: "paired"; controllerId: string; token: string }
  | { t: "presence"; tv: boolean; tvName: string; controllers: PeerInfo[] }
  | { t: "state"; state: NowPlaying }
  | { t: "ack"; id: string; ok: boolean; error?: string }
  | (Command & { from: string })
  | ({ t: "sync"; from?: string } & Sealed);

const ID = /^[A-Za-z0-9_-]{8,64}$/;
export const validId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : "";
const num = (v: unknown, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : null;
const WEEK = 7 * 24 * 3600;

export function parseCommand(raw: Record<string, unknown>): Command | null {
  if (!validId(raw.id)) return null;
  const id = raw.id;
  switch (raw.t) {
    case "play":
    case "open": {
      const ref = parseRef(raw.ref);
      if (!ref) return null;
      if (raw.t === "open") return { t: "open", id, ref };
      const start = num(raw.start, WEEK);
      return { t: "play", id, ref, ...(start ? { start } : {}) };
    }
    case "ctl":
      return CTL_ACTIONS.includes(raw.a as CtlAction) ? { t: "ctl", id, a: raw.a as CtlAction } : null;
    case "seek": {
      const to = num(raw.to, WEEK);
      const by = typeof raw.by === "number" && Number.isFinite(raw.by) ? Math.max(-WEEK, Math.min(WEEK, raw.by)) : null;
      if (to === null && by === null) return null;
      return { t: "seek", id, ...(to !== null ? { to } : {}), ...(by !== null ? { by } : {}) };
    }
    case "nav":
      return NAV_KEYS.includes(raw.key as NavKey) ? { t: "nav", id, key: raw.key as NavKey } : null;
    case "text":
      return typeof raw.value === "string"
        ? { t: "text", id, value: text(raw.value, 300), ...(raw.submit === true ? { submit: true } : {}) }
        : null;
    case "source":
      return typeof raw.sid === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(raw.sid)
        ? { t: "source", id, sid: raw.sid }
        : null;
    case "tap":
      return { t: "tap", id };
    default:
      return null;
  }
}

export function parseState(value: unknown): NowPlaying | null {
  const r = value as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  if (!PHASES.includes(r.phase as Phase) || !SCREENS.includes(r.screen as Screen)) return null;
  const caps = (r.caps ?? {}) as Record<string, unknown>;
  const ref = r.ref === undefined ? undefined : parseRef(r.ref) ?? undefined;
  const src = r.source as Record<string, unknown> | undefined;
  const source =
    src && typeof src === "object" && typeof src.id === "string"
      ? {
          id: text(src.id, 80),
          label: text(src.label, 60),
          index: num(src.index, 100) ?? 0,
          count: num(src.count, 100) ?? 0,
        }
      : undefined;
  return {
    screen: r.screen as Screen,
    phase: r.phase as Phase,
    title: text(r.title, 200),
    ...(r.subtitle ? { subtitle: text(r.subtitle, 200) } : {}),
    ...(ref ? { ref } : {}),
    pos: num(r.pos, WEEK) ?? 0,
    dur: num(r.dur, WEEK) ?? 0,
    at: num(r.at, 1e13) ?? 0,
    caps: { seek: caps.seek === true, volume: caps.volume === true, mute: caps.mute === true, keys: caps.keys === true },
    muted: r.muted === true,
    ...(source ? { source } : {}),
    typing: r.typing === true,
    hasNext: r.hasNext === true,
    ready: r.ready === true,
  };
}

function json(data: string): Record<string, unknown> | null {
  if (data.length > MAX_MESSAGE) return null;
  try {
    const v = JSON.parse(data);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
const sealed = (raw: Record<string, unknown>): Sealed | null =>
  typeof raw.iv === "string" && typeof raw.ct === "string" && raw.iv.length <= 64 && raw.ct.length <= 192 * 1024
    ? { iv: raw.iv, ct: raw.ct }
    : null;

export function parseControllerMessage(data: string): ControllerMessage | null {
  const raw = json(data);
  if (!raw) return null;
  if (raw.t === "revoke") return { t: "revoke" };
  if (raw.t === "sync") {
    const s = sealed(raw);
    return s ? { t: "sync", ...s } : null;
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
        ? { t: "ack", id: raw.id, to: raw.to, ok: raw.ok === true, ...(raw.error ? { error: text(raw.error, 200) } : {}) }
        : null;
    case "claim":
      return validId(raw.code) ? { t: "claim", code: raw.code } : null;
    case "revoke":
      return raw.id === "*" || validId(raw.id) ? { t: "revoke", id: raw.id as string } : null;
    case "name": {
      const name = text(raw.name, 60).trim();
      return name ? { t: "name", name } : null;
    }
    case "sync": {
      const s = sealed(raw);
      if (!s || (raw.to !== undefined && !validId(raw.to))) return null;
      return { t: "sync", ...s, ...(raw.to ? { to: raw.to as string } : {}) };
    }
    default:
      return null;
  }
}

// What a client offers in the WebSocket subprotocol list, so secrets never sit in a URL.
export const credential = {
  tv: (secret: string) => `otv-tv.${secret}`,
  controller: (id: string, token: string) => `otv-ctl.${id}.${token}`,
  claim: (code: string) => `otv-claim.${code}`,
};
export type Credential =
  | { kind: "tv"; secret: string }
  | { kind: "controller"; id: string; token: string }
  // A phone pairing again with the same TV also offers its old credential, so the relay
  // replaces that entry instead of listing the phone twice.
  | { kind: "claim"; code: string; replace?: { id: string; token: string } };

export function parseCredential(header: string | null): Credential | null {
  const offered = (header ?? "").split(",").map((p) => p.trim());
  if (!offered.includes(PROTOCOL)) return null;
  let found: Credential | null = null;
  let claim: string | null = null;
  for (const entry of offered) {
    const [kind, a, b, ...rest] = entry.split(".");
    if (rest.length) continue;
    if (kind === "otv-tv" && validId(a) && b === undefined) found = found ?? { kind: "tv", secret: a };
    if (kind === "otv-ctl" && validId(a) && validId(b)) found = found ?? { kind: "controller", id: a, token: b };
    if (kind === "otv-claim" && validId(a) && b === undefined) claim = claim ?? a;
  }
  if (claim)
    return {
      kind: "claim",
      code: claim,
      ...(found?.kind === "controller" ? { replace: { id: found.id, token: found.token } } : {}),
    };
  return found;
}

// What a client accepts from the relay. Anything malformed is dropped.
export function parseRelayMessage(data: string): RelayMessage | null {
  const raw = json(data);
  if (!raw) return null;
  switch (raw.t) {
    case "hello":
      return (raw.role === "tv" || raw.role === "controller") && typeof raw.tvId === "string"
        ? { t: "hello", role: raw.role, tvId: raw.tvId, ...(typeof raw.controllerId === "string" ? { controllerId: raw.controllerId } : {}) }
        : null;
    case "paired":
      return validId(raw.controllerId) && validId(raw.token) ? { t: "paired", controllerId: raw.controllerId, token: raw.token } : null;
    case "presence": {
      const list = Array.isArray(raw.controllers) ? raw.controllers : [];
      const controllers: PeerInfo[] = [];
      for (const c of list.slice(0, MAX_CONTROLLERS)) {
        const r = c as Record<string, unknown>;
        if (r && validId(r.id)) controllers.push({ id: r.id, name: text(r.name, 60) || "Phone", online: r.online === true });
      }
      return { t: "presence", tv: raw.tv === true, tvName: text(raw.tvName, 60) || "TV", controllers };
    }
    case "state": {
      const state = parseState(raw.state);
      return state ? { t: "state", state } : null;
    }
    case "ack":
      return typeof raw.id === "string" ? { t: "ack", id: raw.id.slice(0, 64), ok: raw.ok === true, ...(raw.error ? { error: text(raw.error, 200) } : {}) } : null;
    case "sync": {
      const s = sealed(raw);
      return s ? { t: "sync", ...s, ...(validId(raw.from) ? { from: raw.from } : {}) } : null;
    }
    default: {
      const cmd = parseCommand(raw);
      return cmd && validId(raw.from) ? { ...cmd, from: raw.from } : null;
    }
  }
}
