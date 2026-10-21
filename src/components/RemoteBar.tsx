import { useEffect, useState } from "react";
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  Tv,
  Volume1,
  Volume2,
  VolumeX,
  Smartphone,
} from "lucide-react";
import { positionNow } from "../remote/items";
import { remoteMessage, type Remote } from "../remote/useRemote";

const clock = (value: number) => {
  const s = Math.max(0, Math.floor(value));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
};

// The phone as the TV's remote: what the TV is playing, where it is, and the controls.
// The position runs on between the TV's updates, which come only when something changes.
export function RemoteBar({
  remote,
  onNotice,
  onPlayHere,
}: {
  remote: Remote;
  onNotice(message: string): void;
  // Carry on with this title here, from where the TV is.
  onPlayHere?(): void;
}) {
  const { state, receivedAt, tvOnline, tv, tvName } = remote;
  const [now, setNow] = useState(Date.now());
  const [scrub, setScrub] = useState<number | null>(null);
  const active = !!state && state.phase !== "idle" && tvOnline;
  useEffect(() => {
    if (!active || state?.phase !== "playing") return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active, state?.phase]);
  if (!active || !state || !tv) return null;
  const position = scrub ?? positionNow(state, receivedAt, now);
  const run = (command: Parameters<Remote["send"]>[0]) =>
    remote
      .send(command)
      .catch((error: Error) => onNotice(remoteMessage(error.message)));
  const playing = state.phase === "playing" || state.phase === "buffering";
  return (
    <section
      data-link={remote.lan === "open" ? "lan" : "relay"}
      className="remote-bar"
      aria-label={`Playing on ${tvName || tv.name}`}
    >
      {state.artwork ? (
        <img className="remote-art" src={state.artwork} alt="" />
      ) : (
        <span className="remote-art">
          <Tv size={20} />
        </span>
      )}
      <div className="remote-copy">
        <span className="eyebrow">On {tv.name}</span>
        <strong>{state.title || "Playing"}</strong>
        {state.canSeek ? (
          <div className="remote-time">
            <span>{clock(position)}</span>
            <input
              type="range"
              aria-label="Seek on TV"
              min={0}
              max={Math.max(1, Math.floor(state.duration))}
              step={1}
              value={Math.floor(position)}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={() => {
                if (scrub !== null) void run({ t: "seek", seconds: scrub });
                setScrub(null);
              }}
              onKeyUp={() => {
                if (scrub !== null) void run({ t: "seek", seconds: scrub });
                setScrub(null);
              }}
            />
            <span>{clock(state.duration)}</span>
          </div>
        ) : (
          <span className="muted remote-phase">
            {state.phase === "loading" || state.phase === "buffering"
              ? "Loading…"
              : state.phase === "error"
                ? "The TV couldn’t play this"
                : state.duration > 0
                  ? clock(position)
                  : "Live"}
          </span>
        )}
      </div>
      <div className="remote-controls">
        {state.canStep && (
          <button
            className="icon-button"
            aria-label="Previous on TV"
            onClick={() => void run({ t: "previous" })}
          >
            <SkipBack size={20} />
          </button>
        )}
        <button
          className="icon-button remote-play"
          aria-label={playing ? "Pause on TV" : "Play on TV"}
          onClick={() => void run({ t: playing ? "pause" : "resume" })}
        >
          {playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        {state.canStep && (
          <button
            className="icon-button"
            aria-label="Next on TV"
            onClick={() => void run({ t: "next" })}
          >
            <SkipForward size={20} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Stop on TV"
          onClick={() => void run({ t: "stop" })}
        >
          <Square size={18} />
        </button>
      </div>
      <div className="remote-extra">
        <button
          className="icon-button"
          aria-label="TV volume down"
          onClick={() => void run({ t: "volume", step: -1 })}
        >
          <Volume1 size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="Mute TV"
          onClick={() => void run({ t: "volume", step: 0 })}
        >
          <VolumeX size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="TV volume up"
          onClick={() => void run({ t: "volume", step: 1 })}
        >
          <Volume2 size={17} />
        </button>
        {onPlayHere && state.itemId && (
          <button
            className="icon-button"
            aria-label="Continue on this device"
            title="Continue on this device"
            onClick={onPlayHere}
          >
            <Smartphone size={17} />
          </button>
        )}
      </div>
    </section>
  );
}
