import { Smartphone } from "lucide-react";
import { usePairing } from "../app/usePairing";
import { QrCode } from "./QrCode";
import type { Bundle } from "../transfer/bundle";
function summary(bundle: Bundle) {
  return [
    bundle.playlists.length &&
      `${bundle.playlists.length} playlist${bundle.playlists.length === 1 ? "" : "s"}`,
    bundle.servers.length &&
      `${bundle.servers.length} server${bundle.servers.length === 1 ? "" : "s"}`,
    bundle.tmdbKey && "TMDB key",
    bundle.account && "Xtream account (not saved)",
    bundle.profile && "Profile",
    bundle.connect?.length &&
      `${bundle.connect.length} source${bundle.connect.length === 1 ? "" : "s"} to connect`,
  ].filter(Boolean) as string[];
}
// The QR code, its status and the review step. Used in Settings and on first run.
export function PhonePanel({
  active,
  onApply,
  extra = "",
  label = "QR code for phone setup",
}: {
  active: boolean;
  onApply(bundle: Bundle): void;
  // More of the link, such as the TV's pairing code for the phone remote.
  extra?: string;
  label?: string;
}) {
  const pairing = usePairing(active);
  if (pairing.bundle)
    return (
      <div className="transfer-review">
        <h3>Received from your phone</h3>
        <ul>
          {summary(pairing.bundle).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {pairing.bundle.playlists.some(
          (p) => p.classification !== "general",
        ) && (
          <p className="muted">
            Playlists that aren’t marked general stay hidden until private
            viewing is on.
          </p>
        )}
        <div className="actions">
          <button
            className="button primary"
            autoFocus
            onClick={() => {
              onApply(pairing.bundle!);
              pairing.restart();
            }}
          >
            Import
          </button>
          <button className="button text" onClick={pairing.restart}>
            Discard
          </button>
        </div>
      </div>
    );
  return (
    <div className="transfer-qr">
      <QrCode value={pairing.link + extra} label={label} />
      <div>
        <p className="transfer-step">
          <Smartphone size={16} />
          Point your phone’s camera at the code
        </p>
        <p role="status" className="muted">
          {pairing.status === "error"
            ? "Can’t reach the transfer service."
            : "Waiting for your phone…"}
        </p>
        {pairing.status === "error" && (
          <button className="button secondary" onClick={pairing.restart}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
export function PhoneTransfer({
  active,
  onApply,
}: {
  active: boolean;
  onApply(bundle: Bundle): void;
}) {
  return (
    <section className="settings-section" id="settings-phone">
      <h2>Set up from your phone</h2>
      <p className="muted">
        Scan the code, type your links and keys on your phone, and send them
        here. Everything is encrypted end to end.
      </p>
      <PhonePanel active={active} onApply={onApply} />
    </section>
  );
}
