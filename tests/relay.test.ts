import { describe, expect, it } from "vitest";
import { Relay, type Peer, type Room, type Store } from "../control/src/core";
import { CLOSE, parseCredential, credential, PROTOCOL, type NowPlaying } from "../src/remote/protocol";

class FakePeer implements Peer {
  inbox: Record<string, unknown>[] = [];
  closed: [number, string] | null = null;
  private s: NowPlaying | undefined;
  constructor(public role: "tv" | "controller", public id: string, public key: string) {}
  send(text: string) {
    this.inbox.push(JSON.parse(text));
  }
  close(code: number, reason: string) {
    this.closed = [code, reason];
  }
  state = () => this.s;
  setState = (s: NowPlaying) => {
    this.s = s;
  };
  last(t: string) {
    return [...this.inbox].reverse().find((m) => m.t === t);
  }
}

function setup() {
  const peers: FakePeer[] = [];
  let saved: Room | null = null;
  let writes = 0;
  let clock = 1_000_000;
  const store: Store = {
    load: async () => saved,
    save: async (r) => {
      saved = JSON.parse(JSON.stringify(r));
      writes++;
    },
  };
  const relay = new Relay({
    tvId: () => "tvid1234567890",
    store,
    peers: () => peers.filter((p) => !p.closed),
    now: () => clock,
  });
  let n = 0;
  const join = async (cred: Parameters<Relay["authenticate"]>[0]) => {
    const auth = await relay.authenticate(cred);
    if (!auth.ok) return { auth, peer: null as unknown as FakePeer };
    const peer = new FakePeer(auth.role, auth.id, `k${++n}`);
    peers.push(peer);
    await relay.opened(peer, auth);
    return { auth, peer };
  };
  return { relay, join, peers, advance: (ms: number) => (clock += ms), writes: () => writes, saved: () => saved };
}

const SECRET = "tvsecret1234567890";
const state: NowPlaying = {
  screen: "player", phase: "playing", title: "The Matrix", pos: 5, dur: 100, at: 1,
  caps: { seek: true, volume: true, mute: true, keys: false }, muted: false, typing: false, hasNext: false, ready: true,
};
const ref = { mod: "movies", kind: "movie", id: "603", title: "The Matrix" };

async function paired() {
  const t = setup();
  const tv = await t.join({ kind: "tv", secret: SECRET });
  await t.relay.message(tv.peer, JSON.stringify({ t: "claim", code: "pairingcode12345" }));
  const phone = await t.join({ kind: "claim", code: "pairingcode12345" });
  return { ...t, tv: tv.peer, phone: phone.peer, auth: phone.auth };
}

describe("credentials", () => {
  it("reads them from the subprotocol list", () => {
    const header = [PROTOCOL, credential.controller("abcdefgh", "tokentoken1")].join(", ");
    expect(parseCredential(header)).toEqual({ kind: "controller", id: "abcdefgh", token: "tokentoken1" });
    expect(parseCredential(credential.tv("x"))).toBeNull(); // no protocol offered
    expect(parseCredential([PROTOCOL, credential.claim("codecode12")].join(","))).toMatchObject({ kind: "claim" });
  });
});

