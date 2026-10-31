import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { playbackUnlocked } from "../core/env";
import type { KeyName } from "../player/bridge";
import { rendererFor } from "../player/renderers";
import { focusInitial, mediaKey, navKey, onBack, pressBack, pushLayer } from "./nav";
import { session } from "./state";

// The player layer: the picture fills the screen and our controls sit above it. The picture
// is a frame we cannot press keys in, so the TV's remote talks to US (the page keeps the
// keyboard) and we pass commands to the picture through the bridge. When a server has no
// bridge, "Video controls" hands the keyboard to the picture instead.

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return (h ? h + ":" : "") + mm + ":" + String(x).padStart(2, "0");
};

export const pictureMode = signal(false);
const SEEK = 10;

export function PlayerScreen() {
  const ref = session.ref.value;
  const src = session.current.value;
  const status = session.status.value;
  const b = session.state.value;
  const caps = session.caps.value;
  const [hud, setHud] = useState(true);
  const [panel, setPanel] = useState(false);
  const [unlock, setUnlock] = useState(!playbackUnlocked());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const panelEl = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const hudRef = useRef(hud);
  hudRef.current = hud;
  const panelRef = useRef(panel);
  panelRef.current = panel;

  const poke = () => {
    setHud(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (session.phase.value === "playing" && !panelRef.current) setHud(false);
    }, 4500);
  };
  const toggle = () => {
    session.command({ c: "toggle" });
    poke();
  };
  const seekBy = (by: number) => {
    session.command({ c: "seekBy", by });
    poke();
  };

  // Keys the picture forwarded (a server that speaks the bridge keeps the keyboard when it is
  // focused and reports keys it does not use).
  const fromPicture = (key: KeyName) => {
    if (key === "back") return void pressBack();
    if (key === "menu" || key === "up" || key === "down") return poke();
    if (key === "ok") return toggle();
    if (key === "left") return seekBy(-SEEK);
    if (key === "right") return seekBy(SEEK);
  };

  useEffect(() => {
    poke();
    return () => clearTimeout(timer.current);
  }, [ref && ref.id, session.nonce.value]);

  // Back closes the panel first, then the player.
  useEffect(
    () =>
      onBack(() => {
        if (panelRef.current) {
          setPanel(false);
          return true;
        }
        pictureMode.value = false;
        session.stop();
        return true;
      }),
    [],
  );
  useEffect(() => {
    const show = () => poke();
    window.addEventListener("opentv:hud", show);
    return () => window.removeEventListener("opentv:hud", show);
  }, []);

  // With the HUD hidden the arrows and OK are the player's own; with it shown they move focus.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const m = mediaKey(e);
      if (m) {
        e.preventDefault();
        if (m === "toggle") toggle();
        else if (m === "play" || m === "pause") {
          session.command({ c: m });
          poke();
        }
        else if (m === "stop") pressBack();
        else if (m === "ff") seekBy(30);
        else if (m === "rw") seekBy(-30);
        return;
      }
      const k = navKey(e);
      if (!k || k === "back") return;
      poke();
      // On the seek bar, left/right seek and OK pauses, like any TV player.
      const el = document.activeElement as HTMLElement | null;
      if (!panelRef.current && el && el.getAttribute("data-f") === "p:seek" && (k === "left" || k === "right" || k === "ok")) {
        e.preventDefault();
        e.stopPropagation();
        if (k === "ok") toggle();
        else seekBy(k === "left" ? -SEEK : SEEK);
        return;
      }
      if (hudRef.current || panelRef.current) return; // the focus engine takes it
      e.preventDefault();
      e.stopPropagation();
      if (k === "ok") toggle();
      else if (k === "left") seekBy(-SEEK);
      else if (k === "right") seekBy(SEEK);
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, []);

  // A page inside the frame sometimes grabs the keyboard on its own; take it back unless the
  // person chose the picture's own controls.
  useEffect(() => {
    const t = setInterval(() => {
      if (!pictureMode.value && document.activeElement && document.activeElement.tagName === "IFRAME") session.releasePicture();
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Focus never leaves the player while it is up.
  useEffect(() => (root.current ? pushLayer(root.current) : undefined), [!!ref]);
  // Focus: into the panel or the HUD when they appear.
  useEffect(() => {
    if (panel && panelEl.current) return pushLayer(panelEl.current);
  }, [panel]);
  const seekable = caps.seek && b.duration > 0;
  useEffect(() => {
    if (panel) focusInitial();
    else if (hud) {
      // The seek bar appears once the duration is known; move focus onto it from the Play
      // button (but never steal it from a button the person chose).
      const now = (document.activeElement as HTMLElement | null)?.getAttribute("data-f");
      if (seekable && now && now !== "p:toggle") return;
      focusInitial("player");
    }
  }, [panel, hud, status, seekable]);

  // Next episode after a short pause.
  useEffect(() => {
    if (status !== "ended") return;
    const t = setTimeout(() => (session.upNext.value ? session.playNext() : session.stop()), session.upNext.value ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [status]);

  if (!ref) return null;
  const Render = src ? rendererFor(src.type) : undefined;
  const count = session.sources.value.length;
  const failed = status === "failed";
  const ended = status === "ended";
  const pct = b.duration > 0 ? Math.min(100, (b.time / b.duration) * 100) : 0;
  const sub = ref.kind === "episode" ? `S${ref.season} E${ref.episode}${ref.epTitle ? ` · ${ref.epTitle}` : ""}` : "";

  return (
    <div class="player" ref={root}>
      {src && Render && <Render key={session.nonce.value + ":" + src.id} source={src} session={session} onKey={fromPicture} />}

      {status === "loading" && !failed && (
        <div class="veil"><div class="spinner" /><p>Starting on {src?.label}…</p></div>
      )}

      {unlock && !failed && !ended && (
        <div class="veil">
          <button class="btn primary big" data-f="p:unlock" data-first onClick={() => { setUnlock(false); session.command({ c: "play" }); }}>
            Press OK to start
          </button>
        </div>
      )}

      {failed && (
        <div class="veil">
          <h2>{src ? "This server did not work" : "No server available"}</h2>
          <p>{session.failure.value}</p>
          <div class="actions">
            {session.index.value + 1 < count && <button class="btn primary" data-f="p:next-src" data-first onClick={() => session.nextSource()}>Try next server</button>}
            {src && <button class="btn" data-f="p:retry" onClick={() => session.retry()}>Retry</button>}
            <button class="btn" data-f="p:close" onClick={() => { session.stop(); }}>Close</button>
          </div>
        </div>
      )}

      {ended && (
        <div class="veil">
          {session.upNext.value ? (
            <>
              <h2>Up next</h2>
              <p>{session.upNext.value.title} · S{session.upNext.value.season} E{session.upNext.value.episode}</p>
              <div class="actions">
                <button class="btn primary" data-f="p:upnext" data-first onClick={() => session.playNext()}>Play now</button>
                <button class="btn" data-f="p:close" onClick={() => session.stop()}>Close</button>
              </div>
            </>
          ) : (
            <>
              <h2>Finished</h2>
              <div class="actions"><button class="btn primary" data-f="p:close" data-first onClick={() => session.stop()}>Close</button></div>
            </>
          )}
        </div>
      )}

      {hud && !failed && !ended && !unlock && !panel && (
        <div class="hud">
          <div class="hud-title">
            <h2>{ref.title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          {status === "silent" && !pictureMode.value && (
            <p class="hud-note">
              {src?.label} does not take remote controls. Use “Video controls”, or switch server.
            </p>
          )}
          {caps.seek && b.duration > 0 && (
            <div class="seek" data-f="p:seek" data-first tabIndex={0}>
              <span>{clock(b.time)}</span>
              <div class="seek-bar"><div style={{ width: pct + "%" }} /></div>
              <span>{clock(b.duration)}</span>
            </div>
          )}
          <div class="hud-buttons">
            {caps.controlled && <button class="btn" data-f="p:toggle" data-first={!(caps.seek && b.duration > 0) || undefined} onClick={toggle}>{session.phase.value === "playing" ? "Pause" : "Play"}</button>}
            {caps.seek && <button class="btn" data-f="p:rw" onClick={() => seekBy(-SEEK)}>−10s</button>}
            {caps.seek && <button class="btn" data-f="p:ff" onClick={() => seekBy(SEEK)}>+10s</button>}
            {session.hasNext.value && <button class="btn" data-f="p:next" onClick={() => session.playNext()}>Next episode</button>}
            {count > 1 && <button class="btn" data-f="p:servers" data-first={!caps.controlled || undefined} onClick={() => setPanel(true)}>Servers ({session.index.value + 1}/{count})</button>}
            {!caps.controlled && (
              <button class="btn" data-f="p:video" onClick={() => { pictureMode.value = true; session.focusPicture(); setHud(false); }}>
                Video controls
              </button>
            )}
            <button class="btn" data-f="p:close" onClick={() => session.stop()}>Close</button>
          </div>
        </div>
      )}

      {panel && (
        <div class="panel" ref={panelEl}>
          <h2>Servers</h2>
          {session.sources.value.map((s, i) => (
            <button key={s.id} class={"btn wide" + (i === session.index.value ? " on" : "")} data-f={`p:s:${s.id}`} onClick={() => { session.select(s.id); setPanel(false); }}>
              {s.label}{i === session.index.value ? " · playing" : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
