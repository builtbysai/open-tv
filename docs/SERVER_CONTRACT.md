# Server contract

What a server must do so Open TV can show it, and what Open TV can and cannot do to it. A
"server" here is your own site that returns a player page for a title.

## 1. Addresses

Open TV never lists or finds servers. You add one, with a base address and (optionally) a pattern.

| Default pattern                               | Example                                          |
| --------------------------------------------- | ------------------------------------------------ |
| `{base}/embed/movie/{id}`                     | `https://play.example.com/embed/movie/603`       |
| `{base}/embed/tv/{id}/{season}/{episode}`     | `https://play.example.com/embed/tv/1396/1/2`     |

`{id}` is the TMDB id. Other placeholders: `{season}`, `{episode}`, `{start}` (resume point in
seconds). Presets for `/movie/…`, `?tmdb=…` and `/tv/{id}-{s}-{e}` are in the form; any other
shape is a custom pattern.

Rules (enforced when saving and again when building each address):

- A pattern must begin with `{base}`, then `/` or `?`; letters, digits and `- . _ ~ / ? = & % { }`
  only. No `:` or `@`, so a pattern cannot add a port or credentials.
- The finished address must have **the same origin as the base**. A pattern cannot send the TV
  somewhere else.
- `{id}` accepts `A-Z a-z 0-9 _ -` up to 100 characters.
- https is required, except `localhost`/`127.0.0.1` for development. This is not a style choice:
  an https page cannot show an http frame (mixed content), and the browser refuses silently.
- A server on the same origin as the app is refused (it would not be a separate server).
- An invalid pattern rejects the whole server record instead of silently falling back, so a
  title is never sent to an address its owner did not write.
- Imported lists start **disabled** with fresh ids, so importing never contacts anything.

## 2. Being allowed in a frame (the part that most often goes wrong)

The TV app shows your page in an `<iframe>`. The browser, not Open TV, decides whether that is
allowed, from headers **your server** sends:

```
Content-Security-Policy: frame-ancestors https://tv.builtbysai.com https://appassets.androidplatform.net
```

- `https://tv.builtbysai.com` is the web app; `https://appassets.androidplatform.net` is the
  Android TV app (its WebView serves the app from that address). If you host the app yourself,
  use your own address. For local development add `http://localhost:4173`.
- **Do not** send `X-Frame-Options: DENY` or `SAMEORIGIN`; they cannot name another site.
- `frame-ancestors` is how *you* decide who may embed you. Without it (and without
  X-Frame-Options) any site can embed you.
- **Open TV cannot detect a refused frame.** The browser fires the frame's `load` event for the
  error page too, and cross-origin pages cannot be inspected. The only proof the page is a
  player is that it speaks the bridge (section 4). That is why the phone's **Test this server**
  shows you the page itself: if the box is blank or shows an error, fix the headers.
- Cookies inside the frame are third-party cookies. If your player needs a login or a cookie it
  sets, set them `SameSite=None; Secure` (and expect browsers that block them to fail).
- A redirect to another origin takes the page out of reach of the bridge (messages are only
  accepted from the configured origin). Serve the player from the origin you configured.

### What Open TV puts on the frame

```html
<iframe src="https://play.example.com/embed/movie/603"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        referrerpolicy="origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"> <!-- only if the server's sandbox switch is on -->
```

- `referrerpolicy="origin"`: you receive `Referer: https://tv.builtbysai.com/` (origin only, never
  what is being watched), so you can allow-list by Referer as well as by `frame-ancestors`.
- `allow=…` delegates autoplay, fullscreen, DRM and picture-in-picture to your page.
- A **fresh frame is created for every server and every retry**; `src` is never changed on a
  live frame. Changing it would add entries to the browser's history and make the TV's Back
  button wander through them.

### Sandbox

Off by default, per server. When on, the frame gets `allow-scripts allow-same-origin
allow-presentation allow-forms` and nothing else:

| Blocked by the sandbox           | Why it is useful                                   |
| -------------------------------- | -------------------------------------------------- |
| pop-ups and new tabs             | stops ad pop-ups hijacking the TV                  |
| navigating the top page          | the page cannot send the TV app to another site    |
| modals (`alert`, `confirm`)      | a modal would freeze the TV UI                     |
| downloads, pointer lock          | not needed for playback                            |

