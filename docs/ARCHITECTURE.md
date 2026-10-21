# Open TV architecture

## Decision: Vite + React + strict TypeScript

This is a client-rendered static application with no paid dependencies or new
backend. Vite produces a static build that any static host can serve. React provides
accessible, composable UI, explicit props and a mature ecosystem. Native browser
APIs handle storage, dialogs, fullscreen and PiP. HLS.js is loaded only when
native HLS cannot handle playback; Settings and Player are also lazy chunks.
No global state library, runtime router package, database server or microservices.

```
src/
  app/           composition, hash routing, source orchestration
  screens/       Home, browse/guide, personal library
  components/    cards, details, navigation, player UI, source/privacy settings
  domain/        content contracts, IDs, deduplication, privacy queries, URL rules
  providers/     M3U, catalogs, Xtream, TMDB and XMLTV
  extension/     extension file format, validation and on-device storage
  music/         Invidious and Piped clients, provider fallback, lyrics and album lookups
  playback/      player service, recovery budget and observable playback phases
  guide/         session-scoped XMLTV connection, refresh, backoff and cancellation
  persistence/   validated user-state migration and IndexedDB catalog cache
  tv/            explicit TV mode, spatial focus geometry and remote navigation
  styles/        tokens and responsive styles
scripts/         reviewed film sync, release metadata and deployment verification
public/          bundled playlists, the reviewed film catalog and artwork
android/         optional Android TV launcher with bundled HTTPS viewer assets
```

Presentation receives normalized content, never raw provider HTML. Provider
responses enter through parser/validation boundaries. An adapter resolves a
source into `Content[]`; all discovery uses `queryCatalog` before rendering or
choosing playable items. Adult and uncertain classifications fail closed.
Local recommendations apply these same queries before deriving general-only
signals from favorite aliases and recent history. They exclude seen/unavailable
items. No recommendation traffic leaves the app.
Guide connections are a separate session service, not a catalog/source cache;
see [XMLTV lifecycle and limits](EPG.md).
`Content.availability`, `rights`, and stream health describe different things.
A successful HEAD request establishes endpoint reachability, not rights,
decodability, uninterrupted streaming, or availability in another region.

## IDs and duplicates

Stable, opaque 64-ish-bit dual-hash keys identify URL-only imports; known provider
IDs plus feed IDs identify richer catalogs. These are identifiers, not encryption.
Exact URLs and exact provider IDs merge alternatives. Near-identical titles are
reported for review, not merged: regional feeds may have identical names. Alias
IDs keep URL-based favorites/history working when richer records replace them.
Catalog aliases are indexed once; scroll and progress events do not scan the
entire catalog to recover favorites or history.

## Extensions and music

An [extension file](EXTENSIONS.md) is parsed by `extension/format.ts` and kept in IndexedDB
(`extension/store.ts`); `useExtension` merges its sources into the source list. Large
playlists and catalogs are stored inline and read on demand. 18+ entries go to the private
scope and are never connected automatically. An extension may also carry music instances,
servers, a TMDB key and a profile; `extension/data.ts` decides what is new for a given load
(start or deliberate import) and `App` applies it through the same paths as a backup.

Music providers are addresses of Invidious, Piped or Audius services, plus the built-in
Internet Archive (`music/archive.ts`). `music/client.ts` tries them in order, skips one that
keeps failing for a short while, merges search and trending across kinds of service with
each song labelled by its provider, and hands the player a placeholder address that is
resolved to real audio when the song is reached. See [music](MUSIC.md).

## State and storage

`opentv:user:v2` stores validated IDs, general-profile history/progress,
route/search/selected content, named collections, per-screen genre/language/country/
grid/guide state, library tab, safe form drafts, scroll and player preferences. Reads recover
from malformed JSON or wrong types. Writes tolerate disabled/full storage.
Volume is clamped.

Favorites, history and progress are stored as IDs per profile. Server libraries and
form drafts are validated on load. A saved "now playing" value is cleared because it
can contain credentials. Unmatched favorites/history stay as IDs, so unavailable
sources can reconnect without losing them. Never automatically resume media:
the app offers a Resume button after resolving an allowed ID.