describe("pairing", () => {
  it("the first TV owns the room; a different secret is refused", async () => {
    const t = setup();
    expect((await t.join({ kind: "tv", secret: SECRET })).auth.ok).toBe(true);
    const bad = await t.join({ kind: "tv", secret: "someoneelse1234" });
    expect(bad.auth).toMatchObject({ ok: false, code: CLOSE.badSecret });
  });
  it("a phone pairs once with the TV's code and receives its own token", async () => {
    const { phone, auth, tv } = await paired();
    expect(auth.ok && auth.issued?.token).toBeTruthy();
    expect(phone.last("paired")).toBeTruthy();
    expect((tv.last("presence") as { controllers: unknown[] }).controllers).toHaveLength(1);
  });
  it("a code works once and expires", async () => {
    const t = setup();
    const tv = await t.join({ kind: "tv", secret: SECRET });
    await t.relay.message(tv.peer, JSON.stringify({ t: "claim", code: "onetimecode123" }));
    expect((await t.join({ kind: "claim", code: "onetimecode123" })).auth.ok).toBe(true);
    expect((await t.join({ kind: "claim", code: "onetimecode123" })).auth.ok).toBe(false);
    await t.relay.message(tv.peer, JSON.stringify({ t: "claim", code: "latecode123456" }));
    t.advance(11 * 60 * 1000);
    expect((await t.join({ kind: "claim", code: "latecode123456" })).auth.ok).toBe(false);
  });
  it("pairing again replaces the phone's entry instead of adding one", async () => {
    const t = await paired();
    await t.relay.message(t.tv, JSON.stringify({ t: "claim", code: "secondcode12345" }));
    const old = t.auth.ok ? t.auth.issued! : { id: "", token: "" };
    const again = await t.join({ kind: "claim", code: "secondcode12345", replace: old });
    expect(again.auth.ok).toBe(true);
    expect(t.phone.closed?.[0]).toBe(CLOSE.replaced);
    expect((t.tv.last("presence") as { controllers: unknown[] }).controllers).toHaveLength(1);
  });
  it("revoking from the TV ends the phone's access at once", async () => {
    const t = await paired();
    const id = t.auth.ok ? t.auth.id : "";
    await t.relay.message(t.tv, JSON.stringify({ t: "revoke", id }));
    expect(t.phone.closed?.[0]).toBe(CLOSE.revoked);
    const token = t.auth.ok ? t.auth.issued!.token : "";
    expect((await t.join({ kind: "controller", id, token })).auth).toMatchObject({ ok: false, code: CLOSE.revoked });
  });
  it("writes storage only when pairing changes", async () => {
    const t = await paired();
    const before = t.writes();
    for (let i = 0; i < 5; i++) {
      await t.relay.message(t.tv, JSON.stringify({ t: "state", state }));
      await t.relay.message(t.phone, JSON.stringify({ t: "seek", id: `command-${i}-xxx`, by: 10 }));
    }
    expect(t.writes()).toBe(before);
  });
});

describe("routing", () => {
  it("forwards a command to the TV with the sender, and the answer back", async () => {
    const t = await paired();
    await t.relay.message(t.phone, JSON.stringify({ t: "play", id: "command-1-xx", ref, start: 30 }));
    const got = t.tv.last("play") as { from: string; ref: { id: string }; start: number };
    expect(got).toMatchObject({ ref: { id: "603" }, start: 30 });
    await t.relay.message(t.tv, JSON.stringify({ t: "ack", id: "command-1-xx", to: got.from, ok: true }));
    expect(t.phone.last("ack")).toMatchObject({ id: "command-1-xx", ok: true });
  });
  it("tells a phone when the TV is offline", async () => {
    const t = await paired();
    t.tv.closed = [1000, "gone"];
    await t.relay.message(t.phone, JSON.stringify({ t: "ctl", id: "command-2-xx", a: "pause" }));
    expect(t.phone.last("ack")).toMatchObject({ ok: false, error: "The TV is offline" });
  });
  it("relays the TV's state, including to a phone that joins later", async () => {
    const t = await paired();
    await t.relay.message(t.tv, JSON.stringify({ t: "state", state }));
    expect(t.phone.last("state")).toMatchObject({ state: { title: "The Matrix" } });
    const token = t.auth.ok ? t.auth.issued! : { id: "", token: "" };
    const late = await t.join({ kind: "controller", id: token.id, token: token.token });
    expect(late.peer.last("state")).toBeTruthy();
  });
  it("passes sealed sync data both ways without reading it", async () => {
    const t = await paired();
    await t.relay.message(t.phone, JSON.stringify({ t: "sync", iv: "aXY", ct: "Y2lwaGVy" }));
    expect(t.tv.last("sync")).toMatchObject({ iv: "aXY", ct: "Y2lwaGVy" });
    await t.relay.message(t.tv, JSON.stringify({ t: "sync", iv: "aXY", ct: "bW9yZQ" }));
    expect(t.phone.last("sync")).toMatchObject({ ct: "bW9yZQ" });
  });
  it("drops unknown or malformed messages and enforces the rate limit", async () => {
    const t = await paired();
    const before = t.tv.inbox.length;
    await t.relay.message(t.phone, "not json");
    await t.relay.message(t.phone, JSON.stringify({ t: "rm-rf", id: "command-3-xx" }));
    await t.relay.message(t.phone, JSON.stringify({ t: "nav", id: "command-4-xx", key: "banana" }));
    expect(t.tv.inbox.length).toBe(before);
    for (let i = 0; i < 100; i++)
      await t.relay.message(t.phone, JSON.stringify({ t: "nav", id: `command-${i}-xxxx`, key: "up" }));
    const delivered = t.tv.inbox.filter((m) => m.t === "nav").length;
    expect(delivered).toBeLessThan(100);
    expect(delivered).toBeGreaterThan(30);
  });
});
