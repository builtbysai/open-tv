import { useState } from "react";
import type { XtreamMode } from "../../providers/xtream";
import { accountProvider } from "../../providers/accounts";
import type { AccountDraft } from "../../transfer/bundle";
import type { SettingsProps, SettingsShared } from "./types";
export function AccountSection({
  onAccount,
  savedAccounts,
  onSaveAccount,
  onForgetAccount,
  setMessage,
  busy,
  setBusy,
  mounted,
  connections,
  report,
}: Pick<
  SettingsProps,
  "onAccount" | "savedAccounts" | "onSaveAccount" | "onForgetAccount"
> &
  Pick<
    SettingsShared,
    "setMessage" | "busy" | "setBusy" | "mounted" | "connections" | "report"
  >) {
  const [service, setService] = useState<"xtream" | "jellyfin">("xtream");
  return (
    <section className="settings-section" id="account-connection">
      <h2>Server account</h2>
      <p className="muted">
        Xtream, Jellyfin or Emby. Titles appear with everything else. Anything
        that looks 18+ stays hidden until you show it.
      </p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          setBusy(true);
          const controller = new AbortController();
          connections.current.add(controller);
          try {
            const draft: AccountDraft = {
              server: String(f.get("server")),
              username: String(f.get("username")),
              password: String(f.get("password")),
              mode: f.get("mode") as XtreamMode,
              ...(service === "jellyfin" ? { service } : {}),
            };
            const provider = accountProvider(draft);
            const count = await onAccount(
              provider,
              AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
            );
            if (controller.signal.aborted || !mounted.current) return;
            form.reset();
            if (f.get("remember")) onSaveAccount(draft);
            setMessage(`Connected ${count.toLocaleString()} titles.`);
          } catch (error) {
            if (mounted.current && !controller.signal.aborted) report(error);
          } finally {
            connections.current.delete(controller);
            if (mounted.current) setBusy(false);
          }
        }}
      >
        <label>
          Service
          <select
            name="service"
            value={service}
            onChange={(e) => setService(e.target.value as typeof service)}
          >
            <option value="xtream">Xtream</option>
            <option value="jellyfin">Jellyfin or Emby</option>
          </select>
        </label>
        <label>
          Server
          <input
            name="server"
            type="url"
            placeholder="https://provider.example"
            required
            autoComplete="off"
          />
        </label>
        <label>
          Username
          <input name="username" required autoComplete="off" />
        </label>
        <label>
          Password
          <input name="password" type="password" required autoComplete="off" />
        </label>
        <label>
          Catalog
          <select name="mode" defaultValue="movie">
            {service === "xtream" && <option value="live">Live TV</option>}
            <option value="movie">Movies</option>
            <option value="series">Series</option>
          </select>
        </label>
        <label className="checkbox form-wide">
          <input name="remember" type="checkbox" defaultChecked />
          Remember on this device
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? "Connecting…" : "Connect account"}
        </button>
      </form>
      {savedAccounts.length > 0 && (
        <ul className="saved-accounts" aria-label="Saved accounts">
          {savedAccounts.map((a) => (
            <li key={`${a.service}|${a.server}|${a.username}|${a.mode}`}>
              <span>
                {a.username} · {new URL(a.server).host} ·{" "}
                {a.service === "jellyfin" ? "Jellyfin " : ""}
                {a.mode}
              </span>
              <button
                className="button text"
                onClick={() => onForgetAccount(a)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