IndexedDB `opentv-catalog/sources` caches public/general catalog records with TTLs.
Adult, uncertain, credential-bearing records and account catalogs are not written.
User-owned media is stored separately in `opentv-library/library`, without TTLs.
Clearing the catalog cache cannot clear the library. Writes are serialized and
report storage failures. General records persist only when stream, artwork,
backdrop and external/rights URLs pass the sensitive-URL boundary; account media
stays in memory and is excluded from export. Media editing preserves stable IDs,
so favorites, history and collection membership survive metadata/URL corrections. Source definitions with sensitive URLs are also memory-only.
New imports can be exported as JSON. 18+ is additive: there is one catalog, one
source list, one server list and one guide, saved the same way whether 18+ is shown or
not. Classification is a per-item and per-source flag, and `canView` at query time is
the only gate, so hiding 18+ changes visibility and nothing else. The keyword
classifier only flags titles for that gate; it never moves, drops or reclassifies a
source, playlist, server or collection you added. Source requests are guarded against
late completion. All catalog writers update the same current snapshot
before React renders, avoiding a library-hydration overwrite of completed sources.
Async file imports also discard their results after their screen unmounts. 18+
titles are never sent to TMDB.

`useViewerSession` owns hash navigation and per-screen controls. `useScrollRestoration`
observes rendered content size, waits for asynchronous catalogs before restoring
the intended offset, cancels on user navigation/scroll input and throttles writes.
The final pagehide flush includes the current offset. General media/playlist
form drafts have explicit field allowlists: never media/server/artwork URLs or
credentials, and never private/adult/uncertain draft metadata. PINs use salted PBKDF2-SHA256 with 210,000 iterations; PINs are
shared-device convenience, not a server-enforced age-verification service.

## Playback

`PlayerService` owns the media element and HLS lifecycle. The snapshot exposes
idle, loading, playing, paused, buffering, recovering, ended and error phases.
A user-initiated play creates one recovery budget: one retry, then at most one
alternative belonging to the same item. Neither attaching a new stream nor a
`playing` event resets this budget. No automatic skip into an unrelated channel.
Generation IDs ignore stale callbacks after channel switches. Listeners,
watchdogs, HLS instances, requests and video resources are released on teardown.

Native HLS is preferred; otherwise HLS.js supplies adaptive quality, audio and
subtitle controls. Browser-native controls cover native HLS tracks and transport.
VOD resumes after metadata; progress flushes every five seconds, at page hide,
and on close. Episodes advance only within an explicitly identified series.
The player UI owns fullscreen/PiP, keyboard controls and sleep timing. Arbitrary
embeds are open frames by default: adding a server is an explicit act of trust, and
sandboxed frames make many embed backends refuse to play. Each server can instead get a
click guard or a sandbox (see [servers](SERVERS.md)). Frames keep the no-referrer policy. The embedded provider owns its UI;
Open TV cannot recover or read progress across that origin.

## Reusable media servers

`MediaServer` definitions are validated in the domain layer and projected into
`opentv:servers:v1` only for safe general servers. `useMediaServers` owns general
configuration and a private overlay; lock restores the general definitions.
`Content.serverId` and `providerItemId` resolve through `resolveServerMedia` at the
query boundary, so address edits update streams without changing title identity.
Missing/disabled servers produce unavailable items with no streams, never an
implicit transfer to another provider. Restricted server classifications cascade
before filtering. Source registry backup includes server definitions; restored
servers start disconnected. See [media server contracts](SERVERS.md).

General media drafts include validated server/title IDs and metadata fields, with no
server/stream/artwork addresses. Season zero survives normalization and drafts.

## Account series

`EpisodicProvider` adds on-demand `loadEpisodes` and disposal to the content-provider
contract. `useCatalog` retains account adapters after leaving Settings, scopes them
to the session and discards them on disconnect. Xtream series lists contain
metadata only; opening a series resolves its episodes, retaining successful results
only in that connection's memory. Failed/canceled loads can be retried explicitly.
Parent IDs group seasons, including Specials (zero), and episode progression stops
at the series boundary. API requests disable HTTP caching/redirects and use bounded
responses/timeouts; no account state enters IndexedDB, exports or general sessions.
See [account protocol and extension guide](XTREAM.md) for actual actions and limits.

## TV guide

XMLTV records are indexed and deduplicated by exact channel ID once per import.
The three-hour timeline clips programs to its window, preserves gaps, contains
horizontal scrolling and keeps channel labels sticky. Real timestamps drive the
Now marker. Program details distinguish a scheduled program from the action to
open that channel's current live stream. Guide imports remain in memory. Schedules are not fabricated or fetched without an
authorized source. No guide file is written to browser storage.

