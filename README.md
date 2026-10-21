# Open TV

A static, privacy-conscious player for live television, films, series, radio and music
from sources you choose. Vite, React and TypeScript, served as a static site. No backend,
account or paid service is required.

## Run

Node 24 LTS (22.12 minimum) and npm.

```sh
npm ci
npm run dev       # http://localhost:5173
```

Keys, logins and server addresses are entered in Settings and never compiled into the build.

```sh
npm run check             # types, lint, unit tests, production build
npm run test:e2e          # browser workflows (npx playwright install chromium first)
npm run build:site        # build for the sub-path address in site.config.json
npm run verify:deployment # read-only checks against a deployed site
npm run android:debug     # optional Google TV APK (Android SDK required)
```

The site name and address live in [`site.config.json`](site.config.json); see
[deployment](docs/DEPLOYMENT_CHECKS.md).

## What it does

- **Home** leads with trending titles from TMDB once you connect a key, or with openly
  licensed films without one. Titles are checked against your media servers by TMDB id, so
  what you have is playable and the rest shows where to watch, with a wishlist.
- **Live TV** with language, country and category filters, an optional XMLTV guide and
  channel-number entry. Free news channels are built in.
- **Listen** has two tabs: **Radio & audio** (SomaFM, Radio Browser, Internet Archive audio and
  your own files) and **Music** (search and trending through the built-in Internet Archive,
  plus Audius or an Invidious or Piped instance you add, with synced lyrics and album art). Both use the same visualizer, queue and
  docked mini-player. See [music](docs/MUSIC.md).
- **Movies & Shows**, **My Library**, ranked **Search**, similar titles, Play/Resume and Up
  next. NASA and Internet Archive collections add public-domain footage.
- **Sources:** M3U playlists, Xtream, Jellyfin and Emby accounts, media servers, personal
  media, TMDB, XMLTV, and [extension files](docs/EXTENSIONS.md).
- **Profiles** without accounts (including Kids), **phone setup** by QR, a one-file backup,
  and an Android TV / Google TV app.
- **Play on TV**: pair a phone with the TV once, choose on the phone and the TV plays it;
  the phone is the remote. A small Cloudflare Worker relays control messages only
  ([how it works](docs/REMOTE.md)).
- **18+ content** is hidden until you show it in Settings (one confirmation per device), stays
  in memory, and can have a PIN.

## Extensions

The app ships with a few clearly licensed sources. Channel lists, film lists and 18+ lists
come from an **extension file**: one JSON file you import in Settings → Sources, load from an https address, or drop in
as `extension.json`. It stays on your device. The format is in
[docs/EXTENSIONS.md](docs/EXTENSIONS.md).

## Content and rights

A listing is not a distribution license. Regional limits, CORS, codecs and outages can
prevent playback, and Open TV does not bypass DRM, paywalls or geography. See
[sources](docs/SOURCES.md), [copyright reports](docs/TAKEDOWN.md) and
[age assurance](docs/AGE_ASSURANCE.md).

## More

[All guides](docs/README.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Third-party licenses](THIRD_PARTY.md)
