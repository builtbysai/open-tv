import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { Relay, type Peer, type Room } from "./core";
import { CLOSE, MAX_MESSAGE, PROTOCOL, parseCredential, type NowPlaying } from "../../src/remote/protocol";

// The same relay rules as the Cloudflare Worker, on Node with in-memory rooms. For local
// development and the end-to-end tests: `npm run relay:dev`. Not for production, because
// nothing survives a restart.

interface Live {
  relay: Relay;
  peers: Set<Peer & { ws: WebSocket }>;
}

export function startRelay(port = Number(process.env.PORT ?? 8787)): Promise<{ server: Server; close(): Promise<void> }> {
  const rooms = new Map<string, Live>();
  let sockets = 0;
  const room = (tvId: string): Live => {
    let live = rooms.get(tvId);
    if (!live) {
      let saved: Room | null = null;
      const peers = new Set<Peer & { ws: WebSocket }>();
      live = {
        peers,
        relay: new Relay({
          tvId: () => tvId,
          store: {
            load: async () => saved,
            save: async (r) => {
              saved = JSON.parse(JSON.stringify(r));
            },
          },
          peers: () => [...peers].filter((p) => p.ws.readyState === 1),
        }),
      };
      rooms.set(tvId, live);
    }
    return live;
  };

  const server = createServer((request, response) => {
    if (request.url === "/health" || request.url === "/") {
      response.setHeader("content-type", "text/plain");
      response.end("Open TV control relay (dev)\n");
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  const wss = new WebSocketServer({
    server,
    maxPayload: MAX_MESSAGE,
    handleProtocols: (protocols) => (protocols.has(PROTOCOL) ? PROTOCOL : false),
  });
  wss.on("connection", async (ws, request) => {
    const match = /^\/v1\/tv\/([A-Za-z0-9_-]{8,64})$/.exec(request.url ?? "");
    if (!match) return ws.close(CLOSE.badRequest, "Not found");
    const live = room(match[1]);
    // Messages can arrive while authentication is still running; hold them until it is done.
    const early: string[] = [];
    let peer: (Peer & { ws: WebSocket }) | null = null;
    ws.on("message", (data, binary) => {
      if (binary) return;
      const text = data.toString();
      if (peer) void live.relay.message(peer, text);
      else early.push(text);
    });
    ws.on("close", () => {
      if (!peer) return;
      live.peers.delete(peer);
      void live.relay.closed(peer);
    });
    const auth = await live.relay.authenticate(parseCredential(request.headers["sec-websocket-protocol"] ?? null));
    if (!auth.ok) return ws.close(auth.code, auth.reason);
    let state: NowPlaying | undefined;
    const self: Peer & { ws: WebSocket } = {
      ws,
      role: auth.role,
      id: auth.id,
      key: `n${++sockets}`,
      send: (t) => ws.send(t),
      close: (c, r) => ws.close(c, r),
      state: () => state,
      setState: (s) => {
        state = s;
      },
    };
    peer = self;
    live.peers.add(self);
    await live.relay.opened(self, auth);
    for (const text of early) await live.relay.message(self, text);
  });

  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () =>
      resolve({
        server,
        close: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => server.close(() => done()));
          }),
      }),
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8787);
  void startRelay(port).then(() => console.log(`Open TV relay (dev) on ws://127.0.0.1:${port}`));
}
