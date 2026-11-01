import { useEffect, useRef, useState } from "preact/hooks";
import { data } from "../app/data";
import { registry } from "../core/module";
import { appReady } from "../app/runtime";
import { rememberRole } from "../core/env";
import { parseDoc } from "../core/lww";
import { claim } from "../remote/controller";
import { pairedTvs, parsePairingHash, say, toast } from "../remote/pairing";
import { Empty, Home, ListPage, SearchPage } from "./Home";
import { Icon } from "./icons";
import { controller, startLink } from "./link";
import { ServersEditor, TmdbSetup, TvList } from "./Manage";
import { Remote } from "./Remote";
import { go, hash, replace, route, searchPath } from "./router";
import { TitlePage } from "./Title";
import { Watch } from "./Watch";

// The whole app outside a TV: a responsive website from phone to desktop. It browses, plays
// in the browser, and is the remote and setup for a paired TV.
export function WebApp() {
  useEffect(() => startLink(), []);
  const pair = parsePairingHash(hash.value);
  const r = route.value;

  // Each page starts at the top, like a page load.
  useEffect(() => {
    if (!pair) window.scrollTo(0, 0);
  }, [r.name === "title" ? r.id : r.name, r.name === "section" ? r.id : ""]);

  if (pair)
    return (
      <div class="web">
        <Pairing tvId={pair.tvId} code={pair.code} secret={pair.key} onDone={() => { replace(appReady() ? "#/remote" : "#/setup"); }} />
        {toast.value && <div class="toast">{toast.value}</div>}
      </div>
    );
  if (r.name === "watch")
    return (
      <div class="web watching">
        <Watch route={r} />
        {toast.value && <div class="toast">{toast.value}</div>}
      </div>
    );

  return (
    <div class="web">
      <Header />
      <main>
        {r.name === "home" && <Home section="home" />}
        {r.name === "section" && <Home section={r.id} />}
        {r.name === "list" && <ListPage />}
        {r.name === "search" && <SearchPage q={r.q} />}
        {r.name === "title" && <TitlePage route={r} />}
        {r.name === "remote" && <div class="wrap narrow"><Remote /></div>}
        {r.name === "setup" && <div class="wrap"><Setup /></div>}
      </main>
      <TabBar />
      {toast.value && <div class="toast">{toast.value}</div>}
    </div>
  );
}

function sections() {
  const out: { id: string; label: string }[] = [];
  for (const m of registry.all()) if (m.ready()) for (const s of m.sections) out.push(s);
  return out;
}

