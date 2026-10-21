import { useEffect, useRef, useState } from "react";
import { Upload, RefreshCw } from "lucide-react";
import { parseXMLTV } from "../providers/epg";
import type { GuideConnection } from "../app/useGuide";
import { writeGuideUrl } from "../persistence/guide";

export function GuideSettings({
  guide,
  suggestions = [],
}: {
  guide: GuideConnection;
  suggestions?: { name: string; url: string }[];
}) {
  const [message, setMessage] = useState("");
  const [clock, setClock] = useState(Date.now);
  const epoch = useRef(0);
  const form = useRef<HTMLFormElement>(null);
  const { state } = guide;
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  useEffect(() => {
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.max(0, state.attemptAt + 15000 - Date.now()) + 1,
    );
    return () => clearTimeout(timer);
  }, [state.attemptAt]);
  return (
    <section
      className="settings-section"
      id="guide-settings"
      aria-labelledby="guide-settings-title"
    >
      <h2 id="guide-settings-title">TV guide</h2>
      <p className="muted">
        Connect an XMLTV URL or import a file. Guides refresh every two hours.
      </p>
      {suggestions.length > 0 && !state.loadedAt && (
        <div className="actions" aria-label="Guides your extension suggests">
          {suggestions.map((g) => (
            <button
              key={g.url}
              type="button"
              className="button secondary"
              onClick={() => {
                const input =
                  form.current?.querySelector<HTMLInputElement>(
                    'input[name="url"]',
                  );
                if (input) {
                  input.value = g.url;
                  input.focus();
                }
              }}
            >
              Use {g.name}
            </button>
          ))}
        </div>
      )}
      <form
        ref={form}
        className="form-grid"
        aria-label="Connect XMLTV guide"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const generation = ++epoch.current;
          const value = String(new FormData(form).get("url") || "");
          try {
            await guide.connect(value);
            if (generation !== epoch.current) return;
            const after = guide.current();
            if (after.status === "error") {
              setMessage(
                `This guide didn’t load, so it wasn’t saved. ${after.reason || ""}`.trim(),
              );
              return;
            }
            form.reset();
            // A plain address comes back when the app opens; one with a token does not.
            setMessage(
              writeGuideUrl(value.trim())
                ? "This guide will reconnect when the app opens."
                : "",
            );
          } catch {
            if (generation !== epoch.current) return;
            setMessage(
              "Enter an HTTPS XMLTV address without a login or fragment. HTTP guides can be imported as files.",
            );
          }
        }}
      >
        <label className="form-wide">
          XMLTV guide URL
          <input
            name="url"
            type="url"
            required
            maxLength={8192}
            autoComplete="off"
            placeholder="https://your-authorized-guide.example/guide.xml"
          />
        </label>
        <label className="checkbox form-wide">
          <input type="checkbox" required />I am authorized to use this guide
        </label>
        <div className="actions form-wide">
          <button
            className="button primary"
            disabled={state.status === "loading"}
          >
            Connect guide
          </button>
          <label className="button secondary file-input">
            <Upload size={16} />
            Import XMLTV
            <input
              type="file"
              accept=".xml,.xmltv"
              onChange={async (e) => {
                const file = e.target.files?.[0],
                  generation = ++epoch.current;
                e.target.value = "";
                if (!file || file.size > 10000000) {
                  setMessage("Choose an XMLTV file smaller than 10 MB.");
                  return;
                }
                try {
                  const programs = parseXMLTV(await file.text());
                  if (generation !== epoch.current) return;
                  if (!programs.length) throw new Error();
                  guide.importGuide(programs);
                  setMessage(
                    `Loaded ${programs.length.toLocaleString()} guide programs.`,
                  );
                } catch {
                  if (generation === epoch.current)
                    setMessage(
                      "Couldn’t read that guide. Use an uncompressed XMLTV file.",
                    );
                }
              }}
            />
          </label>
        </div>
      </form>
      <p role="status" data-guide-status={state.status}>
        {state.status === "loading"
          ? state.loadedAt
            ? "Refreshing guide…"
            : "Loading guide…"
          : state.status === "error"
            ? state.loadedAt
              ? `Guide refresh failed. ${state.reason ?? ""} Showing the last schedule.`
              : `The guide hasn’t loaded yet. ${state.reason ?? ""}`
            : state.source === "none"
              ? "No guide connected in this viewing mode."
              : `${state.programs.length.toLocaleString()} programs loaded${state.source === "file" ? " from a file" : " from your connected guide"}.`}
      </p>
      {state.loadedAt > 0 && (
        <p className="fine-print">
          Updated {new Date(state.loadedAt).toLocaleString()}
          {state.nextCheckAt > 0
            ? ` · Next attempt ${new Date(state.nextCheckAt).toLocaleTimeString()}`
            : ""}
        </p>
      )}
      {state.source !== "none" && (
        <div className="actions">
          {state.source === "remote" && (
            <button
              className="button secondary"
              onClick={guide.refresh}
              disabled={
                state.status === "loading" || clock < state.attemptAt + 15000
              }
            >
              <RefreshCw size={16} />
              Refresh guide
            </button>
          )}
          <button
            className="button text"
            onClick={() => {
              epoch.current++;
              guide.clear();
              writeGuideUrl("");
              setMessage("");
            }}
          >
            Clear guide
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <p className="fine-print">
        A guide address with no login or token reconnects when the app opens.
        Others last for this session.
      </p>
    </section>
  );
}
