import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { moduleOf, startFor } from "../app/runtime";
import { Icon } from "./icons";
import { playbackUnlocked } from "../core/env";
import type { MediaRef } from "../core/module";
import { rendererFor } from "../player/renderers";
import { back, refFromRoute, replace, watchPath, type Route } from "./router";
import { webSession as session } from "./play";

const fullscreen = signal(false);
const unlock = signal(false);
const SEEK = 10;

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(x).padStart(2, "0");
};
const same = (a: MediaRef | null, b: MediaRef) => !!a && a.mod === b.mod && a.id === b.id && a.season === b.season && a.episode === b.episode;

// A link opened directly has only ids. Fill in the title (and episode name) so the player,
// resume and "Up next" have what they need.
async function hydrate(want: MediaRef): Promise<MediaRef> {
  const m = moduleOf(want);
  if (!m?.details) return { ...want, title: want.title || "Untitled" };
  try {
    const d = await m.details({ ...want, kind: want.kind === "episode" ? "tv" : want.kind }, {});
    const base: MediaRef = { ...d.ref, kind: want.kind, season: want.season, episode: want.episode };
    if (want.kind === "episode" && m.episodes && want.season !== undefined) {
      const season = await m.episodes({ ...d.ref, kind: "tv" }, want.season, {});
      return season.episodes.find((e) => e.episode === want.episode) ?? base;
    }
    return base;
  } catch {
    return { ...want, title: want.title || "Untitled" };
  }
}

