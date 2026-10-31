# Architecture

One static web app, two roles chosen at start-up, and a small relay between them.

```
 web (role "web")                              TV (role "tv")
 ┌──────────────────────────┐                      ┌──────────────────────────────┐
 │ WebApp: browse, watch, │   WebSocket (relay)  │ TvApp: screens, spatial nav  │
 │ remote, setup            │◄────────────────────►│ PlaybackSession ─► renderer  │
 │ Controller               │  commands / state /  │ TvHost            │          │
 └──────────────────────────┘  encrypted sync      │                   ▼          │
            ▲                                       │          <iframe> (server)   │
            └── scans the TV's QR ───────────────── │             ▲  postMessage   │
                                                    └─────────────┴────────────────┘
```

Role: `?tv=1`/`?role=` → saved choice → TV user-agent (Tizen, webOS, Android TV, Fire TV, …) →
otherwise web (the website: it browses and plays in the browser itself, and is the remote when a TV is paired). The Android host loads `index.html?tv=1`.

## Layers (each knows only the ones below it)

| Folder             | What it is                                                                  |
| ------------------ | --------------------------------------------------------------------------- |
| `src/core`         | `module.ts` (the extension contract), env detection, storage, crypto, LWW merge |
| `src/modules/*`    | content modules. `movies` = TMDB + your servers                             |
| `src/player`       | `bridge.ts` (protocol), `frame.ts` (one frame), `session.ts`, renderers     |
| `src/remote`       | `protocol.ts` (shared with the relay), relay client, pairing, sync, TV host, phone controller |
| `src/app`          | synced data, wiring, hooks                                                  |
| `src/tv`, `src/web` | the two UIs. `web` = hash router, home/search/title/watch pages, remote, setup |
| `control/`         | the relay: `core.ts` (rules), `worker.ts` (Cloudflare), `node.ts` (dev/tests) |

## Adding a module (live TV, radio, music, …)

Nothing in the relay, the protocol, sync or the player changes.

1. **Create `src/modules/<name>/index.ts`** returning an `AppModule` (`src/core/module.ts`):
   `id`, `label`, `sections` (extra top-bar destinations), `ready()`, `rails(section)`,
   optional `search`, `details`, `episodes`, `next`, and `sources(ref)` that returns how to play it.
2. **Everything it returns is a `MediaRef`** — `{mod, kind, id, title, …}`. That small JSON
   object is what crosses the relay, is stored in My List and history, and is validated by
   `parseRef` on the other side. Keep module-specific data inside `id`/`kind`.
3. **Register it** with one line in `src/app/runtime.ts` (`registry.register(...)`). Its
   settings are plain keys in the synced document (`cfg:<mod>:…`, `pref:…`), merged
   last-writer-wins and encrypted in transit.
4. **Play it.** A source is `{type:"embed", url, …}` (works today) or `{type:"stream", url,
   format}`. For a new kind, register a renderer in `src/player/renderers.tsx`: a component that
   calls `session.attach/setState/setStatus` the way `EmbedPlayer` does. The TV HUD, the phone
   remote, progress saving and Up next then work unchanged.
5. If it needs a screen the generic rails and details do not cover, add a route in
   `src/tv/state.ts` and a screen; the remote's D-pad already drives any `data-f` element.
6. For direct streams, relax `media-src 'none'` in `public/_headers` (it is `none` while only
   frames are used).

## TV constraints that shaped the code

- Engines as old as Chromium 68: ES2018 output, no newer APIs or CSS (`npm run check:compat`
  scans the source and checks the bundle with es-check). No service worker. Hash routing.
- Everything is reachable with arrows, OK and Back: every control is `data-f`, movement is by
  geometry (`src/tv/nav.ts`), Back is a stack of handlers, and the page keeps the keyboard so
  the remote reaches us. The page reclaims it if a frame grabs it.
- Layout is in `rem` with `1rem = width/120`, so one layout fits 720p–4K.
- The home screen is unmounted while a video plays, to save memory on weak TVs.

## Data and privacy

- `otv:doc` (localStorage) holds the TMDB key, servers, preferences, My List and progress as a
  last-writer-wins map with 30-day tombstones. Phones and the TV exchange it **encrypted
  with AES-GCM**; the key lives only in the QR link's `#fragment` (never sent to any server), so
  the relay carries ciphertext it cannot read.
- TMDB requests carry the key and nothing else (`referrerPolicy: no-referrer`, no cookies).
- Servers see the app's origin as Referer (by design, see SERVER_CONTRACT.md) and nothing else.
