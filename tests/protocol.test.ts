import { describe, expect, it } from "vitest";
import { parseCommand, parseCredential, parseRelayMessage, parseState, PROTOCOL } from "../src/remote/protocol";
import { parsePairingHash } from "../src/remote/pairing";

const ref = { mod: "movies", kind: "movie", id: "603", title: "The Matrix" };

describe("commands from a phone", () => {
  it("accepts well-formed commands and drops the rest", () => {
    expect(parseCommand({ t: "play", id: "abcdefgh1", ref, start: 12 })).toMatchObject({ t: "play", start: 12 });
    expect(parseCommand({ t: "ctl", id: "abcdefgh1", a: "toggle" })).toEqual({ t: "ctl", id: "abcdefgh1", a: "toggle" });
    expect(parseCommand({ t: "ctl", id: "abcdefgh1", a: "format-disk" })).toBeNull();
    expect(parseCommand({ t: "nav", id: "abcdefgh1", key: "up" })).toBeTruthy();
    expect(parseCommand({ t: "nav", id: "abcdefgh1", key: "power" })).toBeNull();
    expect(parseCommand({ t: "play", id: "short", ref })).toBeNull(); // bad command id
    expect(parseCommand({ t: "play", id: "abcdefgh1", ref: { mod: "movies" } })).toBeNull(); // bad ref
    expect(parseCommand({ t: "seek", id: "abcdefgh1" })).toBeNull();
    expect(parseCommand({ t: "seek", id: "abcdefgh1", by: -10 })).toMatchObject({ by: -10 });
  });
  it("strips control characters from typed text and caps its length", () => {
    const c = parseCommand({ t: "text", id: "abcdefgh1", value: "a\u0000b\n" + "x".repeat(500) });
    expect(c && c.t === "text" && c.value.length).toBeLessThanOrEqual(300);
    expect(c && c.t === "text" && /[\u0000-\u001f]/.test(c.value)).toBe(false);
  });
  it("accepts a module's refs it has never heard of (the protocol is module-agnostic)", () => {
    expect(parseCommand({ t: "play", id: "abcdefgh1", ref: { mod: "radio", kind: "station", id: "kexp", title: "KEXP" } })).toBeTruthy();
  });
});

describe("what the TV reports", () => {
  it("rejects unknown phases and screens, and clamps numbers", () => {
    expect(parseState({ screen: "player", phase: "exploding" })).toBeNull();
    const s = parseState({ screen: "player", phase: "playing", title: "x", pos: -5, dur: 1e12, caps: { seek: true } });
    expect(s).toMatchObject({ pos: 0, caps: { seek: true, volume: false } });
    expect(s!.dur).toBeLessThanOrEqual(7 * 24 * 3600);
  });
});

describe("messages from the relay", () => {
  it("parses presence, ack, sync and forwarded commands", () => {
    expect(parseRelayMessage(JSON.stringify({ t: "presence", tv: true, tvName: "Den", controllers: [{ id: "abcdefgh1", name: "Pixel", online: true }] }))).toMatchObject({ tv: true });
    expect(parseRelayMessage(JSON.stringify({ t: "ack", id: "x", ok: false, error: "no" }))).toMatchObject({ ok: false });
    expect(parseRelayMessage(JSON.stringify({ t: "sync", iv: "a", ct: "b", from: "abcdefgh1" }))).toMatchObject({ t: "sync" });
    expect(parseRelayMessage(JSON.stringify({ t: "ctl", id: "abcdefgh1", a: "pause", from: "abcdefgh2" }))).toMatchObject({ t: "ctl", from: "abcdefgh2" });
  });
  it("drops a forwarded command that does not say who sent it, and junk", () => {
    expect(parseRelayMessage(JSON.stringify({ t: "ctl", id: "abcdefgh1", a: "pause" }))).toBeNull();
    expect(parseRelayMessage("not json")).toBeNull();
    expect(parseRelayMessage("[]")).toBeNull();
  });
});

describe("credentials travel in the subprotocol, not the URL", () => {
  it("reads each kind and requires the protocol name", () => {
    expect(parseCredential(`${PROTOCOL}, otv-tv.abcdefgh1`)).toEqual({ kind: "tv", secret: "abcdefgh1" });
    expect(parseCredential(`${PROTOCOL}, otv-ctl.abcdefgh1.zyxwvuts2`)).toEqual({ kind: "controller", id: "abcdefgh1", token: "zyxwvuts2" });
    expect(parseCredential(`${PROTOCOL}, otv-claim.abcdefgh1`)).toMatchObject({ kind: "claim", code: "abcdefgh1" });
    expect(parseCredential("otv-tv.abcdefgh1")).toBeNull();
  });
  it("a re-pairing phone offers its old credential next to the code", () => {
    expect(parseCredential(`${PROTOCOL}, otv-claim.abcdefgh1, otv-ctl.abcdefgh2.zyxwvuts3`)).toMatchObject({
      kind: "claim",
      replace: { id: "abcdefgh2", token: "zyxwvuts3" },
    });
  });
});

describe("pairing links", () => {
  const key = "A".repeat(43);
  it("round-trips the TV id, one-time code and key", () => {
    expect(parsePairingHash(`#/pair/tvtvtvtv1234/codecode1234/${key}`)).toEqual({ tvId: "tvtvtvtv1234", code: "codecode1234", key });
  });
  it("rejects anything else", () => {
    expect(parsePairingHash("#/pair/tv/code/key")).toBeNull();
    expect(parsePairingHash("#/home")).toBeNull();
    expect(parsePairingHash(`#/pair/tvtvtvtv1234/codecode1234/${key}/extra`)).toBeNull();
  });
});
