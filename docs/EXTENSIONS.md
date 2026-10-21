# Extension files

The app ships with a few clearly licensed sources. Anything else, such as channel lists,
film lists and 18+ lists, comes from **one JSON file that you add yourself**. The file
stays on your device. Open TV contains no list of third-party streams or sites.

## Adding one

- **On a device:** Settings → Sources → **Import extension file**. It is read once and kept
  in this browser's own storage (IndexedDB). Nothing is uploaded. **Replace extension**
  swaps it, **Remove extension** deletes it and its sources.
- **From an address:** Settings → Sources → Extension address → **Load from address**. The
  address must be `https://` with no username or password, and the host must allow browser
  requests (CORS). The file is saved on the device, and each time the app starts it is
  refreshed from the address; if the address cannot be reached the saved copy stays.
  **Refresh** does it on demand. Only the host name is shown, because an address can carry a
  private token.
- **On a deployment:** put the file next to the app as `extension.json` (in `public/`
  before building, or at the site root). The app loads it at start and lists it as
  "served by this site". Do not commit a file like this to a public repository.

Imported sources appear in Settings → Sources, off until you connect them. Sources marked
18+ can be connected only while 18+ content is shown (Settings → Privacy, one
confirmation per device). After that they are ordinary sources: remembered like the
others, kept while 18+ is hidden, and simply out of sight until it is shown again.

On a television, bundle `extension.json` into the app build: a TV has no good file picker.

## Format

```json
{
  "format": "open-tv-extension",
  "version": 1,
  "name": "My extension",
  "sources": [
    {
      "id": "my-news",
      "name": "My news",
      "kind": "m3u",
      "url": "https://example.com/news.m3u"
    },
    {
      "id": "my-films",
      "name": "My films",
      "kind": "m3u",
      "m3u": "#EXTM3U\n#EXTINF:-1 group-title=\"Films\",A film\nhttps://example.com/a.m3u8"
    },
    {
      "id": "my-catalog",
      "name": "My catalog",
      "kind": "catalog",
      "items": []
    },
    {
      "id": "my-private",
      "name": "My 18+ list",
      "kind": "m3u",
      "classification": "adult",
      "url": "https://example.com/private.m3u"
    }
  ]
}
```