export function Watch({ route }: { route: Extract<Route, { name: "watch" }> }) {
  const root = useRef<HTMLDivElement>(null);
  const key = watchPath({ ...refFromRoute(route) });

  // Make the session match the address (a refresh, a shared link).
  useEffect(() => {
    const want = refFromRoute(route);
    if (same(session.ref.value, want)) return;
    let cancelled = false;
    void hydrate(want).then((ref) => {
      if (!cancelled) session.play(ref, startFor(ref));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // The other way: when the session moves on (next episode), so does the address.
  useEffect(() => {
    const ref = session.ref.value;
    if (ref && !same(ref, refFromRoute(route))) replace(watchPath(ref));
  }, [session.ref.value]);

  useEffect(() => () => session.stop(), []);
  // Arriving by a link (no click on this page yet), browsers block autoplay with sound.
  useEffect(() => {
    unlock.value = !playbackUnlocked();
  }, [key]);

  // Shortcuts, when this page (not the video's own page) has the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const c = session.caps.value;
      const k = e.key.toLowerCase();
      if ((k === " " || k === "k") && c.controlled) session.command({ c: "toggle" });
      else if (k === "arrowleft" && c.seek) session.command({ c: "seekBy", by: -SEEK });
      else if (k === "arrowright" && c.seek) session.command({ c: "seekBy", by: SEEK });
      else if (k === "m" && c.mute) session.command({ c: "mute", on: !session.state.value.muted });
      else if (k === "f") toggleFullscreen(root.current);
      else if (k === "n") session.playNext();
      else return;
      e.preventDefault();
    };
    const onFs = () => (fullscreen.value = !!fsElement());
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
      if (fsElement()) exitFs();
    };
  }, []);

  // Next episode after a short pause (cancellable).
  const status = session.status.value;
  useEffect(() => {
    if (status !== "ended" || !session.upNext.value) return;
    const t = setTimeout(() => session.upNext.value && session.playNext(), 8000);
    return () => clearTimeout(t);
  }, [status, session.upNext.value]);

  const ref = session.ref.value;
  const src = session.current.value;
  const Render = src ? rendererFor(src.type) : undefined;
  const b = session.state.value;
  const caps = session.caps.value;
  const count = session.sources.value.length;
  const failed = status === "failed";
  const sub = ref && ref.kind === "episode" ? `S${ref.season} E${ref.episode}${ref.epTitle ? ` · ${ref.epTitle}` : ""}` : "";
  const seek = b.duration > 0 ? Math.min(b.time, b.duration) : 0;

  return (
    <div class={"watch" + (fullscreen.value ? " fs" : "")} ref={root}>
      <div class="watch-bar">
        <button class="wbtn" onClick={() => back("#/")} aria-label="Back"><Icon name="back" size={20} /></button>
        <div class="watch-title">
          <b>{ref?.title ?? ""}</b>
          {sub && <span>{sub}</span>}
        </div>
        {count > 1 && (
          <select aria-label="Server" value={src?.id} onChange={(e) => session.select((e.target as HTMLSelectElement).value)}>
            {session.sources.value.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
        {session.hasNext.value && <button class="wbtn text" onClick={() => session.playNext()}>Next <Icon name="skip" size={16} /></button>}
        <button class="wbtn" onClick={() => toggleFullscreen(root.current)} aria-label="Full screen"><Icon name={fullscreen.value ? "shrink" : "expand"} size={20} /></button>
      </div>

      <div class="watch-stage">
        {src && Render && <Render key={session.nonce.value + ":" + src.id} source={src} session={session} onKey={() => {}} />}

        {status === "loading" && <div class="veil"><div class="spinner" /><p>Starting on {src?.label}…</p></div>}

        {unlock.value && status === "live" && !failed && (
          <div class="veil"><button class="btn primary big" onClick={() => { unlock.value = false; session.command({ c: "play" }); }}><Icon name="play" size={22} /> Play</button></div>
        )}

        {failed && (
          <div class="veil">
            <h2>{src ? "This server did not work" : "No server available"}</h2>
            <p>{session.failure.value || "Add a server in Setup."}</p>
            <div class="actions">
              {session.index.value + 1 < count && <button class="btn primary" onClick={() => session.nextSource()}>Try next server</button>}
              {src && <button class="btn" onClick={() => session.retry()}>Retry</button>}
              {!src && <a class="btn primary" href="#/setup">Open setup</a>}
            </div>
          </div>
        )}

        {status === "silent" && !caps.controlled && (
          <p class="silent-note">{src?.label} has no remote-control support; use its own player controls.</p>
        )}

        {status === "ended" && (
          <div class="veil">
            {session.upNext.value ? (
              <>
                <h2>Up next</h2>
                <p>{session.upNext.value.title} · S{session.upNext.value.season} E{session.upNext.value.episode}</p>
                <div class="actions">
                  <button class="btn primary" onClick={() => session.playNext()}>Play now</button>
                  <button class="btn" onClick={() => session.cancelUpNext()}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <h2>Finished</h2>
                <div class="actions">
                  <button class="btn primary" onClick={() => session.retry()}>Watch again</button>
                  <button class="btn" onClick={() => back("#/")}>Close</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {caps.controlled && !fullscreen.value && (
        <div class="watch-controls">
          <button class="wbtn" onClick={() => session.command({ c: "toggle" })} aria-label={b.playing ? "Pause" : "Play"}><Icon name={b.playing ? "pause" : "play"} size={20} /></button>
          {caps.seek && <button class="wbtn text" onClick={() => session.command({ c: "seekBy", by: -SEEK })}>−10</button>}
          {caps.seek && <button class="wbtn text" onClick={() => session.command({ c: "seekBy", by: SEEK })}>+10</button>}
          <span class="time">{clock(seek)}</span>
          {caps.seek && b.duration > 0 ? (
            <input class="scrub-range" type="range" min={0} max={Math.floor(b.duration)} value={Math.floor(seek)} aria-label="Seek" onChange={(e) => session.command({ c: "seek", to: Number((e.target as HTMLInputElement).value) })} />
          ) : <span class="grow" />}
          <span class="time">{clock(b.duration)}</span>
          {caps.mute && <button class="wbtn" onClick={() => session.command({ c: "mute", on: !b.muted })} aria-label={b.muted ? "Unmute" : "Mute"}><Icon name={b.muted ? "mute" : "volume"} size={20} /></button>}
          {caps.volume && <input class="vol-range" type="range" min={0} max={100} value={Math.round(b.volume * 100)} aria-label="Volume" onChange={(e) => session.command({ c: "volume", to: Number((e.target as HTMLInputElement).value) / 100 })} />}
        </div>
      )}
    </div>
  );
}

// Fullscreen, including the older WebKit names (Safari, some TV and tablet browsers).
type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
const fsElement = () => document.fullscreenElement || (document as FsDoc).webkitFullscreenElement || null;
const exitFs = () => (document.exitFullscreen ? void document.exitFullscreen() : (document as FsDoc).webkitExitFullscreen?.());
function toggleFullscreen(el: HTMLElement | null) {
  if (!el) return;
  if (fsElement()) return exitFs();
  const e = el as FsEl;
  try {
    if (e.requestFullscreen) void e.requestFullscreen();
    else e.webkitRequestFullscreen?.();
  } catch {
    /* Refused (no user gesture, or unsupported). */
  }
}
