# Running on a TV

**Not yet verified on real TVs.** This was built and tested in desktop Chrome at 1920×1080 with
the keyboard standing in for a remote, and its output is checked to be ES2018. Please try it on
your own sets and report what happens.

## Web (Samsung Tizen, LG webOS, others)

Open the address in the TV's browser (or `https://…/?tv=1` to force the TV layout). Tizen 5.5 and
webOS 5 ship Chromium 69/68; older sets with older engines are not supported.

- Remote keys: arrows, OK, Back (Tizen keyCode 10009, webOS 461, Esc/Backspace), and the media
  keys (play/pause, stop, FF/RW).
- Press OK once on the page before starting from a phone, or accept the "Press OK to start" prompt
  (browsers block autoplay with sound until a key press).
- A server's frame can swallow the remote's keys. The page takes them back every second; if a
  server needs its own keys, use **Video controls** and the phone's Back to return.
- Typing: the TV's on-screen keyboard works in the search box; the phone's keyboard is faster.

## Android TV / Google TV / Fire TV (`android/`)

A WebView host that loads the same app with `?tv=1`. It adds: Back handled by the page first
(`opentv:back`), media keys as DOM events, autoplay without a gesture, system volume
(`{type:"volume", step}`), and bringing the app to the front when a phone starts playback
(`{type:"foreground"}`). Build: `npm run android:debug` (needs JDK 17 and the Android SDK).
The Java was **not recompiled** after this rewrite (the host was left unchanged; only the
license list in `build.gradle` changed), and a phone's `tap` command is sent to the host as
`{type:"tap"}`, which the host does not yet handle.

HTTPS is required for servers here (the app is served from `https://appassets.androidplatform.net`).

## Troubleshooting

| Symptom                                  | Cause                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Blank box in the frame                   | server refuses framing: fix `frame-ancestors` (SERVER_CONTRACT §2)     |
| "Did not respond"                        | wrong address/pattern, mixed content (http server), certificate       |
| Plays but the phone cannot pause/seek    | no bridge on the server (SERVER_CONTRACT §4); use Video controls      |
| Starts muted / "Press OK to start"       | autoplay policy                                                       |
| Phone says "TV is off or offline"        | the TV page is closed, asleep, or cannot reach the relay              |
| QR scan "expired"                        | codes work once for 10 minutes; scan the new one                      |