`allow-same-origin` is on so the player can use its own storage and cookies; it is safe because a
server can never share the app's origin (section 1). Some players detect the sandbox and refuse
to play; that is why the switch exists.

## 3. Autoplay

Browsers only autoplay with sound after a user gesture. On a TV browser, one press of the remote
on the Open TV page counts, and Open TV delegates it with `allow="autoplay"`. If playback is
started from a phone before anyone has pressed anything on the TV, the TV shows **Press OK to
start**. The Android TV app removes the rule entirely.

## 4. The bridge: letting Open TV control your player

A cross-origin frame cannot be scripted and **never passes keyboard events to its parent while it
has focus**. The only channel is `postMessage`. Without it Open TV can show your page and nothing
more: no pause or seek from the phone, no progress, no resume, no "Up next".

Add one line to your player page:

```html
<script src="https://tv.builtbysai.com/bridge/opentv-embed.js"></script>
```

(or copy `public/bridge/opentv-embed.js`; it has no dependencies). It finds the `<video>` and
speaks the protocol below. For a custom player define `window.OpenTVPlayer` first (see the file).

### Protocol v1

Page → app:

| Message                                                                    | When                                          |
| -------------------------------------------------------------------------- | --------------------------------------------- |
| `{opentv:1, type:"ready", caps:{seek:true, volume:true, mute:true}}`       | the player exists (and when asked, see below) |
| `{opentv:1, type:"state", playing, buffering, time, duration, volume, muted}` | on change, and at least once a second       |
| `{opentv:1, type:"ended"}`                                                 | playback finished                             |
| `{opentv:1, type:"error", code}`                                           | the media failed                              |
| `{opentv:1, type:"key", key:"back"\|"menu"\|"up"\|"down"\|"left"\|"right"\|"ok"}` | a key the page does not use itself      |

App → page:

| Message                                                                      |                                              |
| ---------------------------------------------------------------------------- | -------------------------------------------- |
| `{opentv:1, type:"hello"}`                                                   | "are you there?" (repeated once a second until `ready`, up to 15 times) |
| `{opentv:1, type:"cmd", cmd:"play"\|"pause"\|"toggle"\|"mute"\|"unmute"}`    |                                              |
| `{opentv:1, type:"cmd", cmd:"seek", value:seconds}` / `"seekBy"` (± seconds) |                                              |
| `{opentv:1, type:"cmd", cmd:"volume", value:0..1}`                           |                                              |

Rules both sides follow:

- The app **accepts messages only** from that frame's window **and** the configured origin, and
  posts only to that origin, never `"*"`. (A lint rule forbids `"*"`; the one exception is the
  bridge file, which uses it only if the browser will not say who the parent is.)
- The page accepts commands only from `window.parent`, and from the parent's origin when it is
  known (`location.ancestorOrigins`, else the Referer origin).
- Everything received is untrusted: it is reduced to a small closed shape or dropped.

### Players that already speak something else

Open TV also understands, without any change on your side: the earlier `{source:"opentv"}`
messages; **Player.js** (`context:"player.js"`: events, plus play/pause/seek/volume/mute); and
one-way `PLAYER_EVENT` progress messages (you get progress and resume, but no remote control).

### What the TV does with what it learns

| The frame…                                              | The TV…                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| answers `hello` with `ready`                            | shows pause/seek/volume, the progress bar, resume and up-next        |
| is marked "verified" (the test passed) but stays silent for 12 s | treats the server as failed and offers **Try next server** |
| is not verified and stays silent for 6 s                | assumes it plays, hides the controls, and offers **Video controls**  |
| fails to load for 20 s                                  | offers **Try next server**                                           |

**Video controls** hands the TV's keyboard to the frame, so the remote's own keys drive your
player. The phone's **Back** takes the keyboard back.

## 5. Checklist

1. `/embed/movie/{tmdb id}` and `/embed/tv/{tmdb id}/{season}/{episode}` return a player page.
2. `Content-Security-Policy: frame-ancestors …` names the app (and no `X-Frame-Options`).
3. https, with a certificate the TV trusts (old TVs may lack newer root certificates).
4. The page starts playing by itself (`autoplay`), starting muted if it must.
5. One `<script>` tag for the bridge.
6. Run **Test this server** on the phone and read the result.
