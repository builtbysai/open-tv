import { appAsset } from "../../config/site";
import type { SettingsProps } from "./types";
export function TmdbSection({
  onMetadata,
  discoveryStatus,
  hasStoredKey,
}: Pick<SettingsProps, "onMetadata" | "discoveryStatus" | "hasStoredKey">) {
  return (
    <section className="settings-section" id="settings-tmdb">
      <h2>TMDB</h2>
      <p className="muted">
        Trending titles on Home, matched to your servers, with artwork and
        descriptions.
      </p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          onMetadata(
            String(form.get("key") || "").trim(),
            form.get("remember") === "on",
          );
        }}
      >
        <label>
          API key or read access token
          <input
            name="key"
            type="password"
            autoComplete="off"
            placeholder={hasStoredKey ? "Key in use" : "Paste your key"}
          />
        </label>
        <label className="check-row">
          <input name="remember" type="checkbox" />
          Remember on this device
        </label>
        <button className="button secondary">
          {hasStoredKey ? "Replace" : "Connect"}
        </button>
        {hasStoredKey && (
          <button
            type="button"
            className="button text"
            onClick={() => onMetadata("", false)}
          >
            Remove
          </button>
        )}
      </form>
      {hasStoredKey && (
        <p
          className={`discovery-status ${discoveryStatus === "ready" ? "ok" : ""}`}
          role="status"
        >
          {discoveryStatus === "loading" && "Connecting…"}
          {discoveryStatus === "ready" && "Connected"}
          {discoveryStatus === "rejected" && "TMDB rejected this key"}
          {discoveryStatus === "unavailable" && "TMDB is unreachable"}
        </p>
      )}
      <p className="fine-print">
        <a
          href="https://www.themoviedb.org/"
          target="_blank"
          rel="noreferrer"
          className="tmdb-credit"
        >
          <img
            src={appAsset("/branding/tmdb.svg")}
            width="92"
            height="12"
            alt="The Movie Database (TMDB)"
          />
        </a>
        This product uses the TMDB API but is not endorsed or certified by TMDB.
        Use your own key under the{" "}
        <a
          href="https://developer.themoviedb.org/docs/faq"
          target="_blank"
          rel="noreferrer"
        >
          TMDB terms
        </a>
        ; the free tier is non-commercial.
      </p>
    </section>
  );
}
