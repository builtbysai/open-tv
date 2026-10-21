# Open TV on onn Google TV

The Android TV app bundles the repository's viewer into an installable APK. It appears
as **Open TV Preview** in the television's Apps list, works without a mouse, and uses
the same source adapters, library and bounded player service as the web viewer. It does
not load a website at startup. Application code changes arrive in a new APK; public
catalogs and restrictions can be updated from an operator-controlled HTTPS manifest, see
[updates](UPDATES.md). [Guide setup](EPG.md) explains session-only XMLTV connections.

The minimum is Android TV / Google TV **Android 8.0 (API 26)**, with an up-to-date
Android System WebView. The package contains no architecture-specific native libraries,
so there is no ARM32/ARM64 choice. Codec support, document pickers and debugging options
vary by model and firmware; check **Settings → System → About** for yours. This is a
sideloaded preview, not a Google Play app, and real-device playback is a release gate.

## Bundle an extension

An [extension](EXTENSIONS.md) can be built into the APK, so a TV has its lists with no
network and with nothing to import (a TV has no good file picker):

```sh
npm run android:debug -- --extension /path/to/pack   # a folder with extension.json (+ extension-data/)
```

The pack is checked, copied into the build, and ends up inside the APK only; it is never
written to the repository. Anyone who holds the APK can unzip it and read the pack, so this
keeps it out of the repository, not out of the APK.

The `Android APK` workflow does the same on GitHub: start it by hand, with secrets
`EXTENSION_URL` (a download link to a `.tgz` of the pack) and `APK_PASSPHRASE` (the APK is
encrypted before it is uploaded, because artifacts of a public repository are public).
Decrypt with `openssl enc -d -aes-256-cbc -pbkdf2 -in app.apk.enc -out app.apk`.
Building on your own computer needs none of this.

## Get the APK

