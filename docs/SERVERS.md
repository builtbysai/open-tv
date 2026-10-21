# Media servers and linked personal media

Settings → Your media servers supports create, rename, address correction,
disconnect/reconnect, removal and undo. Add a server once, then select its name
in Add your media. Provide the server's title identifier and choose Movie,
Documentary, Series episode or Anime. An episode also needs season/episode numbers;
season zero is Specials.

## Address formats

Each server says how it addresses a title. **Address format** in the server form offers
the common layouts, or **My own pattern…** with `{base}` (the server's address), `{id}`,
`{season}` and `{episode}`. A preview shows the exact address for a sample film (TMDB 603)
and episode (TMDB 1396, S1 E1) before you save.

| Format                                                          | Films                     | Episodes                                                   |
| --------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------- |
| `/embed/movie/…` (default, used unless a server states another) | `{base}/embed/movie/{id}` | `{base}/embed/tv/{id}/{season}/{episode}`                  |
| `/movie/…` and `/tv/…`                                          | `{base}/movie/{id}`       | `{base}/tv/{id}/{season}/{episode}`                        |
| `?tmdb=…` query                                                 | `{base}/embed?tmdb={id}`  | `{base}/embed?tmdb={id}&season={season}&episode={episode}` |
| dashes                                                          | `{base}/movie/{id}`       | `{base}/tv/{id}-{season}-{episode}`                        |

A pattern must start with `{base}` and use only those placeholders, so a title can never
be sent to another site. The same `movie` and `episode` fields work in an extension
file's `servers` list and in a servers file.

**Import servers / Export servers** (under Media servers) read and write
`{ "servers": [ { "name", "base", "guard"?, "movie"?, "episode"? } ] }`. Imported servers
start switched off; connect the ones you want. Only servers you are authorized to use
belong here: Open TV adds none by itself.

It does not discover or grant access to a commercial catalog. Your server must
implement its routes and permit embedding. Other server protocols can still use
the direct/embedded URL option; automatic Jellyfin/Plex discovery is not implemented.

## Finding titles in your library

With a TMDB key, Home, Search and title details check your servers by TMDB id. For each
trending, popular and top-rated title (and for anything you open or search) Open TV
requests `{base}/embed/movie/{tmdb id}`, or `{base}/embed/tv/{tmdb id}/1/1` for a show,
from each enabled general server. A successful response means that server has the title,
a 404 or 410 means it does not, and anything else (a server that blocks browser requests,
a timeout, a 5xx) is treated as no answer and the title stays "not in your library".
Titles found become ordinary library entries: they appear under "Popular on your
servers", in Movies & Shows, in Saved and in history, and a movie plays from every
server that has it, falling back in server order. A show lists its seasons and episodes
from TMDB, and each episode plays from `{base}/embed/tv/{id}/{season}/{episode}`.

Background checks stop at the first server that has a title; opening a title asks every
server. At most four titles are checked at a time, and results are remembered on the
device for a day (`opentv:embed-library:v1`). Your server must send
`Access-Control-Allow-Origin` for this site so the browser may read the status.

No server is contacted simply because a definition is added or restored, until a TMDB
key is connected and Home has titles to check. Connected
means enabled in your configuration, not a measured uptime or codec guarantee.
The embedded provider owns controls and playback. Open TV cannot read progress,
recover its decoder, or receive episode-ended events across that origin. Manual
next/previous works for explicitly related episodes; no unrelated server fallback.

## Identity and availability

A `MediaServer` has an opaque stable ID, display name, canonical HTTP(S) base,
classification and enabled flag. `Content.serverId` references it;
`Content.providerItemId` identifies the title in that server. Only alphanumeric,
hyphen and underscore title IDs are accepted. URLs are derived at the domain
boundary by `resolveServerMedia`, not copied independently across screens.

Changing a server address or a title's selected server does not change the title
ID, favorites, collection membership or progress. Episodes use a stable group ID
based on server ID and provider title ID. Changing an address keeps that group;
reassigning an episode to another server intentionally changes its group.

Disconnecting or removing a server keeps its linked title metadata and IDs, with
no streams and unavailable playback. It never silently moves titles to another
server. Undo restores the definition; an individual title can also be reassigned
in My Library → Personal media → Edit. Removed definitions stay in the current
undo control only, so export a backup before leaving if you need later restoration.

Personal-media editing supports title, description, artwork, genres, countries,
languages, release year, runtime, classification, type and episode numbering.
A restricted server's classification applies at query time even if an item says
General. Adult markers in names/genres cannot be downgraded by the form.

## Persistence and privacy

`opentv:servers:v1` stores at most 200 validated, general-audience server definitions.
It is separate from public catalog caches and the personal-media IndexedDB database.
Reads project allowed fields and recover from invalid JSON/records; failed writes
show a notice and leave the current tab usable. Query parameters, fragments and
embedded userinfo are rejected in server bases. Known credential paths, including
credential prefixes without a trailing slash, are never persisted.

Private mode uses an overlay for server additions, edits, connection changes and
removal. Even an explicitly general server edited privately never changes the
saved general configuration. Lock/hidden-tab lock drops the overlay. Private
personal media and copies are likewise memory-only. Source export is disabled
in private mode, and no background health requests expose private server activity.
Safe general drafts retain only opaque server IDs, validated title IDs and metadata;
server, artwork and playback URLs never become session drafts.

Export sources includes safe general server definitions alongside playlists in the
existing version-1 registry JSON. Import source registry accepts the optional
`servers` array, retains IDs, validates each record, and imports servers disconnected.
Connect them explicitly after restoring. Use Export personal media separately for
titles; import both files to restore associations. Catalog-cache clearing does not
delete either server definitions or personal media. Paid services and new backend
infrastructure are not required.

## Checking a server and linked titles

After a server is saved, and from its Check button, the app makes one no-credentials
request to its address and reports Reachable, Not reachable or Can’t be checked from
here (some servers block browser checks). A saved server is never blocked by this check.

Titles linked to a server show the server’s name as their quality label. Where-to-watch
suggestions only appear for titles that are not on one of your servers. Linked titles
whose ID is a TMDB number also join the TMDB shelves. A server re-added under the same
name is a new server: old links are not re-attached.

## Servers without CORS headers

A server does not need to send `Access-Control-Allow-Origin`. The browser still plays its
embed page in a frame, which needs no CORS. For the availability check the app first asks
normally; if the browser blocks reading the answer it asks again with `no-cors`, which only
tells it that the server answered. Such a title is assumed to be there.

A frame from another site cannot be read, so its content or errors cannot be inspected.
What the app can see is whether the frame finishes loading. If it has not loaded after 15
seconds the player says the server did not return the title and offers Try next server
(or Keep waiting). Trying the next server drops the failed one for that title from the
library, so it is not offered again until the daily re-check. A server that answers with
an error page that does load is not detected; a relay that reads the page server-side
would be needed for that.

## Embed protection (per server)

Each server has an **Embed protection** setting. The default is Open, because adding a
server is an act of trust.

| Setting     | What it does                                                                                                                                      | What the embed can tell                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Open        | Plain frame, no restrictions.                                                                                                                     | Nothing to detect.                                              |
| Click guard | A transparent "Click to play" layer sits over the frame. The first click lands on it, not the embed, so it cannot trigger a click-started pop-up. | Nothing: the frame is unchanged.                                |
| Sandboxed   | The frame runs with `allow-scripts allow-same-origin allow-presentation`: no pop-ups, no top-level navigation.                                    | Detectable. Many embeds check for a sandbox and refuse to play. |

### Why pop-ups are hard to stop quietly

- Pop-ups come from `window.open` or top-level navigation inside the embed. A page we do
  not control can only be limited from outside by the `sandbox` attribute, which it can
  see, or by the browser's own pop-up blocker.
- Browsers allow `window.open` only after a user click inside the frame, so a click is
  what the embed needs. That is why the click guard works, and why it does nothing
  against pop-ups started by a timer, which the browser's pop-up blocker already stops.
- Cross-origin frames cannot be inspected or scripted from the app, so closing a pop-up
  after it opens, or filtering what the embed does, is not possible.
- Detection-free options are therefore the click guard and the browser or a content
  blocker on the device. A server that needs a full sandbox bypass cannot be made safe
  from inside the app; use Sandboxed for servers you trust less and accept that some
  will refuse to play.

## Talking to an embedded player

A frame from another site can only be reached with `postMessage`. Sandboxing does not stop
that (messages cross the frame boundary either way), so protection and control are separate
questions. There is no standard for it; Open TV understands the common shapes and does nothing
for a server that stays silent.

| Protocol   | What the server sends                                                                                                                              | What Open TV can do                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `opentv`   | `{ source: "opentv", type: "ready" \| "playing" \| "pause" \| "ended" \| "timeupdate" \| "mute" \| "error" }`                                      | Status, progress and full control (below) |
| `playerjs` | [Player.js](https://github.com/embedly/player.js) events (`ready`, `play`, `pause`, `ended`, `timeupdate`, `error`), sent after Open TV subscribes | Status, progress and full control         |
| `events`   | One-way messages such as `{ type: "PLAYER_EVENT", data: { event: "timeupdate", currentTime, duration } }`                                          | Status and progress only                  |

What a recognized player gets:

- **Progress and resume.** The reported time is saved like a file's, so "Continue watching" and
  Resume work for embeds, and the next episode starts when it ends.
- **Open TV controls.** For `opentv` and `playerjs` players a bar appears under the frame with
  play/pause, skip, a scrubber, time and mute. A remote can steer it without reaching into the
  frame. Turn it off per device in Settings → This device ("Open TV controls for embedded
  servers"); servers that cannot be driven keep only their own controls.
- **Status.** `ready`, `playing`, `timeupdate` clear the "did not return the title" warning;
  `error` or `unavailable` shows your `message` (up to 160 characters) at once and offers Try
  next server.

Commands go to the server's own origin only. For `opentv` they are
`{ source: "opentv-host", type: "command", action: "play" | "pause" | "seek" | "mute" | "unmute" | "volume", value }`;
for `playerjs` they are the standard `play`, `pause`, `setCurrentTime`, `mute`, `unmute` and
`setVolume` methods. A cooperating server only needs:

```js
parent.postMessage({ source: "opentv", type: "ready" }, "*");
parent.postMessage(
  { source: "opentv", type: "timeupdate", time: 12, duration: 5400 },
  "*",
);
addEventListener("message", (e) => {
  if (e.data?.source === "opentv-host" && e.data.action === "pause")
    player.pause();
});
```

Only messages from the frame that is playing are read; anything else is ignored.

### Make your server remote-ready

With those few lines a server also works fully from a phone (Play on TV): pause, resume,
seek, the position on the phone's remote bar, and "Continue on this device". Without
them the TV can only open and close the server's page; the phone says the TV can't do
that with this player. Send `ready` once, `playing`/`pause` when they change,
`timeupdate` every few seconds, `ended` at the end, and act on `play`, `pause` and
`seek` (value in seconds) commands.

A television remote cannot press buttons inside someone else's page. When a server cannot be
driven, the keys go to the frame once it has focus, and Back closes the player as usual.

## Linked titles and several servers

A personal title linked to a server by a TMDB number is offered on every other connected
general server too, with the linked server first. Titles addressed any other way (an IMDb
code, say) stay on the one server. Two servers cannot share a name, and removing a server
that has linked titles asks first.
