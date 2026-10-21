import { DurableObject } from "cloudflare:workers";
import {
  CLAIM_LIFETIME,
  CLOSE,
  PROTOCOL,
  parseControllerMessage,
  parseCredential,
  parseTvMessage,
  validId,
  type NowPlaying,
  type Peer,
  type RelayMessage,
} from "../../src/remote/protocol";

// Open TV control relay. One Durable Object per TV ("household"): the TV registers as the
// playback device and paired phones as controllers. It relays control messages only;
// media and guide bytes never pass through it.
//
// Cost rules: sockets are accepted with the Hibernation API, nothing sends heartbeats, and
// storage is written only when pairing changes (never per message).

export interface Env {
  HOUSEHOLD: DurableObjectNamespace<Household>;
  // Comma-separated origins allowed to connect, e.g. "https://tv.example.com".
  ALLOWED_ORIGINS?: string;
}

interface Controller {
  name: string;
  tokenHash: string;
  created: number;
}
interface Stored {
  tvSecretHash: string;
  tvName: string;
  controllers: Record<string, Controller>;
  // Hash of a pairing code → when it stops working.
  claims: Record<string, number>;
}
interface Attachment {
  role: "tv" | "controller";
  id: string;
  // The TV's now-playing state lives on its socket, so it survives hibernation without
  // a storage write.
  state?: NowPlaying;
}

