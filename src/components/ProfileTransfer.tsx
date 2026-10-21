import { useEffect, useRef, useState } from "react";
import type { UserState } from "../persistence/user-state";
import { exportProfile, parseProfile } from "../persistence/profile";
import { exportJson } from "../persistence/export";
import { friendlyError } from "../domain/errors";
export function ProfileTransfer({
  user,
  onImport,
}: {
  user: UserState;
  onImport(profile: UserState): void;
}) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <section className="settings-section">
      <h2>Profile backup</h2>
      <p className="muted">
        Move favorites, collections, history and progress to another browser or
        your Google TV. Importing merges with what’s here.
      </p>
      <div className="actions">
        <button
          className="button secondary"
          onClick={() =>
            exportJson("open-tv-profile.json", exportProfile(user))
          }
        >
          Export general profile
        </button>
        <label className="button secondary file-input" aria-disabled={busy}>
          Import general profile
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            aria-label="Import general profile"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > 2_000_000) {
                setMessage("This profile exceeds the 2 MB import limit.");
                return;
              }
              setBusy(true);
              try {
                const profile = parseProfile(await file.text());
                if (!mounted.current) return;
                onImport(profile);
                setMessage("Profile merged.");
              } catch (error) {
                if (mounted.current) setMessage(friendlyError(error));
              } finally {
                if (mounted.current) setBusy(false);
              }
            }}
          />
        </label>
      </div>
      {message && <p role="status">{message}</p>}
      <p className="fine-print">
        Backups include viewing activity, so keep them private. Sources,
        credentials, private activity and PINs are not included.
      </p>
    </section>
  );
}
