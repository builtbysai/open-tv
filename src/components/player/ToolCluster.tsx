import type { ReactNode, RefObject } from "react";
import {
  Check,
  Keyboard,
  Maximize,
  Minimize,
  Moon,
  PictureInPicture2,
  Settings2,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type {
  PlaybackSnapshot,
  PlayerService,
} from "../../playback/player-service";
import { Popover } from "./Popover";
import { SLEEP_PRESETS, type SleepTimer } from "./useSleepTimer";

interface Props {
  tv: boolean;
  sequence: string | null;
  onStep(direction: number): void;
  snapshot: PlaybackSnapshot;
  service: RefObject<PlayerService | null>;
  sleep: SleepTimer;
  onSleepSet(minutes: number): void;
  onSleepCancel(): void;
  showPip: boolean;
  pipActive: boolean;
  onPip(): void;
  fullscreen: boolean;
  onFullscreen(): void;
  shortcutsOpen: boolean;
  onShortcuts(): void;
  onMenuOpen?(open: boolean): void;
  // The speed choices exist only for a title that has a length.
  speed?: { value: number; set(value: number): void } | null;
  extra?: ReactNode;
}
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function Selects({
  snapshot,
  service,
  field,
}: {
  snapshot: PlaybackSnapshot;
  service: RefObject<PlayerService | null>;
  field: "label" | "pc-field";
}) {
  const Wrap = ({ name, children }: { name: string; children: ReactNode }) =>
    field === "pc-field" ? (
      <label className="pc-field">
        {name}
        {children}
      </label>
    ) : (
      <label>
        {name}
        {children}
      </label>
    );
  return (
    <>
      {!!snapshot.quality.length && (
        <Wrap name="Quality">
          <select
            aria-label="Video quality"
            defaultValue="-1"
            onChange={(e) =>
              service.current?.setQuality(Number(e.target.value))
            }
          >
            {snapshot.quality.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Wrap>
      )}
      {snapshot.audio.length > 0 && (
        <Wrap name="Audio">
          <select
            aria-label="Audio track"
            value={snapshot.audioId ?? snapshot.audio[0].id}
            title={snapshot.audioNote}
            onChange={(e) => service.current?.setAudio(Number(e.target.value))}
          >
            {snapshot.audio.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Wrap>
      )}
      {snapshot.audioNote && (
        <p className="pc-note" role="note">
          {snapshot.audioNote}
        </p>
      )}
      {!!snapshot.subtitles.length && (
        <Wrap name="Subtitles">
          <select
            aria-label="Subtitles"
            defaultValue="-1"
            onChange={(e) =>
              service.current?.setSubtitles(Number(e.target.value))
            }
          >
            <option value="-1">Off</option>
            {snapshot.subtitles.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Wrap>
      )}
    </>
  );
}

// The quiet row of icon controls shared by video, radio and music. On a television the
// choices stay inline, because a remote steers a row better than it opens a panel.
export function ToolCluster(p: Props) {
  const { snapshot, service, sleep } = p;
  const hasSettings =
    snapshot.quality.length > 0 ||
    snapshot.audio.length > 0 ||
    snapshot.subtitles.length > 0 ||
    Boolean(p.speed);
  return (
    <div className="player-tools pc-tools">
      {p.sequence && (
        <>
          <button
            type="button"
            className="pc-button"
            aria-label="Previous"
            title={`Previous ${p.sequence}`}
            onClick={() => p.onStep(-1)}
          >
            <SkipBack size={19} />
            <span className="pc-text">Previous</span>
          </button>
          <button
            type="button"
            className="pc-button"
            aria-label="Next"
            title={`Next ${p.sequence}`}
            onClick={() => p.onStep(1)}
          >
            <span className="pc-text">Next</span>
            <SkipForward size={19} />
          </button>
        </>
      )}
      <span className="pc-spacer" />
      {p.tv ? (
        <Selects snapshot={snapshot} service={service} field="label" />
      ) : (
        hasSettings && (
          <Popover
            label="Playback settings"
            icon={<Settings2 size={19} />}
            onOpenChange={p.onMenuOpen}
          >
            <Selects snapshot={snapshot} service={service} field="pc-field" />
            {p.speed && (
              <div className="pc-field">
                Speed
                <div className="pc-choices">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={p.speed?.value === s}
                      onClick={() => p.speed?.set(s)}
                    >
                      {s === 1 ? "Normal" : `${s}×`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Popover>
        )
      )}
      <Popover
        label="Sleep timer"
        icon={<Moon size={19} />}
        badge={sleep.active ? sleep.label : undefined}
        onOpenChange={p.onMenuOpen}
      >
        {(close) => (
          <div className="pc-field">
            {sleep.active ? `Stops in ${sleep.label}` : "Stop playing after"}
            <div className="pc-choices">
              {SLEEP_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    p.onSleepSet(n);
                    close();
                  }}
                >
                  {n} min
                </button>
              ))}
            </div>
            {sleep.active && (
              <button
                type="button"
                className="pc-link"
                onClick={() => {
                  p.onSleepCancel();
                  close();
                }}
              >
                <Check size={14} /> Cancel timer
              </button>
            )}
          </div>
        )}
      </Popover>
      {p.showPip && (
        <button
          type="button"
          className={`pc-button ${p.pipActive ? "is-on" : ""}`}
          aria-label="Picture in picture"
          aria-pressed={p.pipActive}
          onClick={p.onPip}
        >
          <PictureInPicture2 size={19} />
        </button>
      )}
      {p.extra}
      <button
        type="button"
        className="pc-button"
        aria-label="Fullscreen"
        aria-pressed={p.fullscreen}
        onClick={p.onFullscreen}
      >
        {p.fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
      </button>
      <button
        type="button"
        className="pc-button shortcuts-toggle"
        aria-label="Playback shortcuts"
        aria-expanded={p.shortcutsOpen}
        aria-controls="playback-shortcuts"
        onClick={p.onShortcuts}
      >
        <Keyboard size={19} />
      </button>
    </div>
  );
}
