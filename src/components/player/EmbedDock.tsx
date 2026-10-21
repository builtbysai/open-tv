import {
  FastForward,
  Pause,
  Play,
  Rewind,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { EmbedApi } from "../EmbedFrame";
import { canControl, type EmbedState } from "../../playback/embed-bridge";
import { clock, wholeSeconds } from "../../playback/clock";

// Open TV's own controls for an embedded server whose player can be driven. The server's
// controls stay where they are; this bar moves the same player, so a remote can steer it
// without having to reach into the frame.
export function EmbedDock({
  state,
  api,
  skip,
}: {
  state: EmbedState;
  api: EmbedApi | null;
  skip: number;
}) {
  if (!api || !state.ready || !canControl(state.protocol)) return null;
  return (
    <div
      className="embed-dock"
      role="group"
      aria-label="Embedded player controls"
    >
      <button
        type="button"
        className="pc-button pc-play"
        aria-label={state.playing ? "Pause" : "Play"}
        onClick={() => api.command(state.playing ? "pause" : "play")}
      >
        {state.playing ? <Pause size={22} /> : <Play size={22} />}
      </button>
      <button
        type="button"
        className="pc-button"
        aria-label={`Back ${skip} seconds`}
        onClick={() => api.command("seek", Math.max(0, state.time - skip))}
      >
        <Rewind size={19} />
      </button>
      <button
        type="button"
        className="pc-button"
        aria-label={`Forward ${skip} seconds`}
        onClick={() =>
          api.command(
            "seek",
            state.duration
              ? Math.min(state.duration, state.time + skip)
              : state.time + skip,
          )
        }
      >
        <FastForward size={19} />
      </button>
      {state.duration > 0 && (
        <>
          <input
            className="pc-scrubber"
            type="range"
            aria-label="Seek embedded video"
            min={0}
            max={wholeSeconds(state.duration)}
            step={1}
            value={Math.min(
              wholeSeconds(state.time),
              wholeSeconds(state.duration),
            )}
            style={
              {
                "--played": `${(state.time / state.duration) * 100}%`,
              } as React.CSSProperties
            }
            onChange={(e) => api.command("seek", Number(e.target.value))}
          />
          <output className="pc-time" aria-label="Playback time">
            {clock(state.time)} / {clock(state.duration)}
          </output>
        </>
      )}
      <button
        type="button"
        className="pc-button"
        aria-label={state.muted ? "Unmute" : "Mute"}
        onClick={() => api.command(state.muted ? "unmute" : "mute")}
      >
        {state.muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
      </button>
    </div>
  );
}