function Header() {
  const r = route.value;
  const secs = sections();
  const c = controller.value;
  const online = !!c && c.tvOnline.value;
  const q = r.name === "search" ? r.q : "";
  const input = useRef<HTMLInputElement>(null);
  const [lifted, setLifted] = useState(false);
  useEffect(() => {
    const on = () => setLifted(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  // "/" jumps to the search box, like most sites.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && t && !/INPUT|TEXTAREA|SELECT/.test(t.tagName)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  const active = (name: string, id?: string) => (r.name === name && (id === undefined || (r.name === "section" && r.id === id)) ? " on" : "");
  return (
    <header class={"top" + (lifted ? " lifted" : "")}>
      <a class="brand" href="#/" aria-label="Open TV home">
        <span class="brand-mark"><Icon name="play" size={12} /></span>
        <span>Open<b>TV</b></span>
      </a>
      <nav class="links" aria-label="Main">
        <a class={"lnk" + active("home")} href="#/">Home</a>
        {secs.map((s) => <a key={s.id} class={"lnk" + active("section", s.id)} href={`#/s/${s.id}`}>{s.label}</a>)}
        <a class={"lnk" + active("list")} href="#/list">My List</a>
      </nav>
      <label class="search">
        <Icon name="search" size={18} />
        <input
          ref={input}
          type="search"
          placeholder="Search titles"
          aria-label="Search"
          value={q}
          enterKeyHint="search"
          onKeyDown={(e) => { if (e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            if (!v.trim()) return go("#/");
            // Typing replaces the search address instead of adding a history entry per letter.
            if (r.name === "search") replace(searchPath(v));
            else go(searchPath(v));
          }}
        />
      </label>
      <div class="top-end">
        <a class={"lnk remote-link" + active("remote")} href="#/remote" title={c ? (online ? `${c.tvName.value} is connected` : `${c.tvName.value} is offline`) : "Pair a TV"}>
          <span class={"dot" + (online ? " on" : "")} /> Remote
        </a>
        <a class={"lnk" + active("setup")} href="#/setup">Setup</a>
      </div>
    </header>
  );
}

// Phones: the main places, under the thumb.
function TabBar() {
  const r = route.value;
  const c = controller.value;
  const online = !!c && c.tvOnline.value;
  const tab = (href: string, label: string, icon: string, on: boolean, dot = false) => (
    <a class={on ? "on" : ""} href={href} aria-current={on ? "page" : undefined}>
      <Icon name={icon} size={22} />
      <span>{label}{dot && <i class={"dot" + (online ? " on" : "")} />}</span>
    </a>
  );
  return (
    <nav class="tabs" aria-label="Tabs">
      {tab("#/", "Browse", "home", r.name === "home" || r.name === "section" || r.name === "title" || r.name === "search" || r.name === "list")}
      {tab("#/remote", "Remote", "remote", r.name === "remote", !!c)}
      {tab("#/setup", "Setup", "settings", r.name === "setup")}
    </nav>
  );
}

function Pairing({ tvId, code, secret, onDone }: { tvId: string; code: string; secret: string; onDone: () => void }) {
  const [state, setState] = useState<{ phase: "working" | "failed"; message: string }>({ phase: "working", message: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setState({ phase: "working", message: "" });
    claim(tvId, code, secret, pairedTvs.value.find((t) => t.tvId === tvId)).then(
      (tv) => { say(`Paired with ${tv.name}`); onDone(); },
      (e: Error) => setState({ phase: "failed", message: e.message }),
    );
  }, [tvId, code, secret, attempt]);
  return (
    <div class="empty">
      {state.phase === "working" ? (
        <><div class="spinner" /><h2>Connecting to your TV…</h2></>
      ) : (
        <>
          <h2>Could not pair</h2>
          <p class="error">{state.message}</p>
          <p class="hint">Codes work once and expire after 10 minutes. If the TV shows a new code, scan that one.</p>
          <button class="btn primary" onClick={() => setAttempt(attempt + 1)}>Try again</button>
          <button class="btn" onClick={onDone}>Cancel</button>
        </>
      )}
    </div>
  );
}

function Setup() {
  const key = !!data.tmdbKey.value;
  const server = data.servers.value.some((s) => s.enabled);
  const tv = pairedTvs.value.length > 0;
  return (
    <div class="setup-page">
      <h1>Setup</h1>
      <ol class="steps">
        <li class={key ? "done" : ""}>1 · TMDB key</li>
        <li class={server ? "done" : ""}>2 · A server</li>
        <li class={tv ? "done" : ""}>3 · Pair a TV <small>(optional)</small></li>
      </ol>
      <div class="cols">
        <div>
          <TmdbSetup />
          <ServersEditor />
        </div>
        <div>
          <TvList />
          <Backup />
          <section class="card-box">
            <h3>About</h3>
            <p class="hint">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
            <button class="btn" onClick={() => { rememberRole("tv"); location.href = location.pathname + "?tv=1"; }}>Use this device as a TV</button>
            <p class="hint">Open TV {__APP_VERSION__}</p>
          </section>
        </div>
      </div>
      {!appReady() && <Empty title="Nothing to watch yet">Complete steps 1 and 2.</Empty>}
    </div>
  );
}

// Everything lives on the device, so a backup file is how you move or keep it.
function Backup() {
  const file = useRef<HTMLInputElement>(null);
  const exportFile = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data.exportDoc()], { type: "application/json" }));
    a.download = "open-tv-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importFile = async (f: File) => {
    try {
      const parsed = JSON.parse(await f.text()) as { app?: string; doc?: unknown };
      const doc = parsed.app === "open-tv" ? parseDoc(parsed.doc) : null;
      if (!doc) return say("That is not an Open TV backup");
      const n = data.importDoc(doc);
      say(n ? `Restored ${n} item${n === 1 ? "" : "s"}` : "Nothing newer in that backup");
    } catch {
      say("That file could not be read");
    }
  };
  return (
    <section class="card-box">
      <h3>Backup</h3>
      <p class="hint">Your key, servers, list and progress live on this device. The file includes your TMDB key and server addresses, so keep it private.</p>
      <button class="btn" onClick={exportFile}>Download backup</button>
      <button class="btn" onClick={() => file.current?.click()}>Restore…</button>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void importFile(f); (e.target as HTMLInputElement).value = ""; }} />
    </section>
  );
}
