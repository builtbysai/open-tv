# Phone remote and the relay

A browser cannot accept a connection, so a phone and a TV meet through a small relay. It carries
**control only** (what to play, pause, seek, keys) and **ciphertext**. It never carries video,
the TMDB key or the server list in readable form.

## Pairing

1. The TV connects (`wss://<relay>/v1/tv/<tvId>`) with its secret in the WebSocket
   *subprotocol* list (`opentv.v2`, `otv-tv.<secret>`), so no secret is ever in a URL or log.
   The first TV to connect owns that id.
2. The TV registers a one-time **pairing code** (valid 10 minutes; at most 5 outstanding) and shows
   `https://<app>/#/pair/<tvId>/<code>/<key>` as a QR code.
3. The phone opens it, connects with `otv-claim.<code>`, and receives its own **token**. The code
   is spent. The token is stored on the phone and checked (hashed) by the relay on every connection.
4. `<key>` is the sync encryption key, in the URL fragment only.

Removing a phone on the TV, or "Forget" on the phone, deletes its token on both sides. A phone
pairing again with the same TV replaces its old entry instead of being listed twice. Up to 10
phones per TV.

## Messages

Commands (phone → TV): `play`, `open`, `ctl` (play/pause/toggle/stop/next/mute/volume/nextSource),
`seek`, `nav` (the D-pad, OK, Back, Home, Menu), `text` (typing into search), `source`, `tap`.
Each has an id; the TV answers with an `ack` so the phone can say why something failed.
The TV publishes `NowPlaying` (screen, phase, title, position, what it can do, current server).
The phone moves the position on by itself between updates; the TV sends changes at once and a
heartbeat every 5 s. Full definitions: `src/remote/protocol.ts` (parsers drop anything malformed).

## Limits

256 KB per message; 60 commands per 20 s per phone (bursts allowed); 120 messages per 30 s from a TV.
Relay storage is written only when pairing changes (never per message). TV state is held in
memory (a Worker's hibernation attachment is limited to 2 KB), and a TV resends it when a phone
comes online.

## Deploying the relay

```
cd control
npm install
npx wrangler deploy        # Cloudflare Workers + one Durable Object class (Household)
```

`wrangler.toml` lists `ALLOWED_ORIGINS` (the app's origins; add your own). Put the resulting
`wss://…workers.dev` address in `site.config.json` (`controlRelay`) or build with
`VITE_RELAY_URL`. It is fixed at build time on purpose: a runtime setting would let a crafted link
point the app at someone else's relay.

> This is a new protocol (`opentv.v2`). An older deployed relay must be redeployed and phones
> paired again; old pairings are not carried over.

Local development: `npm run relay:dev` runs the same rules on Node with in-memory rooms.
