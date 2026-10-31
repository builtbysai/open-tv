# Open TV

A TV-first app for **your own** servers and TMDB. It shows what TMDB knows, plays through
servers you add, in any browser or on a TV, and turns your phone into the remote.

- **TV**: browse with a remote (arrows, OK, Back). Posters, hero, rails, seasons, My List,
  resume, Up next, switch server.
- **Web** (phone, tablet, desktop): browse, search, open a title and **watch right in the browser**
  (keys: Space/K, ←/→ ±10 s, M, F, N). Links work as deep links (`#/t/…` title, `#/w/…` watch).
  Scan a TV's QR code to switch to using it as a remote, keyboard and catalogue. It also holds your
  setup (TMDB key, servers), keeps the TV in step end-to-end encrypted, and can back up / restore it.
- **Servers**: yours only. Default addresses `{base}/embed/movie/{id}` and
  `{base}/embed/tv/{id}/{season}/{episode}`, with presets and custom patterns. Open TV ships none.
- **Controlling a frame**: a page in another site's frame cannot be scripted and never gets the
  remote's keys. One `<script>` tag on your player page lets Open TV pause, seek and read
  progress (`docs/SERVER_CONTRACT.md`).
- **Extensible**: movies are one module. Live TV, radio, music… are more modules, with no change
  to the relay, protocol or player (`docs/ARCHITECTURE.md`).

## Run it

```
npm install
npm run dev            # http://localhost:5173 (website); add ?tv=1 for the TV layout
npm run relay:dev      # a local relay on ws://127.0.0.1:8787, then: VITE_RELAY_URL=ws://127.0.0.1:8787 npm run dev
npm run check          # typecheck, lint, unit tests, build, TV-compatibility check
npx playwright test    # end to end: the website, a phone and a TV, mock TMDB, mock servers, the relay
```

You need a free TMDB key (themoviedb.org → Settings → API). Deploying the relay: `docs/REMOTE.md`.
Android TV build: `docs/TV_DEVICES.md`.

## Docs

`docs/SERVER_CONTRACT.md` · `docs/ARCHITECTURE.md` · `docs/REMOTE.md` · `docs/TV_DEVICES.md` · `THIRD_PARTY.md`

This product uses the TMDB API but is not endorsed or certified by TMDB.

Deploying the site: push to `main`; `.github/workflows/pages.yml` publishes `dist` to GitHub Pages
(Settings → Pages → Source: GitHub Actions). Any static host works; `public/_headers` carries the
security policy for hosts that read it, and the build embeds it as a meta tag for those that don't.
