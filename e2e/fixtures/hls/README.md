# Synthetic HLS fixture

Six seconds of FFmpeg-generated `testsrc2` at 320×180/640×360 (24 fps,
libx264 ultrafast, CRF 32/36, GOP 48, 2-second HLS segments) and a generated
440 Hz sine wave (AAC, 48 kbps), plus an authored WebVTT cue. No broadcaster or
film assets are included. Audio tracks deliberately share the same synthetic
tone; English/Spanish labels exercise selection, not language content.

Only the browser test routes serve these files. They are outside `public`,
never included in the app catalog or production build, and need no external
network, credentials or playback rights. FFmpeg is not required to run tests.