## Android TV and directional input

`?tv=1` or the Android host's user-agent marker selects explicit TV layout. The
same React viewer and player service handle TV; no duplicate catalog or playback
implementation is introduced. Pure spatial geometry ranks eligible focus targets
in the requested direction. The remote hook scopes targets to the topmost modal,
scrolls rails, respects text caret input and toggles native checkbox controls.
Back closes context, returns to the current navigation item, then Home, then the
idle screen; an unhandled Back there lets the host exit. Spatial moves prefer the
same row or column (as Android's focus finder does), and entering a screen lands on
its first control. Media keys enter the player controls;
Volume and Home remain system functions. TV controls replace inaccessible native
video transport while preserving the existing service and HLS track selectors.

`android/` is a deliberately small optional host, not Capacitor or a new server.
Gradle copies `dist` into the APK; AndroidX serves it from a secure HTTPS origin
with the same security headers. No file access or generic JavaScript interface.
An origin/main-frame-scoped message listener permits only bounded JSON export
through the user's document picker. Imports use the system picker. Android
pauses media and sends a private-lock event on backgrounding; package data is
excluded from system backup/transfer. Local Android storage does not share the
website's profile. The debug package is separate from a future release package.
The bounded bridge also publishes sanitized foreground playback to native
MediaSession/audio focus, and applies private-window protection. Private system
metadata is suppressed and focus gain never resumes audio. No Media3, native DRM,
Cast receiver or Play Store certification is claimed. See [Google TV setup and limitations](GOOGLE_TV.md).

## Play on TV

The TV is a receiver; the phone is the interface. A Cloudflare Worker with one
Durable Object per TV relays control messages (play, pause, resume, seek, stop,
next, previous, state, acks, pairing) between them over WebSockets using the
Hibernation API. It never carries media or guide bytes. Pairing issues each phone its
own token; revoking it on either side ends the pairing at once. The protocol and its
validation live in `src/remote/protocol.ts`, shared with the Worker in `control/`.
See [Play on TV](REMOTE.md).

## Security and diagnostics

HTTP(S) URLs only; reject userinfo credentials and executable schemes. Query-
bearing or known Xtream credential-path URLs are sensitive and never cached or
exported. User-entered Xtream keys remain in memory. A TMDB key is in memory unless the user opts into storing it on the device. React escapes strings.
No analytics. Diagnostic ring buffer contains codes and timestamps, not URLs,
queries, titles or account responses. `_headers` adds a CSP, no-referrer,
no-sniff and device permission restrictions where the host supports headers; otherwise the policy is a meta tag.

Direct playback is the default; credential-bearing addresses bypass any relay. Do not
enable a server-side proxy without destination allowlists, DNS/IP validation on every
redirect, response size/time limits, rate limits, redacted logs and explicit account
handling.

## App modules

`app/App.tsx` wires the screens; the logic lives in hooks.

| Hook or module                                    | Responsibility                                                                                                                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useCatalog`                                      | Merges sources into one catalog. Three memory scopes: public (persisted registry), account (credentialed servers, visible, filtered per item) and private (18+, cleared when hidden). `setDerivedItems` holds titles that belong to no listed source. |
| `useAccounts`                                     | Remembered Xtream/Jellyfin accounts and auto-connect at start (`providers/accounts.ts`).                                                                                                                                                              |
| `components/Onboarding`, `persistence/onboarding` | The one-time welcome. It opens only when the device has no TMDB key, no added sources and no earlier choice; Skip, Escape and Back all skip it. `SetupReminder` on Home covers unfinished setup.                                                      |
| `useServerLibrary` and `serverLibrary`            | Asks each server for a TMDB title (`{base}/embed/...`), caches results for a day and exposes found titles as catalog entries (`domain/embed-library.ts`).                                                                                             |
| `useTitles`                                       | Movies, live and audio splits, TMDB shelves matched to your library, wishlist, where-to-watch, lazy file lookup for Internet Archive and NASA titles.                                                                                                 |
| `usePlaybackActions`                              | Start, stop and step through playback, the docked mini-player, the audio queue and channel-number entry.                                                                                                                                              |
| `useLibraryActions`                               | Saved and named collections.                                                                                                                                                                                                                          |
| `useSearch`                                       | Ranked search on a lazily built index, filters and TMDB matches you do not have.                                                                                                                                                                      |
| `providers/directories.ts`                        | Builds the provider for a `directory` source: Internet Archive, NASA, Radio Browser, SomaFM.                                                                                                                                                          |
| `components/Player`, `AudioStage`, `MiniPlayer`   | One media element serves video and audio. Audio adds a visualizer (`playback/analyser`, `spectrum`) and can dock to a bar without stopping.                                                                                                           |
| `tv/useRemoteNavigation`                          | Spatial focus, focus memory, paced key repeat, page keys.                                                                                                                                                                                             |

## Launch, reporting and transport boundaries

18+ content is hidden by default. Settings → Privacy shows it after a one-time
confirmation (`persistence/adult-consent.ts`). Whether it is shown is remembered (a flag, not
content) and restored when the app opens: at once with no PIN or on a trusted device, otherwise
after the PIN (`AdultUnlock`). Lists, personal 18+ media and a relay connected while 18+ was
shown live in memory only and are reloaded or dropped when it is hidden. This is not verified age. A general-only build disables the switch. Strong age assurance
requires an issuer and protected server-side delivery, documented separately.

`queryCatalog` applies the checked-in content restriction policy before privacy,
search and filtering. Playback rechecks it; blocked stream alternatives cannot
silently fall through to external links. Public issue links contain only
safe general references, while private notice fields remain in memory and export
only after an explicit action. No private notice is submitted without an operator
contact. Policy is delisting, not deletion of third-party hosting or old builds.

`probeVideo` observes decoded frames from a bounded muted sample, independently of
HEAD reachability. Single-title checks and four-host serial samples share it.
Private evidence cannot enter the bounded general health cache/export. Native
suspend, page hiding, cancel and teardown abort checks and release HLS/media.

`PlaybackResolver` prepares a transport URL before the central service attaches it.
Source identity stays unchanged. Generation/abort guards prevent a late relay
response from replacing a newly selected stream. Credentials and ticket URLs stay
in memory. HTTP receives an actionable failure without an unbounded retry loop.

The optional Node relay binds loopback, requires registered entries/exact origins
and directory scopes, validates/pins DNS for every hop, encrypts expiring resource
tickets and rewrites all supported HLS resource references. It streams media with
backpressure and preserves Range. It introduces no Cloudflare video route or paid
infrastructure. See TRANSPORT.md for allowed protocols, limits and deployment.

General discovery builds its normalized search index once per catalog snapshot;
filter/genre results are memoized and text rendering uses deferred work. Favorite,
progress and volume updates do not rebuild every title's search string. No new
client runtime package was needed for these features.

General-profile transfer reuses the versioned state validator and merges identities,
collections/history/progress and safe session/preferences without importing PINs.
It preserves current navigation, local progress and local collection names, never
unlocks private mode, and rejects pending imports after their screen is disposed.
Sources and personal media retain their separate validated import/export contracts.

## Public catalog updates

`src/domain/catalog-updates.ts` validates a bounded manifest. `src/updates/service.ts`
owns monotonic revisions, endpoint-scoped policy persistence, coalesced requests,
backoff and cancellation; `useCatalogUpdates` owns foreground/private lifecycle.
The service is an explicit instance, never a mutable global policy. The App passes
current rules into queries, episode results and playback, and tears down disallowed
players.

`scripts/update-assets.ts` prepares reviewed source metadata and Vite emits hash-named
JSON files only into the build. Remote provider loading verifies bytes/digests and
reuses one replaceable cache entry per public source. APK packaging excludes extra
release copies. No application-code update, credential transport or new cloud
service is involved. See [publishing, trust and recovery](UPDATES.md).

## Lists, counts and versions

Shuffle and in-player Previous/Next work on the list the current screen shows after its
filters (`browseList` in `App.tsx`, `context` in `usePlaybackActions`). A refreshed source
that returns under 60% of a cached list of ten or more keeps the cached list, so counts do
not drift when a provider answers partially. Language values from playlists and directories
pass through `domain/languages.ts` so names and codes collapse to one label. Descriptions are
clipped at a word boundary (`domain/text.ts`). Settings → About shows the build label
(`config/build.ts`, from `__APP_VERSION__`/`__BUILD_ID__` set in `vite.config.ts`).
