# Audio

Open TV plays audio next to video. Live stations and on-demand audio (music, podcasts,
audiobooks, old-time radio) appear in the **Audio** section, in search ("Audio" filter) and
on Home.

## Adding audio

- **A file or stream:** Settings → Sources → Add your media, choose Content type
  _Audio (music, podcast, book)_ for on-demand files or _Live radio station_ for a stream.
  MP3, AAC, Ogg, Opus, FLAC, WAV and HLS audio play where the browser supports them.
- **A playlist:** M3U entries whose address ends in an audio extension (mp3, aac, ogg, opus, flac, wav, m4a)
  are filed under Audio.
- **Bundled directories:** internet radio stations (Radio Browser) and Internet Archive
  audio collections such as old-time radio. Turn more of them on in Settings → Sources.

## Queue and recent audio

Open an audio title and choose **Add to queue**. The queue plays before the list order,
whether you press Next, use the mini-player, or an on-demand track ends; the full player
shows what is up next and can clear it. Home keeps a **Listen again** shelf of recent audio.
The queue lives in memory for the session.

## The player

Audio opens a dedicated screen with artwork, a visualizer, play/pause, seek (when the
length is known) and volume. Press **V**, or use the visualizer button, to cycle Bars,
Wave and Rings; the choice is remembered. Phone and headset controls, and the system
now-playing card, work through the browser's Media Session.

### How the visualizer gets its data

The browser only lets a page read the sound of media it is allowed to read. Open TV
connects the analyser when the audio is an HLS stream played in the page, a file from
this site, or a file whose server answers cross-origin requests (`Access-Control-Allow-Origin`).
For any other stream it shows a gentle simulated motion labelled "Visualizer" instead
and leaves the sound untouched. Playback never depends on the analyser.

On television and with reduced-motion preferences the visualizer draws at a lower frame
rate.

## Audio diagnostics: movies with no sound

Movie files from personal servers often carry AC-3, E-AC-3 or DTS audio, frequently as the
first or default track. Many TV browsers decode none of them, and would play the picture in
silence. Open TV checks instead of guessing (`src/playback/audio-tracks.ts`):

- **What is there.** When a title starts, the player notes its audio tracks (codec,
  language, channels where the stream says) and the decode path: hls.js through
  MediaSource, native HLS, or a progressive file. For HLS the codecs come from the
  playlist's renditions and variants; a file only lists its tracks where the browser
  exposes `audioTracks` (no codecs).
- **Choosing a track the device can decode.** Each codec is probed with
  `MediaSource.isTypeSupported` and `canPlayType` (AAC `mp4a.40.2`, MP3, Opus, AC-3,
  E-AC-3, DTS and others). A decodable track always wins over one that is not, even when
  that one comes first or is the default; among decodable tracks your language
  (`navigator.languages`) wins, then the stream's default. With hls.js the choice is set
  as `hls.audioTrack`. A codec the stream does not name is never rejected.
- **When nothing decodes.** A Jellyfin or Emby address (`/Videos/<id>/master.m3u8` or
  `/stream`) is asked again with `AudioCodec=aac&AllowAudioStreamCopy=false`, so the server
  converts the audio; the audio menu then says so. Otherwise playback stops with a plain
  message naming the codec ("This title's audio is E-AC-3 (Dolby Digital Plus), which this
  device can't play…") and the usual Retry / Try next source / Back, never silent video.
- **Files that decode no audio.** After about 3 s of moving picture the player reads
  `webkitAudioDecodedByteCount` (or `mozHasAudio`). If the picture is decoding and no audio
  is, and the title isn't known to be silent, a notice says no sound is coming through and
  names the likely cause, with **Try next source** when the title has another source. It
  never blocks playback.
- **The audio menu** (Playback settings, or the Audio list on a TV) lists every track with
  its codec and channels, marks the ones that can't play here, shows the chosen one and
  any fallback note, and lets you switch. Your pick is remembered per title (the last 100
  titles, in this browser only).
- **The log.** Each of these facts (tracks, choice, decode path, conversion, undecoded
  audio) is written to the in-memory media log (`src/playback/media-log.ts`, the last 60
  entries, no titles or addresses), which the Diagnostics view lists.

### Embedded server players

Server players in a frame often autoplay muted, and a remote cannot reach their unmute
button. When an embed reports that it is muted (the Open TV embed protocol, see
[SERVERS.md](SERVERS.md)), the player asks it to unmute once after playback starts. If it
stays muted, a **Sound is off in this player. Unmute** button appears over the picture,
reachable with the D-pad; it is never left muted without a sign.
