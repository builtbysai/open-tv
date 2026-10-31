import { DurableObject } from "cloudflare:workers";
import { Relay, type Peer, type Room } from "./core";
import {
  CLOSE,
  PROTOCOL,
  parseCredential,
  type NowPlaying,
} from "../../src/remote/protocol";

// Open TV control relay on Cloudflare. One Durable Object per TV ("household"): the TV
// registers as the playback device and paired phones as controllers. The rules live in
// core.ts; this file only owns sockets and storage.
//
// Cost rules: sockets use the Hibernation API (an idle connection costs nothing and the
// object sleeps between messages), nobody sends heartbeats, and storage is written only when
// pairing changes.

export interface Env {
  HOUSEHOLD: DurableObjectNamespace<Household>;
  // Comma-separated origins allowed to connect, e.g. "https://tv.example.com".
  ALLOWED_ORIGINS?: string;
}

function allowedOrigin(request: Request, env: Env): boolean {
  const list = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (list.includes("*")) return true; // local development only
  const origin = request.headers.get("Origin");
  return !!origin && list.includes(origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health")
      return new Response("Open TV control relay\n", { headers: { "content-type": "text/plain" } });
    const match = /^\/v1\/tv\/([A-Za-z0-9_-]{8,64})$/.exec(url.pathname);
    if (!match) return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected a WebSocket", { status: 426 });
    if (!allowedOrigin(request, env)) return new Response("Origin not allowed", { status: 403 });
    return env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName(match[1])).fetch(request);
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  role: "tv" | "controller";
  id: string;
  key: string;
}

export class Household extends DurableObject<Env> {
  private tvId = "";
  // The TV's latest state. Kept in memory, not in the socket attachment (which is limited to
  // 2 KB); the TV sends it again whenever a phone comes online, so a sleeping object loses
  // nothing that matters.
  private states = new Map<string, NowPlaying>();
  private relay: Relay;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.relay = new Relay({
      tvId: () => this.tvId,
      store: {
        load: async () => (await ctx.storage.get<Room>("room")) ?? null,
        save: async (room) => {
          await ctx.storage.put("room", room);
        },
      },
      peers: () => this.peers(),
    });
  }

  private peerOf(ws: WebSocket): Peer | null {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a) return null;
    return {
      role: a.role,
      id: a.id,
      key: a.key,
      send: (text) => ws.send(text),
      close: (code, reason) => ws.close(code, reason),
      state: () => this.states.get(a.key),
      setState: (s) => void this.states.set(a.key, s),
    };
  }
  private peers(): Peer[] {
    const out: Peer[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const peer = this.peerOf(ws);
      if (peer) out.push(peer);
    }
    return out;
  }

  async fetch(request: Request): Promise<Response> {
    this.tvId = new URL(request.url).pathname.split("/").pop() ?? "";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const auth = await this.relay.authenticate(parseCredential(request.headers.get("Sec-WebSocket-Protocol")));
    // Accept even a refused socket, only to close it with a reason a client can act on.
    this.ctx.acceptWebSocket(server, [auth.ok ? auth.role : "refused"]);
    const response = (): Response =>
      new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": PROTOCOL } });
    if (!auth.ok) {
      server.close(auth.code, auth.reason);
      return response();
    }
    const key = crypto.randomUUID();
    server.serializeAttachment({ role: auth.role, id: auth.id, key } satisfies Attachment);
    const peer = this.peerOf(server);
    if (!peer) {
      server.close(CLOSE.badRequest, "Internal error");
      return response();
    }
    await this.relay.opened(peer, auth);
    return response();
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    const peer = this.peerOf(ws);
    if (peer) await this.relay.message(peer, message);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const peer = this.peerOf(ws);
    if (!peer) return;
    this.states.delete(peer.key);
    await this.relay.closed(peer);
    try {
      ws.close();
    } catch {
      /* Already closed. */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }
}
