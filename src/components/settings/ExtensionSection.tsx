import { useState } from "react";
import { Link2, PackagePlus, RefreshCw, Trash2 } from "lucide-react";
import type { SettingsProps } from "./types";

// Adds sources from one JSON file. The file stays on this device; nothing is uploaded.
export function ExtensionSection({
  extension,
}: Pick<SettingsProps, "extension">) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState("");
  const info = extension.info;
  const device = info?.origins.includes("device") ? info : undefined;
  return (
    <section className="settings-section" id="settings-extension">
      <h2>
        <PackagePlus size={23} /> Extension
      </h2>
      <p className="muted">
        An extension is one JSON file that adds sources: channel lists, film
        lists, and 18+ lists if you choose. Import it once and it stays on this
        device. Nothing is uploaded. You can also load it from an https address
        and refresh it from there later.
      </p>
      {info && (
        <p className="source-note">
          {info.name} · {info.sources}{" "}
          {info.sources === 1 ? "source" : "sources"}
          {info.adult
            ? ` (${info.adult} 18+, hidden until you show 18+ content)`
            : ""}
          {info.music
            ? ` · ${info.music} music ${info.music === 1 ? "instance" : "instances"}`
            : ""}
          {info.servers
            ? ` · ${info.servers} ${info.servers === 1 ? "server" : "servers"}`
            : ""}
          {info.origins.length > 1
            ? " · served by this site, with your imported file on top"
            : device
              ? " · imported on this device"
              : " · served by this site"}
          {info.from ? ` · loaded from ${info.from}` : ""}
        </p>
      )}
      <div className="actions">
        <label className="button secondary file-input">
          {busy
            ? "Reading…"
            : device
              ? "Replace extension"
              : "Import extension file"}
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              setBusy(true);
              try {
                setMessage(await extension.importFile(file));
              } catch (error) {
                setMessage(
                  error instanceof Error ? error.message : "Import failed.",
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {device && (
          <button
            className="button text"
            onClick={() => {
              void extension
                .remove()
                .then(() =>
                  setMessage(
                    "Extension removed from this device. Music instances and servers it added stay in their lists; remove them there.",
                  ),
                );
            }}
          >
            <Trash2 size={15} /> Remove extension
          </button>
        )}
      </div>
      <form
        className="actions"
        onSubmit={(event) => {
          event.preventDefault();
          if (!address.trim() || busy) return;
          setBusy(true);
          extension
            .importUrl(address)
            .then((done) => {
              setAddress("");
              setMessage(done);
            })
            .catch((error: unknown) =>
              setMessage(
                error instanceof Error ? error.message : "Import failed.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-label="Extension address"
          placeholder="https://example.com/extension.json"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
        <button className="button secondary" disabled={busy || !address.trim()}>
          <Link2 size={15} /> Load from address
        </button>
        {device?.from && (
          <button
            type="button"
            className="button text"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              extension
                .refresh()
                .then(setMessage)
                .catch((error: unknown) =>
                  setMessage(
                    error instanceof Error ? error.message : "Refresh failed.",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <RefreshCw size={15} /> Refresh
          </button>
        )}
      </form>
      {message && (
        <p role="status" className="source-note">
          {message}
        </p>
      )}
    </section>
  );
}
