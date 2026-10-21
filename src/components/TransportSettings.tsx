import { useState } from "react";
import { relayBase, type RelayConnection } from "../playback/transport";
import { forgetRoutes, rememberedRoutes, routeLabels } from "../playback/route";

// Only the relay's address is kept on this device, so reconnecting needs just the secret.
const ORIGIN = "opentv:relay-origin:v1";
const rememberedOrigin = () => {
  try {
    return localStorage.getItem(ORIGIN) ?? "";
  } catch {
    return "";
  }
};
export function TransportSettings({
  connection,
  onChange,
}: {
  connection: RelayConnection | null;
  onChange(value: RelayConnection | null): void;
}) {
  const [message, setMessage] = useState("");
  return (
    <section className="settings-section">
      <h2>Playback connection</h2>
      <p className="muted">
        Connect your relay for sources that need HTTPS or CORS support.
      </p>
      {connection ? (
        <>
          <p role="status">
            Relay connected for{" "}
            {connection.mode === "http" ? "HTTP sources" : "all direct media"}.
            Credentials stay in memory.
          </p>
          <button
            className="button secondary"
            onClick={() => {
              onChange(null);
              setMessage("Relay disconnected.");
            }}
          >
            Disconnect relay
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              data = new FormData(form),
              base = relayBase(String(data.get("base"))),
              secret = String(data.get("secret"));
            if (
              !base ||
              secret.length < 32 ||
              secret.length > 512 ||
              /[\r\n]/.test(secret)
            ) {
              setMessage(
                "Use an HTTPS relay and a 32–512 character secret. Local HTTP works for development.",
              );
              return;
            }
            try {
              localStorage.setItem(ORIGIN, base);
            } catch {
              /* The address is asked again next time. */
            }
            onChange({
              base,
              secret,
              mode: data.get("mode") === "all" ? "all" : "http",
            });
            form.reset();
            setMessage("Relay connected. The relay must allow the source.");
          }}
        >
          <div className="form-grid">
            <label>
              Relay HTTPS origin
              <input
                name="base"
                type="url"
                placeholder="https://your-relay.example"
                defaultValue={rememberedOrigin()}
                required
                autoComplete="off"
              />
            </label>
            <label>
              Relay access secret
              <input
                name="secret"
                type="password"
                required
                minLength={32}
                maxLength={512}
                autoComplete="off"
              />
            </label>
            <label>
              Use relay for
              <select name="mode">
                <option value="http">HTTP sources only</option>
                <option value="all">
                  All direct media (including CORS-limited HTTPS)
                </option>
              </select>
            </label>
          </div>
          <button className="button secondary">Connect relay</button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      <RememberedRoutes />
      <p className="fine-print">Connected for this session.</p>
      <a
        className="button text"
        href="https://github.com/builtbysai/open-tv/blob/main/docs/TRANSPORT.md"
        target="_blank"
        rel="noreferrer"
      >
        HTTP, CORS & free hosting guide
      </a>
    </section>
  );
}

// Which way each stream host was reached, remembered for a day so the next play goes
// straight there. A failure on a remembered way clears it and tries again from the start.
function RememberedRoutes() {
  const [routes, setRoutes] = useState(() => rememberedRoutes());
  const entries = Object.entries(routes).sort((a, b) => b[1].at - a[1].at);
  if (!entries.length) return null;
  return (
    <details className="remembered-routes">
      <summary>
        How streams were reached ({entries.length} host
        {entries.length === 1 ? "" : "s"})
      </summary>
      <ul>
        {entries.slice(0, 30).map(([host, entry]) => (
          <li key={host}>
            <code>{host}</code> · {routeLabels[entry.route].toLowerCase()} ·{" "}
            {Math.max(1, Math.round((Date.now() - entry.at) / 60000))} min ago
          </li>
        ))}
      </ul>
      <button
        className="button text"
        onClick={() => {
          forgetRoutes();
          setRoutes({});
        }}
      >
        Forget them
      </button>
    </details>
  );
}
