# Music

**Music** sits beside Audio. It searches songs and plays them through the normal audio
player, queue, mini-player and visualizer. Songs come from **music providers**: the
Internet Archive is built in, so Music works before anything is set up, and other public
services can be added by address. Open TV has no proxy and no accounts, and Music plays
audio, not video.

## Providers

### Internet Archive (built in)

The Internet Archive's audio collections, the Live Music Archive (`etree`) and
`opensource_audio`, are openly licensed and served as plain HTTPS files with CORS, with no
key and no account. Search asks `archive.org/advancedsearch.php` (`output=json`, audio and
etree items, matching title, creator or subject, most downloaded first, 30 rows); the
trending row is the Live Music Archive's most played shows this week. A result is a whole
item (a concert or an album); when it plays, `archive.org/metadata/{id}/files` picks its
first track, as MP3 with Ogg as the fallback, and the player gets the direct
`https://archive.org/download/{id}/{file}` address. It is not stored in settings and is
always tried after the providers below. Playlists are not available from it.

### Added by you

Settings → Sources → **Music providers**. Each has a name, a type and an address:

| Type      | Address to enter                                 | Calls used                                                                                                                 |
| --------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Invidious | The instance address                             | `/api/v1/search`, `/api/v1/videos/{id}?local=true`, `/api/v1/trending?type=music`, `/api/v1/playlists/{id}`, `/embed/{id}` |
| Piped     | The instance's **API** address (not its website) | `/search?filter=music_songs`, `/streams/{id}`, `/trending` (as a music search), `/playlists/{id}`                          |

Saving is instant and a health check runs right after: one real request, with its result
and age remembered. Instances come and go, so the address can be edited or replaced at any
time without changing code.

The list order is the order they are tried in. Invidious and Piped instances stand in for
each other: if one fails or has no audio, the next is used; a provider that fails three
times in a row is skipped for two minutes. Search and trending ask each kind of service at
once (Invidious/Piped, Audius, the Internet Archive) and mix their answers; every song is
labelled with the provider it came from, and one kind failing leaves the others. When none
answer, Music says so and points at the addresses. Providers can be turned off without
deleting them.

An extension file can list providers too (`musicProviders`), so one file sets up every
device. See [extensions](EXTENSIONS.md).

### Audius

Audius is an open music service whose API needs no key and allows browser requests, so it
works from any site. Add it from the Music screen ("Use Audius") or Settings → Music
providers with the address `https://api.audius.co`. Songs are independent artists' uploads;
lyrics and album details still come from LRCLIB and MusicBrainz when found.

### Which Invidious and Piped instances work

A browser app can only use an instance that has its API turned on **and** allows requests
from the site's address (CORS). Most large public Invidious instances turn the API off or
block other sites, and a public list marks this as `api: false` / `cors: false`. The health
check in Settings says which it is: "API turned off", "does not allow this site (CORS)",
"offline", or "not music data". The dependable setup is an instance you run or one whose
operator allows your site. Keep several in the list; they are tried in order.

## Playing

Tapping a song hands a placeholder address to the player, which resolves the audio when
its turn comes (so queued songs do not hold a short-lived address). Streams are ranked AAC,
then Opus, then the rest. If direct audio fails, **Open the player page** shows the
provider's embed (Invidious) or the video host's privacy-friendly embed (Piped).

Search results, a trending row and **Play a playlist** (an address containing `list=…`, or
the ID) queue songs. Songs you play appear in Listen again and History.

## Lyrics and album details

When a song starts, two lookups run: [LRCLIB](https://lrclib.net) for synced lyrics, and
[MusicBrainz](https://musicbrainz.org) with the Cover Art Archive for the album, its art and a
line about the artist. The player shows a **Lyrics / Visualizer** toggle when lyrics exist; the
karaoke view highlights the line being sung. Both lookups send the song's title and artist to
those sites; a setting under Music providers turns them off. A miss shows nothing.

## Limits

- Playback depends on the provider instance and on what it is allowed to serve.
- An Internet Archive result plays its first track only; the item's other tracks stay on the
  Archive.
- The visualizer needs the audio address to allow this page to read it (CORS); otherwise the
  player shows its plain state.
- Music is hidden on Kids profiles.
