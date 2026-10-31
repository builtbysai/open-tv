import {
  CLAIM_LIFETIME,
  CLOSE,
  MAX_CONTROLLERS,
  parseControllerMessage,
  parseTvMessage,
  validId,
  type Credential,
  type NowPlaying,
  type PeerInfo,
  type RelayMessage,
} from "../../src/remote/protocol";

export { validId };

// The relay's logic, free of any runtime. The Cloudflare Worker (worker.ts) and the Node
// development relay (node.ts) are thin adapters: they own sockets and storage, this owns the
// rules. One Relay instance serves one TV and its phones.
//
// Cost rules the adapters keep: no application heartbeats, and storage is written only when
// pairing changes (a code, a new phone, a removal, a name), never per message.

export interface Peer {
  role: "tv" | "controller";
  id: string;
  // Unique per socket, for rate limiting.
  key: string;
  send(text: string): void;
  close(code: number, reason: string): void;
  // The TV's now-playing state lives on its socket, so it survives a sleeping object.
  state(): NowPlaying | undefined;
  setState(state: NowPlaying): void;
}

interface Controller {
  name: string;
  tokenHash: string;
  created: number;
}
export interface Room {
  tvSecretHash: string;
  tvName: string;
  controllers: Record<string, Controller>;
  // Hash of a pairing code -> when it stops working.
  claims: Record<string, number>;
}
export interface Store {
  load(): Promise<Room | null>;
  save(room: Room): Promise<void>;
}

export type Auth =
  | { ok: true; role: "tv" | "controller"; id: string; issued?: { id: string; token: string } }
  | { ok: false; code: number; reason: string };

