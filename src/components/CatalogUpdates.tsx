import type { UpdateSnapshot } from "../updates/service";
import { useEffect, useState } from "react";
export type CatalogUpdateState = UpdateSnapshot & {
  endpoint: string | null;
  refresh(): void;
};
export function CatalogUpdates({ state }: { state: CatalogUpdateState }) {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.max(0, state.attemptAt + 15000 - Date.now()) + 1,
    );
    return () => clearTimeout(timer);
  }, [state.attemptAt]);
  const cooling = state.attemptAt > 0 && clock < state.attemptAt + 15000;
  return (
    <section className="settings-section">
      <h2>Catalog updates</h2>
      <p className="muted">Update public listings and content restrictions.</p>
      <p role="status" data-update-status={state.status}>
        Revision {state.manifest.revision} ·{" "}
        {state.status === "checking"
          ? "Checking for updates…"
          : state.status === "offline"
            ? "Update unavailable. Using the last saved catalog."
            : state.status === "disabled"
              ? "Remote updates are disabled for this build."
              : state.status === "bundled"
                ? "Using the bundled catalog."
                : state.status === "cached"
                  ? "Using the last saved update."
                  : "Update information is current."}
      </p>
      {state.checkedAt > 0 && (
        <p className="fine-print">
          Last checked: {new Date(state.checkedAt).toLocaleString()}
        </p>
      )}
      <button
        className="button secondary"
        disabled={!state.endpoint || state.status === "checking" || cooling}
        onClick={state.refresh}
      >
        Check catalog updates
      </button>
      {cooling && state.status !== "checking" && (
        <p className="fine-print">
          Please wait a moment before checking again.
        </p>
      )}
    </section>
  );
}