const encoder = new TextEncoder();
async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function token(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
// Constant-time compare for equal-length hex digests.
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function allowedOrigin(request: Request, env: Env): boolean {
  const list = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  // "*" is for local development only.
  if (list.includes("*")) return true;
  const origin = request.headers.get("Origin");
  return !!origin && list.includes(origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health")
      return new Response("Open TV control relay\n", {
        headers: { "content-type": "text/plain" },
      });
    const match = /^\/v1\/tv\/([A-Za-z0-9_-]{8,64})$/.exec(url.pathname);
    if (!match) return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected a WebSocket", { status: 426 });
    if (!allowedOrigin(request, env))
      return new Response("Origin not allowed", { status: 403 });
    const stub = env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName(match[1]));
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// Messages a socket may send: a burst, refilled each second. Kept in memory only; a
// sleeping object simply starts afresh.
const LIMITS = {
  controller: { burst: 30, perSecond: 5 },
  tv: { burst: 120, perSecond: 20 },
} as const;

export class Household extends DurableObject<Env> {
  private stored: Stored | null = null;
  private tvId = "";
  private buckets = new WeakMap<WebSocket, { tokens: number; at: number }>();
  private allow(ws: WebSocket, role: Attachment["role"]): boolean {
    const limit = LIMITS[role];
    const now = Date.now();
    const bucket = this.buckets.get(ws) ?? { tokens: limit.burst, at: now };
    bucket.tokens = Math.min(
      limit.burst,
      bucket.tokens + ((now - bucket.at) / 1000) * limit.perSecond,
    );
    bucket.at = now;
    this.buckets.set(ws, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.stored = (await ctx.storage.get<Stored>("state")) ?? null;
      this.tvId = (await ctx.storage.get<string>("tvId")) ?? "";
    });
  }

  private async save() {
    if (this.stored) await this.ctx.storage.put("state", this.stored);
  }
  private open(tag?: string): WebSocket[] {
    return this.ctx
      .getWebSockets(tag)
      .filter((ws) => ws.readyState === WebSocket.OPEN);
  }
  private send(ws: WebSocket, message: RelayMessage) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      /* Closing already. */
    }
  }
  private attachment(ws: WebSocket): Attachment | null {
    return (ws.deserializeAttachment() as Attachment | null) ?? null;
  }
  private presence(): RelayMessage {
    const online = new Set(
      this.open("controller").map((ws) => this.attachment(ws)?.id),
    );
    const controllers: Peer[] = Object.entries(
      this.stored?.controllers ?? {},
    ).map(([id, c]) => ({ id, name: c.name, online: online.has(id) }));
    return {
      t: "presence",
      tv: this.open("tv").length > 0,
      tvName: this.stored?.tvName ?? "TV",
      controllers,
    };
  }
  private broadcastPresence() {
    const message = this.presence();
    for (const ws of this.open()) this.send(ws, message);
  }
  private nowPlaying(): NowPlaying | undefined {
    for (const ws of this.open("tv")) {
      const state = this.attachment(ws)?.state;
      if (state) return state;
    }
    return undefined;
  }
  private accept(role: Attachment["role"], id: string): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role, `${role}:${id}`]);
    server.serializeAttachment({ role, id } satisfies Attachment);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": PROTOCOL },
    });
  }
  // Accepts the socket only to close it with a reason a client can act on.
  private refuse(code: number, reason: string): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["refused"]);
    server.close(code, reason);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": PROTOCOL },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const tvId = new URL(request.url).pathname.split("/").at(-1) ?? "";
    if (!validId(tvId)) return new Response("Bad TV id", { status: 400 });
    if (!this.tvId) {
      this.tvId = tvId;
      await this.ctx.storage.put("tvId", tvId);
    }
    const credential = parseCredential(
      request.headers.get("Sec-WebSocket-Protocol"),
    );
    if (!credential) return this.refuse(CLOSE.badRequest, "credentials");

    if (credential.kind === "tv") {
      const secretHash = await hash(credential.secret);
      // The first TV to connect with this id owns it; the id is random and shown only in
      // the pairing code.
      if (!this.stored) {
        this.stored = {
          tvSecretHash: secretHash,
          tvName: "TV",
          controllers: {},
          claims: {},
        };
        await this.save();
      } else if (!same(this.stored.tvSecretHash, secretHash))
        return this.refuse(CLOSE.badSecret, "secret");
      // One live TV connection: a new one replaces the old.
      for (const old of this.open("tv")) old.close(CLOSE.replaced, "replaced");
      const response = this.accept("tv", "tv");
      queueMicrotask(() => this.welcome("tv"));
      return response;
    }

    if (!this.stored) return this.refuse(CLOSE.revoked, "unknown TV");

    if (credential.kind === "claim") {
      const now = Date.now();
      const codeHash = await hash(credential.code);
      const until = this.stored.claims[codeHash];
      // Expired codes are swept whenever pairing state is written anyway.
      for (const [key, expiry] of Object.entries(this.stored.claims))
        if (expiry < now) delete this.stored.claims[key];
      if (!until || until < now) {
        await this.save();
        return this.refuse(CLOSE.revoked, "code");
      }
      delete this.stored.claims[codeHash];
      const id = token(12),
        secret = token(24);
      this.stored.controllers[id] = {
        name: "Phone",
        tokenHash: await hash(secret),
        created: now,
      };
      await this.save();
      const response = this.accept("controller", id);
      queueMicrotask(() => {
        for (const ws of this.ctx.getWebSockets(`controller:${id}`))
          this.send(ws, { t: "paired", controllerId: id, token: secret });
        this.welcome("controller", id);
      });
      return response;
    }

    const controller = this.stored.controllers[credential.id];
    if (
      !controller ||
      !same(controller.tokenHash, await hash(credential.token))
    )
      return this.refuse(CLOSE.revoked, "revoked");
    const response = this.accept("controller", credential.id);
    queueMicrotask(() => this.welcome("controller", credential.id));
    return response;
  }

  private welcome(role: Attachment["role"], id?: string) {
    const sockets =
      role === "tv"
        ? this.open("tv")
        : this.ctx.getWebSockets(`controller:${id}`);
    const state = role === "controller" ? this.nowPlaying() : undefined;
    for (const ws of sockets) {
      this.send(ws, {
        t: "hello",
        role,
        tvId: this.tvId,
        ...(id ? { controllerId: id } : {}),
      });
      if (state) this.send(ws, { t: "state", state });
    }
    this.broadcastPresence();
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const who = this.attachment(ws);
    if (!who || typeof data !== "string" || !this.stored) return;
    if (!this.allow(ws, who.role)) {
      console.warn(JSON.stringify({ event: "rate-limited", role: who.role }));
      return;
    }
    if (who.role === "controller") {
      // A revoked controller's socket is closed at revoke time; this is a backstop.
      if (!this.stored.controllers[who.id]) {
        ws.close(CLOSE.revoked, "revoked");
        return;
      }
      const message = parseControllerMessage(data);
      if (!message) return;
      if (message.t === "revoke") {
        await this.revoke(who.id);
        return;
      }
      if (message.t === "signal") {
        for (const tv of this.open("tv"))
          this.send(tv, { t: "signal", from: who.id, data: message.data });
        return;
      }
      if (message.t === "name") {
        if (this.stored.controllers[who.id].name !== message.name) {
          this.stored.controllers[who.id].name = message.name;
          await this.save();
          this.broadcastPresence();
        }
        return;
      }
      const tvs = this.open("tv");
      if (!tvs.length) {
        this.send(ws, {
          t: "ack",
          id: message.id,
          ok: false,
          error: "offline",
        });
        return;
      }
      for (const tv of tvs) this.send(tv, { ...message, from: who.id });
      return;
    }

    const message = parseTvMessage(data);
    if (!message) return;
    switch (message.t) {
      case "state": {
        ws.serializeAttachment({ ...who, state: message.state });
        for (const c of this.open("controller")) this.send(c, message);
        return;
      }
      case "ack": {
        for (const c of this.ctx.getWebSockets(`controller:${message.to}`))
          this.send(c, {
            t: "ack",
            id: message.id,
            ok: message.ok,
            ...(message.error ? { error: message.error } : {}),
          });
        return;
      }
      case "signal": {
        for (const c of this.ctx.getWebSockets(`controller:${message.to}`))
          this.send(c, { t: "signal", data: message.data });
        return;
      }
      case "claim": {
        const now = Date.now();
        for (const [key, expiry] of Object.entries(this.stored.claims))
          if (expiry < now) delete this.stored.claims[key];
        // A handful of live codes at most: the newest replaces the oldest.
        const live = Object.entries(this.stored.claims).sort(
          (a, b) => a[1] - b[1],
        );
        while (live.length >= 3) delete this.stored.claims[live.shift()![0]];
        this.stored.claims[await hash(message.code)] = now + CLAIM_LIFETIME;
        await this.save();
        return;
      }
      case "revoke": {
        await this.revoke(message.id);
        return;
      }
      case "name": {
        if (this.stored.tvName !== message.name) {
          this.stored.tvName = message.name;
          await this.save();
          this.broadcastPresence();
        }
      }
    }
  }

  private async revoke(id: string) {
    if (!this.stored) return;
    const ids = id === "*" ? Object.keys(this.stored.controllers) : [id];
    let changed = false;
    for (const target of ids) {
      if (!this.stored.controllers[target]) continue;
      delete this.stored.controllers[target];
      changed = true;
      for (const ws of this.ctx.getWebSockets(`controller:${target}`))
        ws.close(CLOSE.revoked, "revoked");
    }
    if (changed) {
      await this.save();
      this.broadcastPresence();
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {
      /* Already closed. */
    }
    this.broadcastPresence();
  }

  async webSocketError() {
    this.broadcastPresence();
  }
}