const encoder = new TextEncoder();
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function token(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// Constant-time compare for equal-length hex digests.
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// A burst, refilled each second. Kept in memory only: a sleeping object starts afresh.
const LIMITS = {
  controller: { burst: 60, perSecond: 20 },
  tv: { burst: 120, perSecond: 30 },
} as const;

export class Relay {
  private room: Room | null = null;
  private loaded = false;
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private opts: {
      tvId: () => string;
      store: Store;
      peers: () => Peer[];
      now?: () => number;
    },
  ) {}

  private now = () => (this.opts.now ?? Date.now)();
  private async ensure(): Promise<void> {
    if (this.loaded) return;
    this.room = await this.opts.store.load();
    this.loaded = true;
  }
  private async save() {
    if (this.room) await this.opts.store.save(this.room);
  }
  private allow(peer: Peer): boolean {
    const limit = LIMITS[peer.role];
    const now = this.now();
    const b = this.buckets.get(peer.key) ?? { tokens: limit.burst, at: now };
    b.tokens = Math.min(limit.burst, b.tokens + ((now - b.at) / 1000) * limit.perSecond);
    b.at = now;
    this.buckets.set(peer.key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
  private send(peer: Peer, message: RelayMessage) {
    try {
      peer.send(JSON.stringify(message));
    } catch {
      /* Closing already. */
    }
  }
  private tvs = () => this.opts.peers().filter((p) => p.role === "tv");
  private phones = () => this.opts.peers().filter((p) => p.role === "controller");

  private presence(): RelayMessage {
    const online = new Set(this.phones().map((p) => p.id));
    const controllers: PeerInfo[] = Object.keys(this.room?.controllers ?? {}).map((id) => ({
      id,
      name: this.room!.controllers[id].name,
      online: online.has(id),
    }));
    return {
      t: "presence",
      tv: this.tvs().length > 0,
      tvName: this.room?.tvName ?? "TV",
      controllers,
    };
  }
  private broadcastPresence() {
    const message = this.presence();
    for (const p of this.opts.peers()) this.send(p, message);
  }
  private currentState(): NowPlaying | undefined {
    for (const tv of this.tvs()) {
      const s = tv.state();
      if (s) return s;
    }
    return undefined;
  }

  // Decides who a new connection is. Never writes unless pairing really changes.
  async authenticate(cred: Credential | null): Promise<Auth> {
    await this.ensure();
    if (!cred) return { ok: false, code: CLOSE.badRequest, reason: "Missing credentials" };
    if (cred.kind === "tv") {
      const hash = await sha256(cred.secret);
      if (!this.room) {
        // The first TV to connect owns this id.
        this.room = { tvSecretHash: hash, tvName: "TV", controllers: {}, claims: {} };
        await this.save();
      } else if (!same(this.room.tvSecretHash, hash)) {
        return { ok: false, code: CLOSE.badSecret, reason: "Wrong TV secret" };
      }
      return { ok: true, role: "tv", id: this.opts.tvId() };
    }
    if (!this.room) return { ok: false, code: CLOSE.revoked, reason: "Unknown TV" };
    if (cred.kind === "controller") {
      const c = this.room.controllers[cred.id];
      if (!c || !same(c.tokenHash, await sha256(cred.token)))
        return { ok: false, code: CLOSE.revoked, reason: "This phone is no longer paired" };
      return { ok: true, role: "controller", id: cred.id };
    }
    // A pairing code: one use, ten minutes.
    const codeHash = await sha256(cred.code);
    const expires = this.room.claims[codeHash];
    delete this.room.claims[codeHash];
    if (!expires || expires < this.now()) {
      await this.save();
      return { ok: false, code: CLOSE.badRequest, reason: "That code expired. Scan the TV's code again." };
    }
    let name = "Phone";
    if (cred.replace) {
      const old = this.room.controllers[cred.replace.id];
      if (old && same(old.tokenHash, await sha256(cred.replace.token))) {
        name = old.name;
        delete this.room.controllers[cred.replace.id];
        for (const p of this.phones()) if (p.id === cred.replace.id) p.close(CLOSE.replaced, "Replaced");
      }
    }
    if (Object.keys(this.room.controllers).length >= MAX_CONTROLLERS) {
      await this.save();
      return { ok: false, code: CLOSE.badRequest, reason: "Too many phones are paired. Remove one on the TV." };
    }
    const id = token(12);
    const secret = token(24);
    this.room.controllers[id] = { name, tokenHash: await sha256(secret), created: this.now() };
    await this.save();
    return { ok: true, role: "controller", id, issued: { id, token: secret } };
  }

  // Called once the adapter has accepted the socket.
  async opened(peer: Peer, auth: Extract<Auth, { ok: true }>): Promise<void> {
    await this.ensure();
    if (peer.role === "tv")
      for (const old of this.tvs()) if (old.key !== peer.key) old.close(CLOSE.replaced, "Another TV window took over");
    this.send(peer, {
      t: "hello",
      role: peer.role,
      tvId: this.opts.tvId(),
      ...(peer.role === "controller" ? { controllerId: peer.id } : {}),
    });
    if (auth.issued) this.send(peer, { t: "paired", controllerId: auth.issued.id, token: auth.issued.token });
    this.broadcastPresence();
    if (peer.role === "controller") {
      const state = this.currentState();
      if (state) this.send(peer, { t: "state", state });
    }
  }

  async closed(peer: Peer): Promise<void> {
    this.buckets.delete(peer.key);
    this.broadcastPresence();
  }

  async message(peer: Peer, raw: string): Promise<void> {
    await this.ensure();
    if (!this.allow(peer)) {
      if (peer.role === "controller") this.send(peer, { t: "ack", id: "-", ok: false, error: "Slow down" });
      return;
    }
    if (peer.role === "controller") return this.fromController(peer, raw);
    return this.fromTv(peer, raw);
  }

  private async fromController(peer: Peer, raw: string) {
    const m = parseControllerMessage(raw);
    if (!m) return;
    if (m.t === "revoke") {
      delete this.room?.controllers[peer.id];
      await this.save();
      peer.close(CLOSE.revoked, "Removed");
      this.broadcastPresence();
      return;
    }
    if (m.t === "name") {
      const c = this.room?.controllers[peer.id];
      if (c) {
        c.name = m.name;
        await this.save();
        this.broadcastPresence();
      }
      return;
    }
    const tvs = this.tvs();
    if (m.t === "sync") {
      for (const tv of tvs) this.send(tv, { ...m, from: peer.id });
      return;
    }
    if (!tvs.length) {
      this.send(peer, { t: "ack", id: m.id, ok: false, error: "The TV is offline" });
      return;
    }
    for (const tv of tvs) this.send(tv, { ...m, from: peer.id });
  }

  private async fromTv(peer: Peer, raw: string) {
    const m = parseTvMessage(raw);
    if (!m || !this.room) return;
    switch (m.t) {
      case "state":
        peer.setState(m.state);
        for (const p of this.phones()) this.send(p, { t: "state", state: m.state });
        return;
      case "ack":
        for (const p of this.phones()) if (p.id === m.to) this.send(p, { t: "ack", id: m.id, ok: m.ok, error: m.error });
        return;
      case "claim": {
        const hash = await sha256(m.code);
        const now = this.now();
        // Expired codes go; at most a few stay outstanding, the oldest dropped first.
        const live = Object.entries(this.room.claims)
          .filter(([, expires]) => expires > now)
          .sort((a, b) => a[1] - b[1])
          .slice(-4);
        live.push([hash, now + CLAIM_LIFETIME]);
        this.room.claims = Object.fromEntries(live);
        await this.save();
        return;
      }
      case "revoke": {
        const ids = m.id === "*" ? Object.keys(this.room.controllers) : [m.id];
        for (const id of ids) delete this.room.controllers[id];
        await this.save();
        for (const p of this.phones()) if (ids.includes(p.id)) p.close(CLOSE.revoked, "Removed by the TV");
        this.broadcastPresence();
        return;
      }
      case "name":
        this.room.tvName = m.name;
        await this.save();
        this.broadcastPresence();
        return;
      case "sync": {
        const { to, ...rest } = m;
        for (const p of this.phones()) if (!to || p.id === to) this.send(p, rest);
        return;
      }
    }
  }
}
