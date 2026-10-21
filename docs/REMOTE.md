# Play on TV: the phone drives, the TV plays

The TV is a receiver. Choosing, searching and managing sources happen on a phone (or
any other device running the web app). The TV shows an idle screen and the player. A
**Play on TV** action on the phone starts the item on the TV, and the phone then works
as its remote. One codebase serves both roles.

```
 phone (controller) ──wss──┐                    ┌──wss── TV (receiver)
                           ▼                    ▼
                  control relay: Worker + one Durable Object per TV
                  (control messages only, never media or guide bytes)

 TV ───────────────────── fetches every stream itself, from its origin ───────────▶
```

## Policy boundary

The relay carries **control messages only**. Media and guide/EPG bytes never pass
through it. The TV fetches every stream itself, exactly as when it plays something
chosen on the TV. A phone may send the stream addresses it already resolved (for
example a song's address), so the TV can play items whose source it hasn't connected.

## Messages

The closed list (`src/remote/protocol.ts`, shared by the app and the Worker):

| From        | Message                                              | Meaning                                                           |
| ----------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| relay       | `hello`, `presence`                                  | Who you are; who is connected (TV online, paired phones)          |
| phone → TV  | `play` (item reference, optional channel list)       | Start this. The list lets Next/Previous step channels             |
| phone → TV  | `pause`, `resume`, `seek` (absolute seconds), `stop` | Transport                                                         |
| phone → TV  | `next`, `previous`                                   | Step channels, episodes or songs                                  |
| phone → TV  | `volume` (up, down, mute)                            | The TV's own volume in the Android app; the player's in a browser |
| phone → TV  | `adult` (show/hide)                                  | 18+ on the TV, from a phone that shows it (see below)             |
| either      | `signal`                                             | WebRTC handshake for the direct link on the home network          |
| TV → phones | `state` (phase, position, duration, title)           | Sent on change only; the phone moves the position on              |
| TV → phone  | `ack` (ok or a reason)                               | The answer to each command                                        |
| pairing     | `claim` (TV), `paired` (relay), `revoke`, `name`     | Pairing codes, tokens, removal and display names                  |

An item reference carries the source and item ids, type, title, optional artwork, its
classification and its stream addresses. Everything arriving is validated against
fixed limits (`parseControllerMessage`, `parseTvMessage`).

## Pairing

1. The TV makes a random id and secret once and keeps them (`src/remote/identity.ts`).
   The first connection with that id owns it on the relay.
2. On its idle screen the TV registers a one-time pairing code (10 minutes, at most a
   few at once) and shows it in the QR link together with the existing encrypted setup
   drop.
3. The phone opens the link. It connects with the code; the relay issues this phone its
   own durable token and forgets the code. The phone keeps `{tvId, controllerId,
token}` (Settings → This device → Your TVs).
4. From then on both connect with their own credentials, sent in the WebSocket
   subprotocol list (never in a URL). Commands are accepted only from a paired phone.
5. Removing a TV on the phone, or a phone on the TV, revokes that token at once: the
   relay closes its connection and the other side sees it gone. Pairing again issues a
   new token. There are no accounts, emails or passwords.

The one-time setup drop (playlists, servers, keys sent end-to-end encrypted through a
public relay) still works as before, on the same QR.

## What the phone can do

- **Play on TV** in a title's details (one button per TV when several are paired), and
  **Playing on TV** in the header: while it is on, every Play on the phone (channels,
  the guide, episodes, server rows) goes to the TV.
- **Picks up where you left off**: the phone sends your saved position, and what you
  watch on the TV is saved in the phone's history and progress.
- **Move to TV** in the phone's player hands over from the current position;
  **Continue on this device** on the remote bar brings it back.
- Songs go with the queue and the rest of the list, so Next works on the TV.
- Volume up, down and mute.
- **18+ from the phone**: if the TV has been allowed to (TV → Settings → Privacy → Let
  paired phones show 18+ here, after the age confirmation on the TV), a phone that shows
  18+ can show it on the TV too, so no PIN is typed with the remote. Off by default.
- If the TV app is behind another app, it asks Android to come back to the front (that
  works when "Display over other apps" is allowed); otherwise the phone says so.

## The direct link on the home network

Once both are connected, the phone offers the TV a WebRTC data channel, using the relay
only to exchange the handshake. No STUN or TURN servers are used, so it only connects on
the same network. When it opens, commands, answers and state go over it (the remote
bar's label then reads "direct"); otherwise, or if it drops, everything carries on
through the relay.

## Cost rules for the relay

The relay is a Cloudflare Worker with one Durable Object per TV, sized for the free
plan with a wide margin. Three rules keep it that way:

- Sockets are accepted with the WebSocket **Hibernation API** (`acceptWebSocket`); an
  idle connection costs nothing and the object sleeps between messages.
- Nobody sends **application heartbeats**. Clients reconnect on close, when the network
  returns, or when the app comes back to the screen.
- **Storage is written only when pairing changes** (a code, a new phone, a removal, a
  name), never per message. Now-playing state lives on the TV's socket attachment.

Each socket is also rate-limited (phones 30 messages at once and 5 a second after that,
the TV 120 and 20), and Workers Logs are on (`[observability]` in `wrangler.toml`), so
connections and refusals show in the Cloudflare dashboard.

## Set it up

1. Deploy the relay (`control/`):

   ```bash
   cd control
   npm install
   npx wrangler login
   # Set ALLOWED_ORIGINS in wrangler.toml to your site's origin(s); keep
   # https://appassets.androidplatform.net for the Google TV app.
   npm run deploy
   ```

   Wrangler prints the address, for example `https://open-tv-control.<you>.workers.dev`.

2. Point the app at it, as `wss://…`: set `"controlRelay"` in `site.config.json` (or
   `VITE_CONTROL_RELAY` at build time), rebuild and deploy the site, and rebuild the
   APK. With no relay set, Play on TV is hidden and the TV offers only the one-time
   setup.

3. Open Open TV on the TV, scan its code with your phone once, then choose a title on
   the phone and press **Play on TV**.

## The TV side

- **Idle screen** (`ReceiverIdle`): whether the relay is reachable, paired phones (with
  Remove), the pairing QR, and **Browse on this TV** for when no phone is at hand.
- **No typing on the TV.** There is no search screen and no on-screen keyboard; Settings
  on the TV keeps only what a remote can use (this device, privacy, about).
- **Back**: in the player it closes the player (back to idle when the phone started it);
  in browsing it steps out to the menu, then Home, then the idle screen; on the idle
  screen it is left to the TV, which exits to Google TV. One press, one effect.
- **The channel rocker** keeps changing channels while something plays, including a
  channel list a phone sent.
- **18+**: a phone cannot start an 18+ item on a TV that isn't showing 18+ content; the
  TV answers "Show 18+ on the TV first". Private titles are reported to phones only as
  "Open TV".

## Try it locally

```bash
cd control && npm install && npx wrangler dev --port 8787 --var ALLOWED_ORIGINS:"*"
# in another shell, at the repository root:
VITE_CONTROL_RELAY=ws://127.0.0.1:8787 npm run build && npm run preview
node control/test/smoke.mjs          # protocol and pairing checks against the relay
npx playwright test e2e/remote.spec.ts   # phone + TV end to end (skips without a relay)
```