| Field                               | Meaning                                                                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`, `version`                 | Must be `"open-tv-extension"` and `1`.                                                                                                                           |
| `name`                              | Shown in Settings. Optional.                                                                                                                                     |
| `sources[].id`                      | Lowercase letters, digits and hyphens, up to 63. Unique. Must not match a built-in source.                                                                       |
| `name`, `description`, `provenance` | Text shown with the source. `provenance` is an https link.                                                                                                       |
| `kind`                              | `"m3u"` (a playlist) or `"catalog"` (Open TV catalog entries).                                                                                                   |
| **one of** `url`, `m3u`, `items`    | A remote https address, the playlist text itself, or the catalog entries themselves. Exactly one per source. `m3u` goes with kind `m3u`, `items` with `catalog`. |
| `classification`                    | `"general"` (default) or `"adult"`.                                                                                                                              |
| `enabled`                           | Kept for the format; the app ignores it. Every source starts disconnected and connects only when you choose it, once, on that device.                            |
| `refreshHours`                      | 1 to 720, default 24, for `url` sources.                                                                                                                         |
| `priority`                          | -100 to 100, default 0. Higher goes first when two sources list the same title.                                                                                  |

A source that cannot be understood is left out. A file with nothing usable is refused with
the reason. Catalog `items` use the same shape the app uses internally (see
`validateContent` in `src/providers/catalog.ts`); ids look like `ot-abc123`.

Limits: 60 MB per file, 500 sources, 15 MB per inline playlist, 100,000 items per catalog.
A source's own `url` must be https; remote lists need CORS or they cannot be read by a
browser.

## Splitting a large extension

A big extension is slow to download and parse. Split it into a small index and data files
next to it; the app reads the index at start and fetches a list only when it is connected.

```sh
npm run extension:split -- extension.json pack     # pack/extension.json + pack/extension-data/
npm run extension:check -- pack/extension.json     # follows the data files and checks them
npm run extension:bundle -- pack/extension.json one-file.json   # back to one file
```

In the index, a source's `url` may be a relative path (`extension-data/europe.json`). It is
resolved against the address the extension was loaded from, and cannot leave that folder. A
catalog file is `{ "items": [ ... ] }`; a playlist file is plain M3U.

- **On a site:** serve `extension.json` and `extension-data/` side by side (in `public/`).
- **From an address:** put both at the same place and load `extension.json` by its address.
- **In the TV app:** `npm run android:debug -- --extension pack` ([Google TV](GOOGLE_TV.md)).
- **As a single picked file:** a file cannot reach its neighbours, so bundle it first. A
  split index imported as a file says which lists it left out.

Large lists are cached by the app like any other source, so later starts download almost
nothing. 18+ files are not cached and are fetched only after you show 18+ content and
connect them.

## Settings in an extension

Besides sources, a file can carry settings. All of these are optional, and a file may have
settings and no sources at all.

```json
{
  "format": "open-tv-extension",
  "version": 1,
  "name": "My settings",
  "musicProviders": [
    {
      "name": "My Invidious",
      "type": "invidious",
      "base": "https://invidious.example"
    },
    { "name": "My Piped", "type": "piped", "base": "https://piped-api.example" }
  ],
  "servers": [
    {
      "name": "My server",
      "base": "https://server.example",
      "guard": "click",
      "enabled": true
    }
  ],
  "guides": [{ "name": "My guide", "url": "https://guide.example/guide.xml" }],
  "tmdbKey": "your TMDB key",
  "profile": { "version": 1, "kind": "open-tv-general-profile", "profile": {} }
}
```

| Field            | Applied                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `musicProviders` | Added to Settings → Music providers, after the ones already there (the order is the order they are tried in).                                                 |
| `servers`        | Added to Settings → Servers. `guard` is `open`, `click` or `sandbox`; `movie`/`episode` set the address format (see SERVERS.md); `enabled` defaults to false. |
| `guides`         | XMLTV guides offered as buttons in Settings → TV guide (they fill the address; you still confirm and connect).                                                |
| `tmdbKey`        | Connected and remembered on this device. Only when a person imports the file.                                                                                 |
| `profile`        | A profile backup (Settings → Backup) merged into the current profile. Only when a person imports the file.                                                    |

Rules that keep this predictable:

- **Added once.** A music instance or server is added the first time it is seen. If you
  remove it, a later refresh does not bring it back. Importing the file yourself adds
  whatever is missing, even if you removed it before.
- **Key and profile need a deliberate import.** A file the site serves as `extension.json`,
  and a silent refresh from an address, apply only music instances and servers. Anyone who
  can open a site can read a file it serves, so never put a key or a profile in one.
- **A settings-only file does not replace** the extension already on the device.
- Music instances are never part of the app itself: Open TV has no default instance.
- **No duplicates.** A server whose address or name is already in your list is not added
  again, however often the file is imported.

### A personal settings file

`personal-extension.example.json` at the root of the repository is a template for your own
TMDB key and servers:

1. Copy it somewhere private (not into `public/` or any site folder), for example
   `my-settings.json`.
2. Replace `YOUR_TMDB_API_KEY` with your key from themoviedb.org (Settings → API). The
   placeholder is recognised and ignored, so a file you forget to fill in applies no key.
3. Replace the two server entries with your own: `name`, `base` (the server's https
   address), `guard` and `enabled`. Servers carry no credentials; remove an entry you do not
   need.
4. Check it: `npm run extension:check -- my-settings.json` should list your servers and say
   `TMDB key: yes`.
5. On each device, import it once: Settings → Sources → Extension → Import extension file.
   The report names what was added, for example "Added 2 servers, your TMDB key." A TV has
   no file picker; send the key and servers from your phone instead (see TRANSFER.md).

The file has no sources, so it does not replace the extension already on the device.
Importing it again later adds no duplicates. Keep it off any public site: it holds your key.

## Making one

Any script can produce the file. Each source is independent, so an extension can be built
from your own lists, an export from another tool, or a mix of remote addresses and inline
playlists. Check that you are allowed to use what you list.