No APK is stored in the repository. Build one (see [Build and update
locally](#build-and-update-locally)); it is written to the ignored `artifacts/android/`
together with a checksum and build metadata. SHA-256 detects a corrupted copy; the APK's
signing certificate establishes which key signed an update.

For a file-manager install, copy the APK using a trusted file-transfer method or
USB storage supported by your particular box. Open it using a compatible file
manager and grant **Install unknown apps** only to that installer if prompted.
Google TV's menu wording differs between firmware versions. Keep Play Protect
enabled. If it reports a problem, stop and inspect the package rather than
turning protection off. Some onn models have no usable USB data connection;
do not assume the power connector can carry files or ADB.

For a repeatable computer-assisted install, use ADB:

1. Install Google's free [SDK Platform Tools](https://developer.android.com/tools/releases/platform-tools)
   on your computer. Put the computer and TV on the same trusted local network.
2. Enable Developer options on the TV by selecting **Android TV OS build**
   repeatedly (usually seven times) in About. Open Developer options. Enable the
   debugging option available on that firmware and explicitly authorize your
   computer on the TV.
3. On **TV Android 13+**, look for **Wireless debugging → Pair device with pairing
   code**. If provided, run the commands below using the exact addresses and
   ports shown on your TV. The pairing port and connection port are different.

```sh
adb pair TV_IP:PAIRING_PORT
# Enter the code displayed on your TV when prompted.
adb connect TV_IP:DEBUGGING_PORT
adb devices
```

Older firmware may offer authorized network ADB instead of code pairing. Use only
the address/port shown or documented by that device; `5555` is only an example,
not a universal onn setting. USB debugging requires a data-capable connection
supported by the model. Do not scan your network or expose debugging to the
internet. If the TV offers neither method, use the file-manager route above.

Install on the exact connected device from `adb devices`:

```sh
adb -s TV_IP:DEBUGGING_PORT install -r open-tv-google-tv-preview.apk
adb -s TV_IP:DEBUGGING_PORT shell am start -n com.builtbysai.opentv.debug/com.builtbysai.opentv.MainActivity
```

These commands also work in PowerShell. From the repository on macOS/Linux:

```sh
scripts/install-google-tv.sh artifacts/android/open-tv-google-tv-preview.apk TV_IP:DEBUGGING_PORT
```

The helper requires an already authorized, explicitly selected device. It never
uninstalls the app, clears data or enables debugging. Find **Open TV Preview** in
the Apps list afterward; add it to the favorite apps row using Google TV's normal
app-management controls. Disconnect ADB and turn debugging off when finished.

`install -r` preserves app data only when the package ID and signing key match.
An update signed by another developer's debug key will be rejected. **Do not
uninstall to fix that error without exporting data first**: uninstalling deletes
the local profile and library. This preview uses `.debug` so a future stable app
can coexist. Moving to that stable package requires explicit export/import.

## The TV as a receiver

The TV opens on its **idle screen**: whether it can reach the control relay, which
phones are paired, and a QR code to pair one. Choosing and searching happen on the
phone; **Play on TV** starts the title here and the phone becomes the remote. See
[Play on TV](REMOTE.md). **Browse on this TV** opens the menu for when no phone is at
hand. There is no typing on the TV: no search screen and no on-screen keyboard, and
Settings keeps only what a remote can use.

**Playback the user started is never paused by the app.** The host reports what the
page plays but does not veto it: a refused audio-focus request is noted, not turned
into a pause, and coming back to the app never injects a pause. Only an interruption
that begins while something is already playing pauses it: another app or the assistant
taking the speakers, or leaving the app. Focus returning never resumes by itself.

**After a restart.** A boot receiver reopens Open TV after the TV restarts or loses
power (Settings → This device → Open when the TV starts; on by default), so paired
phones find it again. The app must have been opened once. Android 10 and later restrict
starting an activity from the background: the receiver starts a short foreground
service that opens the app. Some Google TV builds still refuse that launch; allowing
**Display over other apps** for Open TV (Settings → Apps → Special app access, or
`adb shell appops set com.builtbysai.opentv SYSTEM_ALERT_WINDOW allow`) lets it through.
Verify on the TV itself; an emulator is not representative. A phone sees the TV as
available only while the app is running: there is no waking a sleeping TV.

## Remote controls

| Control                              | Action                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Direction pad                        | Move the visible focus between navigation, cards, forms and controls. Rails scroll to the focused item.                         |
| OK / Select                          | Open a title, activate a button, toggle a checkbox, or open a native choice list.                                               |
| OK on the video                      | Play/pause.                                                                                                                     |
| Left / Right on the video            | Seek backward/forward 10 seconds within the media's seekable window. A non-seekable live stream cannot rewind.                  |
| Down from the video                  | Reach transport, quality, audio, subtitles, sleep and channel/episode controls.                                                 |
| Play/Pause, Play, Pause, Stop        | Control playback; Stop closes the player. Hardware delivery depends on the remote/firmware.                                     |
| Media next/previous, Channel up/down | Switch through the current allowed channels or episodes when available.                                                         |
| Fast forward / Rewind                | Seek 10 seconds; held media seek keys may repeat.                                                                               |
| Back                                 | Close playback or a dialog; return focus to the menu; return Home; then the idle screen; on the idle screen, exit to Google TV. |
| Home / Volume / Mute                 | Google TV and the connected audio device handle these normally.                                                                 |

The current screen remains selected in navigation when Back returns focus.
Favorites and collection controls are in title details. Every visible player control
is reachable with the direction pad alone (a remote without media keys has no other
way to press them); a screen always opens with focus on its first control. Notices
leave by themselves after a few seconds and never take focus. The only number entry on
the TV is the optional 18+ PIN, which uses the system number pad.
The Google TV Assistant button and branded app buttons are system functions;
this app does not remap them or register global Assistant search. Chromecast
receiver support is not implemented. The preview now connects foreground playback
to Android MediaSession and audio focus. It pauses on interruptions and never
automatically resumes on focus gain. Private titles are redacted and the app-owned
private session is not advertised to the system.

## First run and transferring sources

Launch restores your saved screen (Home on a new profile). It never automatically
resumes audio. Use Settings & Sources to add
an authorized playlist, a reusable media server, personal media or an Xtream
account. Existing public catalogs are bundled and cached; playback
still needs the internet and source permission. To test the layout in a desktop
browser, add `?tv=1` before the hash, for example `/?tv=1#/home`.

Android app storage is separate from Chrome and the hosted website. Export the
general source registry and personal media from the web viewer, then use the
matching import controls in the TV app. JSON file imports/exports use Android's
document picker without broad storage permissions. Some TV firmware has no
document provider; URL-based setup remains available, but file import/export
requires a compatible picker. Use **Export general profile** / **Import general profile** to transfer favorites,
named collections, history and progress separately. Merge preserves this device’s
PIN and existing local progress/collection names. PINs, age admission and credentials
never transfer; set/reconnect those on the TV. Source/media exports alone are not
a complete profile backup.

Provider credentials and private activity remain in memory. Reconnect accounts
after leaving/locking private viewing. Backgrounding pauses direct playback and
locks private mode; returning never deliberately resumes audio. A private file
import is canceled if opening the picker backgrounds/locks its screen. General
imports and exports remain available. Optional PIN protection is a shared-device
control, not jurisdiction-specific identity verification. System backup and
device-to-device extraction are disabled for app data.

## Build and update locally

Install Node 24 LTS, a JDK 17+ supported by Gradle (tested with JDK 21), Android
SDK Platform **36**, Build Tools **35.0.0**, and Platform Tools. Set `JAVA_HOME`
and `ANDROID_HOME`, or put the SDK path in ignored `android/local.properties`:

```properties
sdk.dir=/absolute/path/to/Android/Sdk
```

```sh
npm ci
npm run check
npm run test:e2e
npm run android:debug
```

The final command builds the viewer, runs Android `assembleDebug` and `lintDebug`,
then writes:

```text
artifacts/android/open-tv-google-tv-preview.apk
artifacts/android/SHA256SUMS
artifacts/android/BUILD_INFO.json
```

Gradle 8.13's wrapper distribution is SHA-256 pinned. AGP 8.13.2 and AndroidX
WebKit 1.15.0 are the only direct Android build/runtime additions. SDK licenses
must be accepted locally. No recurring Android CI, paid service, Play developer
account or hosting configuration change is required to build/sideload.

The debug APK uses your build machine's normal `~/.android/debug.keystore`.
Keep that key outside source control if you need matching preview updates;
another build machine's key will differ. No signing key is included in this
repository or download. A production release needs an owner-controlled,
backed-up release key, an incrementing versionCode and a reviewed signing
process. Do not distribute a debug key as a production signing key.

## Architecture, safety and remaining device checks

The host serves bundled assets through AndroidX `WebViewAssetLoader` at
`https://appassets.androidplatform.net`. It applies the viewer's CSP and other
security headers; file/content access, universal file access, WebView mixed
content, camera/microphone requests and automatic popups are disabled. The
origin-scoped main-frame message bridge permits bounded JSON backups through a
user-selected document URI, sanitized playback state/intent, and a private-window
flag. It cannot read files, execute commands or configure remote destinations.
Embedded external frames receive no bridge. WebView inspection is debug-only.

HTTPS streams still depend on CORS, the device's codecs, DRM rules and regional
availability. The host adds no proxy or DRM workaround. Existing HTTP sources
remain in the catalog but are blocked by the secure Android host. Prefer an
authorized HTTPS endpoint.
External watch links open a supported system app/browser if installed, otherwise
show a phone/computer fallback message. Cross-origin embedded players own their
controls and may require a mouse or fail on TV.

Before treating this as a TV release, verify on the actual onn model:

- Install, launcher banner, cold start, update with the same key, and safe exit.
- Entire D-pad path through Home, search, source forms, PIN and system keyboard;
  no focus traps in native selects, file pickers, fullscreen or provider frames.
- A permitted real HLS channel and film; quality, audio/subtitles, seeking,
  channel/episode changes, interruption recovery and sleep timer.
- Background/Home/standby, network loss, private lock and no unexpected autoplay.
- Real screen overscan, 720p/1080p/4K density and slower-device performance.

The host maps trusted root links back to bundled index.html and uses explicit suspend/resume events for update checks.
Native MediaSession and audio focus need real-device validation. Private mode uses a secure window and hides the view on background
until locking completes. Native Media3 playback, Assistant discovery, a Cast receiver, in-app external watch
browsing and Google Play certification are not part of this app.

## Primary platform references

- [Android TV app prerequisites, launcher and banner](https://developer.android.com/training/tv/get-started/create)
- [D-pad and Back navigation](https://developer.android.com/training/tv/get-started/navigation)
- [TV app quality requirements](https://developer.android.com/docs/quality-guidelines/tv-app-quality)
- [TV playback and MediaSession](https://developer.android.com/training/tv/playback)
- [Safe local content in WebView](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)
- [ADB pairing, supported TV versions and install/update commands](https://developer.android.com/tools/adb)
- [Google TV normal app installation](https://support.google.com/googletv/answer/10050570)
- [Android TV Play Protect](https://support.google.com/androidtv/answer/12188351)
- [AGP 8.13 build compatibility](https://developer.android.com/build/releases/agp-8-13-0-release-notes)
- [AndroidX WebKit releases](https://developer.android.com/jetpack/androidx/releases/webkit)

Additional guides: [age assurance](AGE_ASSURANCE.md), [takedowns](TAKEDOWN.md),
[HTTP/relay choices](TRANSPORT.md), [decoded-video checks](VIDEO_CHECKS.md) and
[all documentation](README.md). The age declaration is local; it is not verified age.

The launcher banner can be regenerated from the local font and matching vector
wordmark with `node scripts/android-branding.mjs` (Playwright Chromium required).
The generated banner and Android icon/theme live with the APK source.
