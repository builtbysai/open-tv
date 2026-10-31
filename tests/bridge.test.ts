import { describe, expect, it } from "vitest";
import {
  canDo,
  emptyBridge,
  encodeCommand,
  parseBridgeMessage,
  reduceBridge,
  type BridgeEvent,
  type BridgeState,
} from "../src/player/bridge";

const run = (events: (BridgeEvent | null)[], start: BridgeState = emptyBridge) =>
  events.reduce<BridgeState>((s, e) => (e ? reduceBridge(s, e) : s), start);

describe("parsing", () => {
  it("reads the opentv v1 protocol", () => {
    expect(
      parseBridgeMessage({ opentv: 1, type: "ready", caps: { seek: true, volume: true, mute: false } }),
    ).toEqual({ k: "ready", kind: "opentv", caps: { seek: true, volume: true, mute: false } });
    expect(
      parseBridgeMessage({ opentv: 1, type: "state", playing: true, time: 12.5, duration: 5400, volume: 0.4, muted: false }),
    ).toMatchObject({ k: "state", playing: true, time: 12.5, duration: 5400, volume: 0.4 });
    expect(parseBridgeMessage({ opentv: 1, type: "key", key: "back" })).toEqual({ k: "key", key: "back" });
    expect(parseBridgeMessage({ opentv: 1, type: "key", key: "rm -rf" })).toBeNull();
  });
  it("still reads the first version's messages", () => {
    expect(parseBridgeMessage({ source: "opentv", type: "ready" })).toMatchObject({ k: "ready", kind: "legacy" });
    expect(parseBridgeMessage({ source: "opentv", type: "timeupdate", time: 3, duration: 60 })).toMatchObject({
      k: "state",
      time: 3,
    });
    expect(parseBridgeMessage({ source: "opentv", type: "unavailable", message: "no title" })).toMatchObject({
      k: "error",
      message: "no title",
    });
  });
  it("reads Player.js and one-way event messages, also as JSON strings", () => {
    expect(
      parseBridgeMessage({ context: "player.js", version: "0.0.10", event: "timeupdate", value: { seconds: 7, duration: 70 } }),
    ).toMatchObject({ k: "state", kind: "playerjs", time: 7, duration: 70 });
    expect(
      parseBridgeMessage(JSON.stringify({ type: "PLAYER_EVENT", data: { event: "timeupdate", currentTime: 9, duration: 90 } })),
    ).toMatchObject({ k: "state", kind: "events", time: 9 });
  });
  it("ignores anything else", () => {
    for (const junk of [null, 5, "hello", [], {}, { opentv: 2, type: "ready" }, { type: "x" }, "{not json", { opentv: 1, type: "nope" }])
      expect(parseBridgeMessage(junk)).toBeNull();
  });
  it("drops negative and non-finite numbers", () => {
    const e = parseBridgeMessage({ opentv: 1, type: "state", time: -4, duration: Infinity });
    expect(e).toMatchObject({ k: "state", time: undefined, duration: undefined });
  });
});

describe("state", () => {
  it("follows ready, play, time and end", () => {
    const s = run([
      parseBridgeMessage({ opentv: 1, type: "ready", caps: { seek: true, volume: true, mute: true } }),
      parseBridgeMessage({ opentv: 1, type: "state", playing: true, time: 1, duration: 100 }),
    ]);
    expect(s).toMatchObject({ kind: "opentv", ready: true, playing: true, time: 1, duration: 100 });
    expect(reduceBridge(s, { k: "ended", kind: "opentv" })).toMatchObject({ playing: false, ended: true });
  });
  it("infers playing from time that creeps forward, but not from a seek", () => {
    const base = run([{ k: "ready", kind: "events", caps: { seek: false, volume: false, mute: false } }]);
    expect(run([{ k: "state", kind: "events", time: 1 }, { k: "state", kind: "events", time: 2 }], base).playing).toBe(true);
    // Resuming at 100 s, then a jump to 900 s: two seeks, no evidence of playback.
    expect(run([{ k: "state", kind: "events", time: 100 }, { k: "state", kind: "events", time: 900 }], base).playing).toBe(false);
  });
});

describe("commands", () => {
  const ready = (kind: "opentv" | "legacy" | "playerjs" | "events", caps = { seek: true, volume: true, mute: true }) =>
    ({ ...emptyBridge, kind, ready: true, caps, time: 30, duration: 100, playing: true }) as BridgeState;

  it("encodes the opentv v1 commands", () => {
    const s = ready("opentv");
    expect(encodeCommand(s, { c: "toggle" })).toEqual({ opentv: 1, type: "cmd", cmd: "toggle" });
    expect(encodeCommand(s, { c: "seek", to: 500 })).toEqual({ opentv: 1, type: "cmd", cmd: "seek", value: 100 });
    expect(encodeCommand(s, { c: "mute", on: false })).toEqual({ opentv: 1, type: "cmd", cmd: "unmute" });
  });
  it("translates for the first version and Player.js", () => {
    expect(encodeCommand(ready("legacy"), { c: "seekBy", by: -10 })).toEqual({
      source: "opentv-host", type: "command", action: "seek", value: 20,
    });
    expect(encodeCommand(ready("playerjs"), { c: "toggle" })).toMatchObject({ method: "pause" });
    expect(encodeCommand(ready("playerjs"), { c: "volume", to: 0.5 })).toMatchObject({ method: "setVolume", value: 50 });
  });
  it("refuses what a player cannot do", () => {
    expect(encodeCommand(ready("events"), { c: "pause" })).toBeNull();
    expect(canDo(ready("opentv", { seek: false, volume: true, mute: true }), { c: "seek", to: 5 })).toBe(false);
    expect(encodeCommand(emptyBridge, { c: "play" })).toBeNull();
  });
});
