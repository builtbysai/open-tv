import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import {
  FastForward,
  Pause,
  Play,
  Radio,
  Rewind,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { seekBy } from "../../playback/seek";
import { clock, wholeSeconds } from "../../playback/clock";

// Minimal transport drawn over the picture: one thin scrubber, play, 10-second jumps, volume
// and the time. It reads the video element directly, so the player around it does not
// re-render with every tick.
export function VideoControls({
  video,
  live,
  onToggle,
  trailing,
  skip = 10,
}: {
  video: RefObject<HTMLVideoElement | null>;
  live: boolean;
  onToggle(): void;
  // The icon row (settings, sleep, picture in picture, fullscreen) sits at the right.
  trailing?: ReactNode;
  skip?: number;
}) {
  const [state, setState] = useState({
    time: 0,
    duration: 0,
    buffered: 0,
    paused: true,
    volume: 1,
    muted: false,
    behind: 0,
  });
  const [dragging, setDragging] = useState<number | null>(null);
  const draggingRef = useRef<number | null>(null);
  draggingRef.current = dragging;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const read = () => {
      if (draggingRef.current !== null) return;
      const duration = Number.isFinite(element.duration) ? element.duration : 0;
      let buffered = 0;
      for (let i = 0; i < element.buffered.length; i++)
        if (
          element.currentTime >= element.buffered.start(i) &&
          element.currentTime <= element.buffered.end(i) + 0.5
        )
          buffered = element.buffered.end(i);
      const edge = element.seekable.length
        ? element.seekable.end(element.seekable.length - 1)
        : 0;
      setState({
        time: element.currentTime,
        duration,
        buffered,
        paused: element.paused,
        volume: element.volume,
        muted: element.muted,
        behind: live && edge ? Math.max(0, edge - element.currentTime) : 0,
      });
    };
    const events = [
      "timeupdate",
      "durationchange",
      "progress",
      "play",
      "pause",
      "volumechange",
      "loadedmetadata",
      "seeked",
    ];
    for (const e of events) element.addEventListener(e, read);
    read();
    return () => {
      for (const e of events) element.removeEventListener(e, read);
    };
  }, [video, live]);
  const element = video.current;
  const shown = wholeSeconds(dragging ?? state.time),
    end = wholeSeconds(state.duration);
  const played = state.duration ? (shown / state.duration) * 100 : 0;
  const buffered = state.duration ? (state.buffered / state.duration) * 100 : 0;
  const VolumeIcon =
    state.muted || state.volume === 0
      ? VolumeX
      : state.volume < 0.5
        ? Volume1
        : Volume2;
  const commit = () => {
    if (dragging !== null && element) element.currentTime = dragging;
    setDragging(null);
  };
  return (
    <div className="pc-transport" role="group" aria-label="Video controls">
      {!live && state.duration > 0 && (
        <input
          className="pc-scrubber"
          type="range"
          aria-label="Seek video"
          aria-valuetext={`${clock(shown)} of ${clock(state.duration)}`}
          min={0}
          max={end}
          step={1}
          value={Math.min(shown, end)}
          style={
            {
              "--played": `${played}%`,
              "--buffered": `${buffered}%`,
            } as CSSProperties
          }
          onChange={(e) => setDragging(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={(e) => {
            if (e.key.startsWith("Arrow")) commit();
          }}
          onBlur={commit}
        />
      )}
      <div className="pc-row">
        <button
          type="button"
          className="pc-button pc-play"
          aria-label={state.paused ? "Play" : "Pause"}
          onClick={onToggle}
        >
          {state.paused ? <Play size={22} /> : <Pause size={22} />}
        </button>
        {!live && (
          <>
            <button
              type="button"
              className="pc-button"
              aria-label={`Back ${skip} seconds`}
              onClick={() => element && seekBy(element, -skip)}
            >
              <Rewind size={19} />
            </button>
            <button
              type="button"
              className="pc-button"
              aria-label={`Forward ${skip} seconds`}
              onClick={() => element && seekBy(element, skip)}
            >
              <FastForward size={19} />
            </button>
          </>
        )}
        <div className="pc-volume">
          <button
            type="button"
            className="pc-button"
            aria-label={state.muted ? "Unmute" : "Mute"}
            onClick={() => element && (element.muted = !element.muted)}
          >
            <VolumeIcon size={19} />
          </button>
          <input
            type="range"
            aria-label="Volume"
            min={0}
            max={1}
            step={0.05}
            value={state.muted ? 0 : state.volume}
            style={
              {
                "--played": `${(state.muted ? 0 : state.volume) * 100}%`,
              } as CSSProperties
            }
            onChange={(e) => {
              if (!element) return;
              element.volume = Number(e.target.value);
              element.muted = Number(e.target.value) === 0;
            }}
          />
        </div>
        {live ? (
          <>
            <span className="pc-live">
              <Radio size={14} /> Live
            </span>
            {state.behind > 15 && (
              <button
                type="button"
                className="pc-link"
                onClick={() => element && seekBy(element, state.behind)}
              >
                Go live
              </button>
            )}
          </>
        ) : (
          <output className="pc-time" aria-label="Playback time">
            {clock(shown)} / {clock(state.duration)}
          </output>
        )}
        {trailing}
      </div>
    </div>
  );
}
