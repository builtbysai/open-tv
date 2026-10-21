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
