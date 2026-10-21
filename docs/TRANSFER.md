# Phone setup

Settings → Profiles & data shows a QR code. Scanning it opens a page on your phone
where you enter playlist URLs, an Xtream account, a TMDB key, or include what is
saved on the phone. **Send to TV** delivers it, and the TV asks you to confirm.

## How it works

1. The TV creates a random room and a 256-bit AES-GCM key. The QR link is
   `<public origin>/#/pair?r=<room>&k=<key>`. Both values are in the URL fragment,
   so no server ever receives the key.
2. The phone encrypts a JSON bundle, splits it into messages under 3 KB, and
   publishes them to the room on a public publish/subscribe relay (ntfy.sh).
3. The TV holds one streaming subscription to the room, reassembles the chunks and
   decrypts them. Anything that fails authentication is ignored.
4. The bundle expires after 15 minutes and every field is validated before use:
   playlists must be HTTP(S) without logins, keys must look like keys, servers pass
   the same checks as a file import.

The relay only ever sees ciphertext and the random room name. Xtream credentials are
placed in the Xtream form in memory only and are not saved. A TMDB key from a phone
is stored on the device so it survives restarts.

## Relay

`VITE_PAIR_RELAY` selects another ntfy-compatible server at build time. The public
instance limits anonymous traffic per IP, so a self-hosted relay is the reliable
choice for a household or deployment that pairs often. Browsers on the phone and TV
need to reach the relay over HTTPS.

The relay path has been exercised against a mock of ntfy's documented publish and
JSON stream API (`e2e/transfer.spec.ts`). It has not been verified against the live
service from the build environment, which was rate limited.

## Profiles

Profiles are local and have no accounts. Each keeps its own list, history,
progress and collections under a separate storage key; the first profile keeps the
original key so existing data carries over. Sources, servers and the TMDB key are
shared by the device. A profile transfer from a phone merges into the active profile.
