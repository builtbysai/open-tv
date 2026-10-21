import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { SITE_NAME } from "../config/site";
import type { Bundle } from "../transfer/bundle";
import type { Source } from "../domain/content";
import { useProfiles } from "./ProfileGate";
import { isTVMode } from "../tv/mode";
import { Skeleton } from "./Skeleton";
// The QR code library is only needed while setting up, so it loads on demand.
const PhonePanel = lazy(() =>
  import("./PhoneTransfer").then((m) => ({ default: m.PhonePanel })),
);
const steps = [
  "Your setup",
  "Your sources",
  "Trending titles",
  "Who's watching",
] as const;
// A short list worth starting with; everything else is one tap away.
export const SUGGESTED_SOURCES = [
  "free-news",
  "open-cinema",
  "archive-feature-films",
  "archive-classic-tv",
  "audio-somafm",
  "audio-radio-paradise",
  "nasa-apollo",
];
interface Props {
  hasSources: boolean;
  // Sources that can be switched on here (general, no sign-in).
  sources: Source[];
  onSource(source: Source): void;
  hasKey: boolean;
  onBundle(bundle: Bundle): void;
  onKey(key: string): void;
  // Loads an extension file or address and says what it added.
  onExtensionFile(file: File): Promise<string>;
  onExtensionUrl(url: string): Promise<string>;
  // "done" when finished, "skipped" when left early.
  onClose(result: "done" | "skipped"): void;
  onEnterManually(): void;
}
// The welcome: a short, skippable walk through the things worth setting up once.
export function Onboarding({
  hasSources,
  sources,
  onSource,
  hasKey,
  onBundle,
  onKey,
  onExtensionFile,
  onExtensionUrl,
  onClose,
  onEnterManually,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { active, rename, add, registry } = useProfiles();
  const [step, setStep] = useState(0),
    [key, setKey] = useState(""),
    [name, setName] = useState(active.name),
    [kids, setKids] = useState(false),
    [address, setAddress] = useState(""),
    [loaded, setLoaded] = useState("");
  const tvDevice = isTVMode();
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [allSources, setAllSources] = useState(false);
  const suggested = sources.filter((s) => SUGGESTED_SOURCES.includes(s.id));
  const shownSources = allSources || !suggested.length ? sources : suggested;
  const phone = (
    <Suspense fallback={<Skeleton label="Loading phone setup" rows={2} />}>
      <PhonePanel active onApply={onBundle} />
    </Suspense>
  );
  const load = (run: Promise<string>) =>
    run.then(setLoaded, (error: unknown) =>
      setLoaded(error instanceof Error ? error.message : "Could not load it."),
    );
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const last = step === steps.length - 1;
  const finish = () => {
    const label = name.trim();
    if (label && label !== active.name) rename(active.id, label);
    if (kids && !registry.profiles.some((p) => p.kids)) add("Kids", true);
    onClose("done");
  };
  return (
    <dialog
      ref={dialog}
      className="onboarding-dialog"
      aria-labelledby="onboarding-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose("skipped");
      }}
    >
      <div className="onboarding">
        <p className="eyebrow">
          Welcome to {SITE_NAME} · Step {step + 1} of {steps.length}
        </p>
        <div className="onboarding-dots" aria-hidden="true">
          {steps.map((label, i) => (
            <span key={label} className={i <= step ? "on" : ""} />
          ))}
        </div>
        {step === 0 && (
          <section>
            <h2 id="onboarding-title">
              {tvDevice
                ? "Bring your servers and playlists"
                : "Set up on this device"}
            </h2>
            <p className="muted">
              {tvDevice
                ? "Scan the code with your phone, add them there, and they arrive here. Nothing to type on the TV."
                : "Load an extension file or address, or add your sources here. You can also send them from a phone."}
            </p>
            {hasSources && (
              <p className="onboarding-done">
                <Check size={18} /> Your sources are connected.
              </p>
            )}
            {!hasSources && tvDevice && phone}
            {!hasSources && tvDevice && (
              <button className="button text" onClick={onEnterManually}>
                Enter them here instead
              </button>
            )}
            {!hasSources && (
              <div className="onboarding-extension">
                <p className="muted">
                  Have an extension file? It can bring lists, music instances
                  and settings in one step.
                </p>
                <div className="actions">
                  <label className="button secondary file-input">
                    Choose file
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        if (file) void load(onExtensionFile(file));
                      }}
                    />
                  </label>
                  <form
                    className="actions"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (address.trim()) void load(onExtensionUrl(address));
                    }}
                  >
                    <input
                      type="url"
                      aria-label="Extension address"
                      placeholder="https://example.com/extension.json"
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                    />
                    <button
                      className="button secondary"
                      disabled={!address.trim()}
                    >
                      Load
                    </button>
                  </form>
                </div>
                {loaded && (
                  <p role="status" className="source-note">
                    {loaded}
                  </p>
                )}
              </div>
            )}
            {!hasSources && !tvDevice && (
              <>
                <button className="button secondary" onClick={onEnterManually}>
                  Add sources here
                </button>
                <details
                  className="onboarding-phone"
                  onToggle={(event) => setPhoneOpen(event.currentTarget.open)}
                >
                  <summary>Send them from a phone instead</summary>
                  {phoneOpen && phone}
                </details>
              </>
            )}
          </section>
        )}
        {step === 1 && (
          <section>
            <h2 id="onboarding-title">Choose your sources</h2>
            <p className="muted">
              Nothing is connected until you choose. Pick a few; you can change
              them any time in Settings, and this device remembers.
            </p>
            <div
              className="onboarding-sources"
              role="group"
              aria-label="Sources"
            >
              {shownSources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className="source-choice"
                  aria-pressed={source.enabled}
                  onClick={() =>
                    onSource({ ...source, enabled: !source.enabled })
                  }
                >
                  {source.enabled ? (
                    <Check size={16} />
                  ) : (
                    <span className="dot" />
                  )}
                  <span>
                    <strong>{source.name}</strong>
                    <small>{source.description}</small>
                  </span>
                </button>
              ))}
            </div>
            {suggested.length > 0 && sources.length > suggested.length && (
              <button
                className="button text"
                onClick={() => setAllSources((all) => !all)}
              >
                {allSources
                  ? "Show the suggestions only"
                  : `Show all ${sources.length} sources`}
              </button>
            )}
          </section>
        )}
        {step === 2 && (
          <section>
            <h2 id="onboarding-title">Trending titles from TMDB</h2>
            <p className="muted">
              A free TMDB key shows what is popular, with posters and ratings,
              and marks what your servers already have.
            </p>
            {hasKey ? (
              <p className="onboarding-done">
                <Check size={18} /> TMDB is connected.
              </p>
            ) : (
              <>
                <form
                  className="inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (key.trim()) onKey(key.trim());
                  }}
                >
                  <label>
                    API key or read access token
                    <input
                      type="password"
                      autoComplete="off"
                      value={key}
                      onChange={(event) => setKey(event.target.value)}
                    />
                  </label>
                  <button className="button secondary" disabled={!key.trim()}>
                    Connect
                  </button>
                </form>
                <a
                  className="button text"
                  href="https://www.themoviedb.org/settings/api"
                  target="_blank"
                  rel="noreferrer"
                >
                  Get a free key <ExternalLink size={13} />
                </a>
              </>
            )}
          </section>
        )}
        {step === 3 && (
          <section>
            <h2 id="onboarding-title">Who&rsquo;s watching?</h2>
            <p className="muted">
              Profiles keep their own list and history. No account needed.
            </p>
            <label>
              Your name
              <input
                value={name}
                maxLength={24}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {!registry.profiles.some((p) => p.kids) && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={kids}
                  onChange={(event) => setKids(event.target.checked)}
                />
                Also add a Kids profile (children&rsquo;s titles only, no
                Settings)
              </label>
            )}
          </section>
        )}
        <div className="onboarding-actions">
          <button className="button text" onClick={() => onClose("skipped")}>
            Skip for now
          </button>
          <span className="spacer" />
          {step > 0 && (
            <button
              className="button secondary"
              onClick={() => setStep(step - 1)}
            >
              Back
            </button>
          )}
          <button
            className="button primary"
            autoFocus
            onClick={() => (last ? finish() : setStep(step + 1))}
          >
            {last
              ? "Finish"
              : step === 0 && !hasSources
                ? "Skip this step"
                : step === 2 && !hasKey
                  ? "Skip this step"
                  : "Next"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
