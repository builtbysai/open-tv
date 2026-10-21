import { useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "../components/Brand";
import { Send, Check, Tv } from "lucide-react";
import { controlRelay } from "../config/control";
import { claimPairing } from "../remote/useRemote";
import { deviceName } from "../remote/name";
import { mediaUrl, persistableUrl } from "../domain/urls";
import { sources as builtInSources } from "../providers/registry";
import { readServers } from "../persistence/servers";
import { loadRegistry, profileStorage } from "../persistence/accounts";
import { exportProfile } from "../persistence/profile";
import { loadUserState } from "../persistence/user-state";
import { BUNDLE_LIFETIME } from "../transfer/bundle";
import { encrypt, randomToken } from "../transfer/crypto";
import { publish, splitMessage } from "../transfer/relay";
function params() {
  const query = new URLSearchParams(location.hash.split("?")[1] || "");
  const room = query.get("r") || "",
    key = query.get("k") || "";
  const tv = query.get("tv") || "",
    code = query.get("c") || "";
  return /^[A-Za-z0-9_-]{16,40}$/.test(room) &&
    /^[A-Za-z0-9_-]{40,50}$/.test(key)
    ? {
        room,
        key,
        // The TV's one-time code for pairing this phone as its remote.
        claim:
          /^[A-Za-z0-9_-]{16,64}$/.test(tv) &&
          /^[A-Za-z0-9_-]{16,64}$/.test(code)
            ? { tv, code }
            : null,
      }
    : null;
}
type PairState = "pairing" | "paired" | "failed";
function savedSources() {
  try {
    const list = JSON.parse(localStorage.getItem("opentv:sources:v1") || "[]");
    const builtIn = new Set(builtInSources.map((s) => s.id));
    // Only sources the person added; the bundled directory presets exist on every device.
    return (Array.isArray(list) ? list : []).filter(
      (s) =>
        s?.kind === "m3u" &&
        !builtIn.has(s.id) &&
        typeof s.url === "string" &&
        persistableUrl(new URL(s.url, location.href).href),
    );
  } catch {
    return [];
  }
}
// The general sources connected on this phone (built-in and extension lists), by id.
function connectedSources(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem("opentv:sources:v1") || "[]");
    const fromExtension = JSON.parse(
      localStorage.getItem("opentv:extension-enabled:v1") || "{}",
    ) as Record<string, boolean>;
    return [
      ...(Array.isArray(list) ? list : [])
        .filter((s) => s?.enabled === true && s.classification === "general")
        .map((s) => String(s.id)),
      ...Object.entries(fromExtension)
        .filter(([, on]) => on === true)
        .map(([id]) => id),
    ].filter((id) => /^[a-z0-9-]{1,63}$/.test(id));
  } catch {
    return [];
  }
}
const hostName = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Playlist";
  }
};
export default function PairSend() {
  const link = useMemo(params, []);
  const sources = useMemo(savedSources, []);
  const connected = useMemo(connectedSources, []);
  const [includeConnected, setIncludeConnected] = useState(true);
  const servers = useMemo(() => {
    try {
      return readServers(localStorage);
    } catch {
      return [];
    }
  }, []);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [includeSaved, setIncludeSaved] = useState(true),
    [includeProfile, setIncludeProfile] = useState(false);
  const hasSaved = sources.length + servers.length > 0;
  const [paired, setPaired] = useState<{
    state: PairState;
    name: string;
  } | null>(() =>
    link?.claim && controlRelay ? { state: "pairing", name: "" } : null,
  );
  // A pairing code works once; claim it once per page.
  const claimed = useRef(false);
  useEffect(() => {
    const claim = link?.claim;
    if (!claim || !controlRelay || claimed.current) return;
    claimed.current = true;
    claimPairing(claim.tv, claim.code, deviceName()).then(
      (pairing) => setPaired({ state: "paired", name: pairing.name }),
      () => setPaired({ state: "failed", name: "" }),
    );
  }, [link]);
  const home = (() => {
    const url = new URL(location.href);
    url.hash = "#/home";
    return url.href;
  })();
  const pairCard = paired && (
    <section className={`pair-remote ${paired.state}`} role="status">
      <Tv size={22} />
      <div>
        <strong>
          {paired.state === "pairing"
            ? "Pairing with your TV…"
            : paired.state === "paired"
              ? "Paired. This phone is now your TV’s remote."
              : "Couldn’t pair with the TV"}
        </strong>
        <p className="muted">
          {paired.state === "paired"
            ? "Open Open TV here, pick anything and choose Play on TV. It stays paired."
            : paired.state === "failed"
              ? "The code may have expired. Scan the code on the TV again."
              : "One moment."}
        </p>
        {paired.state === "paired" && (
          <a className="button primary" href={home}>
            Open Open TV
          </a>
        )}
      </div>
    </section>
  );
  if (!link)
    return (
      <main className="pair-page">
        <h1>Scan the code on your TV</h1>
        <p className="muted">
          This link is incomplete. Open Settings on your TV and scan the code
          again.
        </p>
      </main>
    );
  const send = async (form: FormData) => {
    setState("sending");
    try {
      const classification = String(form.get("classification") || "general");
      const playlists = String(form.get("playlists") || "")
        .split(/\s+/)
        .map((line) => mediaUrl(line))
        .filter((url): url is string => !!url)
        .map((url) => ({
          name: hostName(url),
          url,
          kind: "m3u",
          classification,
        }));
      const server = mediaUrl(String(form.get("server") || ""));
      const username = String(form.get("username") || "").trim();
      const password = String(form.get("password") || "");
      let profile: unknown;
      if (includeProfile) {
        const registry = loadRegistry(localStorage);
        profile = exportProfile(
          loadUserState(profileStorage(localStorage, registry.active)),
        );
      }
      const bundle = {
        v: 1,
        exp: Date.now() + BUNDLE_LIFETIME,
        playlists: [...playlists, ...(includeSaved ? sources : [])],
        servers: includeSaved ? servers : [],
        tmdbKey: String(form.get("tmdb") || "").trim() || undefined,
        account:
          server && username && password
            ? { server, username, password, mode: String(form.get("mode")) }
            : undefined,
        profile,
        connect: includeConnected && connected.length ? connected : undefined,
      };
      await publish(
        link.room,
        splitMessage(randomToken(6), await encrypt(link.key, bundle)),
      );
      setState("sent");
    } catch {
      setState("error");
    }
  };
  if (state === "sent")
    return (
      <main className="pair-page">
        <span className="pair-done">
          <Check size={28} />
        </span>
        <h1>Sent</h1>
        {pairCard}
        <p className="muted">Confirm the import on your TV.</p>
        <button className="button secondary" onClick={() => setState("idle")}>
          Send more
        </button>
      </main>
    );
  return (
    <main className="pair-page">
      <div className="brand">
        <Brand />
      </div>
      {pairCard}
      <h1>Send to your TV</h1>
      <p className="muted">
        {paired
          ? "Optional: send playlists, servers or keys to the TV itself. Nothing here is stored on this phone."
          : "Fill in what you need. Nothing is stored on this phone."}
      </p>
      <form
        className="pair-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send(new FormData(event.currentTarget));
        }}
      >
        <fieldset>
          <legend>Playlists</legend>
          <label>
            Playlist URLs
            <textarea
              name="playlists"
              rows={3}
              placeholder="One address per line"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <label>
            Classification
            <select name="classification" defaultValue="general">
              <option value="general">
                General · adult-looking titles stay hidden
              </option>
              <option value="adult">18+ · hidden until shown</option>
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend>Xtream account</legend>
          <label>
            Server
            <input
              name="server"
              type="url"
              placeholder="https://provider.example"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <label>
            Username
            <input
              name="username"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="off" />
          </label>
          <label>
            Catalog
            <select name="mode" defaultValue="movie">
              <option value="live">Live TV</option>
              <option value="movie">Movies</option>
              <option value="series">Series</option>
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend>TMDB</legend>
          <label>
            API key or read access token
            <input
              name="tmdb"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
        </fieldset>
        {hasSaved && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={includeSaved}
              onChange={(event) => setIncludeSaved(event.target.checked)}
            />
            Include {sources.length + servers.length} source
            {sources.length + servers.length === 1 ? "" : "s"} saved on this
            phone
          </label>
        )}
        {connected.length > 0 && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={includeConnected}
              onChange={(event) => setIncludeConnected(event.target.checked)}
            />
            Connect the same {connected.length} source
            {connected.length === 1 ? "" : "s"} on the TV
          </label>
        )}
        <label className="check-row">
          <input
            type="checkbox"
            checked={includeProfile}
            onChange={(event) => setIncludeProfile(event.target.checked)}
          />
          Include my list and watch history
        </label>
        {state === "error" && (
          <p role="alert" className="pair-error">
            Couldn’t reach the transfer service. Try again.
          </p>
        )}
        <button className="button primary" disabled={state === "sending"}>
          <Send size={16} />
          {state === "sending" ? "Sending…" : "Send to TV"}
        </button>
      </form>
    </main>
  );
}
