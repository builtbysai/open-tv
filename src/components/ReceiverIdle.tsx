import { useEffect, useState } from "react";
import { Compass, Settings2, Smartphone, Wifi, WifiOff } from "lucide-react";
import { Brand } from "./Brand";
import { PhonePanel } from "./PhoneTransfer";
import type { Receiver } from "../remote/useReceiver";
import type { Bundle } from "../transfer/bundle";

const clock = () =>
  new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// The TV's own screen when nothing is playing: whether it can be reached, which phones are
// paired, and the code to pair another. Choosing and searching happen on the phone; the
// remote can still browse here when no phone is at hand.
export function ReceiverIdle({
  receiver,
  onBrowse,
  onSettings,
  onBundle,
}: {
  receiver: Receiver;
  onBrowse(): void;
  onSettings(): void;
  onBundle(bundle: Bundle): void;
}) {
  const [time, setTime] = useState(clock);
  useEffect(() => {
    const timer = setInterval(() => setTime(clock()), 15000);
    return () => clearInterval(timer);
  }, []);
  const { enabled, status, controllers, claim, tvId } = receiver;
  const paired = controllers.length > 0;
  const online = controllers.filter((c) => c.online);
  const connected = status === "open";
  return (
    <main className="receiver" id="main" aria-label="Open TV">
      <header className="receiver-top">
        <span className="brand">
          <Brand />
        </span>
        <span className="receiver-clock" aria-label={`Time ${time}`}>
          {time}
        </span>
      </header>
      <div className="receiver-body">
        <section className="receiver-intro">
          <h1>
            {!enabled
              ? "Set up from your phone"
              : paired
                ? "Ready to play from your phone"
                : "Pair your phone"}
          </h1>
          <p className="muted">
            {!enabled
              ? "Scan the code to send playlists, servers and keys to this TV."
              : paired
                ? "Pick something on your phone and choose Play on TV."
                : "Scan the code with your phone’s camera. You only do this once."}
          </p>
          {enabled && (
            <p
              className={`receiver-status ${connected ? "ok" : ""}`}
              role="status"
            >
              {connected ? <Wifi size={18} /> : <WifiOff size={18} />}
              {status === "open"
                ? paired
                  ? online.length
                    ? `${online.map((c) => c.name).join(", ")} connected`
                    : "Paired · waiting for your phone"
                  : "Not paired"
                : status === "replaced"
                  ? "Open TV is open in another window"
                  : status === "refused"
                    ? "This TV was reset. Restart the app."
                    : "Connecting…"}
            </p>
          )}
          {enabled && paired && (
            <ul className="receiver-phones" aria-label="Paired phones">
              {controllers.map((c) => (
                <li key={c.id}>
                  <Smartphone size={16} />
                  <span>{c.name}</span>
                  <span className={`dot ${c.online ? "on" : ""}`} />
                  <button
                    className="button text small"
                    onClick={() => receiver.revoke(c.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="receiver-actions">
            <button className="button primary" autoFocus onClick={onBrowse}>
              <Compass size={18} />
              Browse on this TV
            </button>
            <button className="button secondary" onClick={onSettings}>
              <Settings2 size={18} />
              Settings
            </button>
            {enabled && paired && (
              <button
                className="button text"
                onClick={() => receiver.revoke("*")}
              >
                Remove all phones
              </button>
            )}
            {new URLSearchParams(location.search).get("tv") === "1" && (
              <a
                className="button text"
                href={(() => {
                  const url = new URL(location.href);
                  url.searchParams.delete("tv");
                  return url.href;
                })()}
              >
                Exit TV mode
              </a>
            )}
          </div>
        </section>
        <section className="receiver-pair" aria-label="Pair a phone">
          <PhonePanel
            active
            onApply={onBundle}
            label={
              paired
                ? "QR code to pair another phone"
                : "QR code to pair your phone"
            }
            extra={enabled && claim ? `&tv=${tvId}&c=${claim}` : ""}
          />
        </section>
      </div>
    </main>
  );
}
