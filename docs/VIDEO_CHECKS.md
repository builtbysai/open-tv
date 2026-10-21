# Verifying an actual video stream

**Title details → Source & playback → Check video** performs a short, muted playback sample on the
current device. **Settings → Check public stream sample** tests at most four
eligible public HTTPS streams, one per host and one at a time. Nothing is checked
automatically on launch. Neither operation removes a stream on failure.

The checker is shared code in `src/playback/probe.ts`, with native HLS where
available and lazy HLS.js otherwise. A successful video result requires positive
video dimensions and at least two decoded/presented frames at different media
timestamps. Older WebViews can use decoded-frame counts plus advancing time.
An HTTP 200, valid playlist, file extension, metadata or audio playback never
satisfies the video test by itself.

| Result          | Meaning                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| video-confirmed | Video frames decoded during this sample on this device/network                     |
| audio-only      | Audio advanced but no video was decoded in the sample; valid for radio             |
| unconfirmed     | Insufficient evidence before the deadline, including autoplay restrictions         |
| blocked         | HTTP media requires an authorized HTTPS route in this secure context               |
| unsupported     | Embed/provider or browser capability cannot be inspected here                      |
| failed          | Network, CORS, region, media or codec failure; not proof of a globally dead stream |
| aborted         | Viewer canceled, navigated, hid the page or locked private viewing                 |

The default deadline is 12 seconds. The HLS sample uses the lowest variant, a
small buffer and no loading retries. Cancel/timeout destroys HLS, aborts relay
authorization, removes media listeners/callbacks and releases the video source.
Checks mute audio. A sample can consume network data; it is not a zero-byte probe.

General credential-free checks cache only stream hashes and evidence for 24 hours,
at most 200 records. They contain no URL/title/account credentials. Private checks
stay in the detail component and cannot enter the batch export. General sample
results can be exported as bounded JSON through the native document picker.
Source addresses and failed-check details are not sent to a reporting service.

This does not establish the correct program, licensing, geographic availability
elsewhere, continuous uptime, absence of black/static frames, or every quality's
decodability. Those require separate rights/metadata/ongoing quality review. HEAD sampling is
cheap reachability evidence and is labeled separately. No video scan runs in CI.

Tests decode generated HLS video and audio fixtures and reject fake HTML returned
with HTTP 200/video MIME. They also cover private evidence isolation and cleanup.
The fixtures do not claim to certify the entire broadcaster directory.

Primary references: [decoded-frame callbacks](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback),
[video playback quality](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/getVideoPlaybackQuality),
[HLS.js](https://github.com/video-dev/hls.js).

A live check of the existing reviewed Big Buck Bunny MP4 confirmed two decoded
426×240 frames in this environment. It is deliberately reported as a single
sample, not a blanket status for the public directory or every playback device.
