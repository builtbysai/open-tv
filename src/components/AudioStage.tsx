import { useEffect, useState, type RefObject } from "react";
import {
  Pause,
  Play,
  Rewind,
  FastForward,
  Volume2,
  VolumeX,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Mic2,
  X,
} from "lucide-react";
import type { Content } from "../domain/content";
import type { TrackInfo } from "../music/lookups";
import { lookupsEnabled } from "../persistence/music";
import { addLyricsText } from "../music/useTrackInfo";
import { Karaoke } from "./Karaoke";
import { titleHue } from "../playback/spectrum";
import { clock, wholeSeconds } from "../playback/clock";
import {
  AudioVisualizer,
  visualizerLabel,
  visualizerModes,
  type VisualizerMode,
} from "./AudioVisualizer";
const slot = "opentv:visualizer:v1";
function savedMode(): VisualizerMode {
  try {
    const value = localStorage.getItem(slot);
    return visualizerModes.includes(value as VisualizerMode)
      ? (value as VisualizerMode)
      : "bars";
  } catch {
    return "bars";
  }
}
interface Props {
  item: Content;
  video: RefObject<HTMLVideoElement | null>;
  analyser: AnalyserNode | null;
  playing: boolean;
  paused: boolean;
  timeline: { time: number; duration: number };
  muted: boolean;
  volume: number;
  tv: boolean;
  onToggle(): void;
  onSeek(seconds: number): void;
  onMinimize?(): void;
  queue?: Content[];
  onClearQueue?(): void;
  onRemoveFromQueue?(id: string): void;
  onMoveInQueue?(id: string, step: -1 | 1): void;
  // Lyrics and album details found for a song.
  info?: TrackInfo | null;
}
// The player screen for audio: artwork, a visualizer that moves with the sound, and
// controls sized for a remote as well as a pointer.
export function AudioStage({
  item,
  video,
  analyser,
  playing,
  paused,
  timeline,
  muted,
  volume,
  tv,
  onToggle,
  onSeek,
  onMinimize,
  queue = [],
  onClearQueue,
  onRemoveFromQueue,
  onMoveInQueue,
  info,
}: Props) {
  const [mode, setMode] = useState(savedMode);
  const [queueOpen, setQueueOpen] = useState(false);
  // Lyrics replace the visualizer when asked for, if there are any to show.
  const hasLyrics = Boolean(info?.synced?.length || info?.plain);
  const [wantLyrics, setWantLyrics] = useState(() => {
    try {
      return localStorage.getItem("opentv:audio-view:v1") === "lyrics";
    } catch {
      return false;
    }
  });
  const showLyrics = hasLyrics && wantLyrics;
  const toggleLyrics = () =>
    setWantLyrics((old) => {
      try {
        localStorage.setItem(
          "opentv:audio-view:v1",
          old ? "visualizer" : "lyrics",
        );
      } catch {
        /* The choice lasts for this session. */
      }
      return !old;
    });
  const storage = () => {
    try {
      return localStorage;
    } catch {
      return undefined;
    }
  };
  const hue = titleHue(item.title);
  const reduced =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cycle = () =>
    setMode((old) => {
      const next =
        visualizerModes[
          (visualizerModes.indexOf(old) + 1) % visualizerModes.length
        ];
      try {
        localStorage.setItem(slot, next);
      } catch {
        /* The choice lasts for this session. */
      }
      return next;
    });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "v" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !(event.target as HTMLElement).matches("input,textarea,select")
      )
        cycle();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const live = item.type === "radio";
  const subtitle = [
    live ? "Live radio" : "",
    ...(item.providerId === "music"
      ? [item.artist || "", info?.album || ""]
      : item.genres.slice(0, 2)),
    ...item.countries.slice(0, 1),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className={`audio-stage ${paused ? "is-paused" : ""} ${showLyrics ? "lyrics-view" : ""}`}
      style={{ "--hue": hue } as React.CSSProperties}
    >
      {!showLyrics && (
        <AudioVisualizer
          analyser={analyser}
          playing={playing}
          hue={hue}
          mode={mode}
          light={tv || reduced}
        />
      )}
      <div className="audio-center">
        {(info?.artwork || item.poster || item.artwork) && (
          <img
            className="audio-art"
            src={info?.artwork || item.poster || item.artwork}
            alt=""
            referrerPolicy="no-referrer"
            onError={(e) => (e.currentTarget.hidden = true)}
          />
        )}
        <h3 className="audio-title">{item.title}</h3>
        {subtitle && <p className="audio-subtitle">{subtitle}</p>}
        {info?.artistInfo && !showLyrics && (
          <p className="audio-subtitle">{info.artistInfo}</p>
        )}
        {showLyrics && (
          <Karaoke
            lines={info?.synced}
            plain={info?.plain}
            time={timeline.time}
          />
        )}
        {queue.length > 0 && (
          <div className="audio-queue">
            <button
              className="button text"
              aria-expanded={queueOpen}
              onClick={() => setQueueOpen((open) => !open)}
            >
              Up next · {queue[0].title}
              {queue.length > 1 ? ` (+${queue.length - 1})` : ""}
              <ChevronDown size={14} />
            </button>
            {queueOpen && (
              <ol className="queue-list" aria-label="Up next">
                {queue.map((q, i) => (
                  <li key={q.id}>
                    <span>{q.title}</span>
                    <button
                      className="icon-button"
                      aria-label={`Move ${q.title} earlier`}
                      disabled={i === 0}
                      onClick={() => onMoveInQueue?.(q.id, -1)}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Move ${q.title} later`}
                      disabled={i === queue.length - 1}
                      onClick={() => onMoveInQueue?.(q.id, 1)}
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${q.title} from the queue`}
                      onClick={() => onRemoveFromQueue?.(q.id)}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <button className="button text" onClick={onClearQueue}>
              Clear queue
            </button>
          </div>
        )}
        {!analyser && playing && <p className="audio-note">Visualizer</p>}
      </div>
      <div className="audio-controls">
        {timeline.duration > 0 && (
          <button
            className="icon-button"
            aria-label="Back 10 seconds"
            onClick={() => onSeek(-10)}
          >
            <Rewind size={20} />
          </button>
        )}
        <button
          className="button primary audio-play"
          data-remote-seek={tv || undefined}
          onClick={onToggle}
          aria-label={paused ? "Play audio" : "Pause audio"}
        >
          {paused ? (
            <Play size={22} fill="currentColor" />
          ) : (
            <Pause size={22} />
          )}
        </button>
        {timeline.duration > 0 && (
          <>
            <button
              className="icon-button"
              aria-label="Forward 10 seconds"
              onClick={() => onSeek(10)}
            >
              <FastForward size={20} />
            </button>
            <input
              type="range"
              aria-label="Seek audio"
              min="0"
              max={wholeSeconds(timeline.duration)}
              step="1"
              value={Math.min(
                wholeSeconds(timeline.time),
                wholeSeconds(timeline.duration),
              )}
              onChange={(e) => {
                if (video.current)
                  video.current.currentTime = Number(e.target.value);
              }}
            />
            <output aria-label="Playback time">
              {clock(timeline.time)} / {clock(timeline.duration)}
            </output>
          </>
        )}
        {!tv && (
          <label className="audio-volume">
            {muted || volume === 0 ? (
              <VolumeX size={18} />
            ) : (
              <Volume2 size={18} />
            )}
            <input
              type="range"
              aria-label="Volume"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              onChange={(e) => {
                const element = video.current;
                if (!element) return;
                element.volume = Number(e.target.value);
                element.muted = false;
              }}
            />
          </label>
        )}
        {onMinimize && (
          <button className="button text" onClick={onMinimize}>
            <ChevronDown size={16} /> Minimize
          </button>
        )}
        {hasLyrics ? (
          <button
            className="button text"
            aria-pressed={showLyrics}
            onClick={toggleLyrics}
          >
            <Mic2 size={16} /> {showLyrics ? "Visualizer" : "Lyrics"}
          </button>
        ) : (
          item.providerId === "music" && (
            <>
              {(info || lookupsEnabled(storage())) && (
                <button className="button text" disabled>
                  <Mic2 size={16} />{" "}
                  {info ? "No lyrics found" : "Looking for lyrics…"}
                </button>
              )}
              <label className="button text file-input">
                Add lyrics
                <input
                  type="file"
                  accept=".lrc,.txt,text/plain"
                  onChange={async (event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file && file.size <= 200_000)
                      addLyricsText(item.id, await file.text());
                  }}
                />
              </label>
            </>
          )
        )}
        {!showLyrics && (
          <button className="button text" onClick={cycle}>
            <Sparkles size={16} /> {visualizerLabel(mode)}
          </button>
        )}
      </div>
    </div>
  );
}
