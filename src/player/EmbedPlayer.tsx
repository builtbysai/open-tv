import { useEffect, useRef } from "preact/hooks";
import type { PlaySource } from "../core/module";
import { FrameLink } from "./frame";
import type { PlaybackSession } from "./session";
import type { KeyName } from "./bridge";

type Embed = Extract<PlaySource, { type: "embed" }>;

// How long each stage may take before the session is told. A frame's `load` event fires even
// for an error page, so "loaded" proves little: only the bridge's `ready` proves the page is
// the player. A server known to speak the bridge that stays silent has failed; an unknown one
// that stays silent may simply have no bridge, and is left playing.
const LOAD_TIMEOUT = 20_000;
const KNOWN_SILENT = 12_000;
const UNKNOWN_SILENT = 6_000;

// The sandbox, when a server asks for one: scripts and same-origin storage so the player
// works, presentation and forms for its own controls. No pop-ups, no modals, no navigating the
// TV app away. `allow-same-origin` is safe here only because a server is never on the app's
// origin (servers.ts refuses that).
const SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-forms";

export function EmbedPlayer({
  source,
  session,
  onKey,
}: {
  source: Embed;
  session: PlaybackSession;
  onKey: (key: KeyName) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const link = useRef<FrameLink | null>(null);
  const keyHandler = useRef(onKey);
  keyHandler.current = onKey;

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let origin = "";
    try {
      origin = new URL(source.url).origin;
    } catch {
      session.setStatus("failed", "This server's address is not valid.");
      return;
    }
    const l = new FrameLink(el, origin);
    link.current = l;
    l.onKey = (key) => keyHandler.current(key);
    let loadTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => session.setStatus("failed", `${source.label} did not respond.`),
      LOAD_TIMEOUT,
    );
    let silentTimer: ReturnType<typeof setTimeout> | undefined;
    l.onReady = () => {
      clearTimeout(silentTimer);
      session.setStatus("live");
    };
    const stopLoadTimer = el.addEventListener
      ? (() => {
          const onLoad = () => {
            clearTimeout(loadTimer);
            loadTimer = undefined;
            l.handleLoad();
            const known = source.bridge === "yes";
            silentTimer = setTimeout(
              () =>
                known
                  ? session.setStatus("failed", `${source.label} loaded but its player did not answer.`)
                  : session.setStatus("silent"),
              known ? KNOWN_SILENT : UNKNOWN_SILENT,
            );
          };
          el.addEventListener("load", onLoad);
          return () => el.removeEventListener("load", onLoad);
        })()
      : () => {};
    // Mirror the link's state into the session, and give the session its handle.
    const unsubscribe = l.state.subscribe((s) => session.setState(s));
    session.attach({
      send: (cmd) => l.send(cmd),
      focus: () => l.focusFrame(),
      blur: () => l.blurFrame(),
    });
    l.start();
    return () => {
      clearTimeout(loadTimer);
      clearTimeout(silentTimer);
      stopLoadTimer();
      unsubscribe();
      l.stop();
      session.attach(null);
      link.current = null;
    };
    // The session remounts this component (a new `key`) for a retry or the next server.
  }, [source.url]);

  return (
    <iframe
      ref={frame}
      class="embed-frame"
      title={source.label}
      src={source.url}
      sandbox={source.sandbox ? SANDBOX : undefined}
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      // The origin only (no path): lets your server allow-list who may embed it, and reveals
      // nothing about what is being watched.
      referrerPolicy="origin"
    />
  );
}
