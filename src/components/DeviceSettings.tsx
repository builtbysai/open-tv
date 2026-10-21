import { useEffect, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { isTVMode } from "../tv/mode";
import { postDeviceMessage } from "../tv/device";
import {
  defaultDeviceSettings,
  useDeviceSettings,
} from "../persistence/device-settings";

// What this device is, and the choices that belong to it alone. A phone, a laptop and a
// television each keep their own; none of it travels in a backup or a phone transfer.
export function describeDevice() {
  const tvApp = /OpenTVAndroid\//.test(navigator.userAgent);
  const coarse = matchMedia("(pointer: coarse)").matches;
  const small = Math.min(screen.width, screen.height) < 600;
  const kind = tvApp
    ? "Google TV app"
    : isTVMode()
      ? "TV mode"
      : coarse
        ? small
          ? "Phone"
          : "Tablet"
        : "Computer";
  const input =
    tvApp || isTVMode()
      ? "Remote control"
      : coarse
        ? "Touch"
        : "Mouse and keyboard";
  return {
    kind,
    input,
    screen: `${innerWidth} × ${innerHeight} at ${devicePixelRatio}×`,
  };
}
function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <div className="device-row">
      <div>
        <strong>{label}</strong>
        {hint && <p className="muted">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}
export function DeviceSettings() {
  const [device, update] = useDeviceSettings();
  const info = describeDevice();
  const [storage, setStorage] = useState<{
    used: string;
    persisted: boolean | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const estimate = await navigator.storage?.estimate?.();
        const persisted = await navigator.storage?.persisted?.();
        if (!live || !estimate) return;
        const mb = (estimate.usage ?? 0) / 1e6;
        setStorage({
          used: mb < 1 ? "under 1 MB" : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`,
          persisted: persisted ?? null,
        });
      } catch {
        /* Not available here. */
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="settings-section" id="settings-this-device">
      <h2>
        <MonitorSmartphone size={24} /> This device
      </h2>
      <dl className="device-facts">
        <div>
          <dt>Device</dt>
          <dd>{info.kind}</dd>
        </div>
        <div>
          <dt>Input</dt>
          <dd>{info.input}</dd>
        </div>
        <div>
          <dt>Screen</dt>
          <dd>{info.screen}</dd>
        </div>
        {storage && (
          <div>
            <dt>Stored here</dt>
            <dd>
              {storage.used}
              {storage.persisted === false && (
                <>
                  {" "}
                  <button
                    className="button text"
                    onClick={() =>
                      void navigator.storage
                        .persist()
                        .then((ok) =>
                          setStorage((old) =>
                            old ? { ...old, persisted: ok } : old,
                          ),
                        )
                    }
                  >
                    Keep it safe from clean-up
                  </button>
                </>
              )}
            </dd>
          </div>
        )}
      </dl>
      <p className="muted">
        These choices stay on this device. They are not part of a profile, a
        backup or a phone transfer.
      </p>
      {/OpenTVAndroid\//.test(navigator.userAgent) && (
        <Switch
          label="Open when the TV starts"
          hint="After a restart or a power cut, Open TV comes back by itself so your paired phone can find it."
          checked={device.autostart}
          onChange={(autostart) => {
            update({ autostart });
            postDeviceMessage({ type: "autostart", enabled: autostart });
          }}
        />
      )}
      <h3>Player</h3>
      <Switch
        label="Hide controls while playing"
        hint="The bar fades after a few seconds and returns when you move or press a key."
        checked={device.autoHideControls}
        onChange={(autoHideControls) => update({ autoHideControls })}
      />
      <div className="device-row">
        <div>
          <strong>Skip step</strong>
          <p className="muted">
            How far the jump buttons and the arrow keys skip.
          </p>
        </div>
        <div className="library-tabs" role="radiogroup" aria-label="Skip step">
          {([10, 15, 30] as const).map((seconds) => (
            <button
              key={seconds}
              role="radio"
              aria-checked={device.skipSeconds === seconds}
              className={device.skipSeconds === seconds ? "active" : ""}
              onClick={() => update({ skipSeconds: seconds })}
            >
              {seconds}s
            </button>
          ))}
        </div>
      </div>
      <Switch
        label="Open TV controls for embedded servers"
        hint="When a server's player can be driven from outside, a bar with play, skip and volume appears under it, so a remote can steer it. Servers that stay silent keep only their own controls."
        checked={device.embedSync}
        onChange={(embedSync) => update({ embedSync })}
      />
      <h3>Motion</h3>
      <div className="device-row">
        <div>
          <strong>Animations</strong>
          <p className="muted">
            Follows your system setting. Choose Minimal to keep them quiet on
            this device.
          </p>
        </div>
        <div className="library-tabs" role="radiogroup" aria-label="Animations">
          {(
            [
              ["system", "Follow system"],
              ["reduced", "Minimal"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="radio"
              aria-checked={device.motion === value}
              className={device.motion === value ? "active" : ""}
              onClick={() => update({ motion: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <button
        className="button text"
        onClick={() => update(defaultDeviceSettings)}
      >
        Reset this device&rsquo;s choices
      </button>
    </section>
  );
}
