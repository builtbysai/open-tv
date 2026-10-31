import { useEffect, useRef, useState } from "preact/hooks";
import { data } from "../app/data";
import { randomId } from "../core/crypto";
import { DEFAULT_EPISODE, DEFAULT_MOVIE, PRESETS, validPattern } from "../modules/movies/pattern";
import { importServers, normalizeBase, previewUrls, validateServer, type Server } from "../modules/movies/servers";
import { Tmdb } from "../modules/movies/tmdb";
import { FrameLink } from "../player/frame";
import { activeTvId, forgetTv, pairedTvs, say } from "../remote/pairing";
import { controller } from "./link";

// ---- TMDB key ---------------------------------------------------------------------------------

export function TmdbSetup({ onDone }: { onDone?: () => void }) {
  const [key, setKey] = useState(data.tmdbKey.value);
  const [state, setState] = useState<{ busy: boolean; msg: string; ok: boolean }>({ busy: false, msg: "", ok: false });
  const check = async () => {
    const k = key.trim();
    if (!k) return setState({ busy: false, ok: false, msg: "Paste your TMDB key first." });
    setState({ busy: true, ok: false, msg: "Checking…" });
    const r = await new Tmdb({ key: k, base: __TMDB_BASE__, imageBase: __TMDB_IMAGE_BASE__, lang: data.lang.value }).verify();
    if (r === "ok") {
      data.setTmdbKey(k);
      setState({ busy: false, ok: true, msg: "Key works and is saved." });
      onDone?.();
    } else
      setState({
        busy: false, ok: false,
        msg: r === "auth" ? "TMDB rejected that key. Use the “API Key” or the long “Read Access Token” from your TMDB account." : r === "rate" ? "TMDB is busy; try again in a moment." : "Could not reach TMDB. Check your connection.",
      });
  };
  return (
    <section class="card-box">
      <h3>TMDB key</h3>
      <p class="hint">Free from themoviedb.org → Settings → API. It stays on your devices (encrypted when synced to your TV).</p>
      <input value={key} placeholder="API key or read access token" autocomplete="off" autocapitalize="none" spellcheck={false} onInput={(e) => setKey((e.target as HTMLInputElement).value)} />
      <button class="btn primary" disabled={state.busy} onClick={check}>Check and save</button>
      {state.msg && <p class={state.ok ? "ok" : "error"}>{state.msg}</p>}
    </section>
  );
}

// ---- Servers ----------------------------------------------------------------------------------

type Form = { id: string; name: string; address: string; preset: string; movie: string; episode: string; sandbox: boolean; enabled: boolean; order: number; bridge: Server["bridge"] };

const toForm = (s?: Server): Form => {
  const preset = s ? PRESETS.find((p) => p.movie === (s.movie || DEFAULT_MOVIE) && p.episode === (s.episode || DEFAULT_EPISODE))?.id ?? "custom" : "embed";
  return {
    id: s?.id ?? randomId(8), name: s?.name ?? "", address: s?.base ?? "", preset,
    movie: s?.movie ?? DEFAULT_MOVIE, episode: s?.episode ?? DEFAULT_EPISODE,
    sandbox: s?.sandbox ?? false, enabled: s?.enabled ?? true, order: s?.order ?? data.servers.value.length, bridge: s?.bridge ?? "unknown",
  };
};

function build(f: Form): { server: Server } | { error: string } {
  const base = normalizeBase(f.address);
  if ("error" in base) return base;
  const p = f.preset === "custom" ? { movie: f.movie, episode: f.episode } : PRESETS.find((x) => x.id === f.preset) ?? PRESETS[0];
  if (!validPattern(p.movie, "movie")) return { error: "The movie pattern must start with {base} and contain {id}." };
  if (!validPattern(p.episode, "episode")) return { error: "The episode pattern must start with {base} and contain {id}, {season} and {episode}." };
  const server = validateServer({
    id: f.id, name: f.name.trim() || new URL(base.base).hostname, base: base.base,
    ...(p.movie === DEFAULT_MOVIE ? {} : { movie: p.movie }), ...(p.episode === DEFAULT_EPISODE ? {} : { episode: p.episode }),
    sandbox: f.sandbox, enabled: f.enabled, order: f.order, bridge: f.bridge,
  });
  return server ? { server } : { error: "That server could not be saved." };
}

export function ServersEditor() {
  const [editing, setEditing] = useState<Form | null>(null);
  const servers = data.servers.value;
  const fileRef = useRef<HTMLInputElement>(null);

  const importFile = async (file: File) => {
    try {
      const list = importServers(JSON.parse(await file.text()), () => randomId(8));
      list.forEach((s, i) => data.saveServer({ ...s, order: servers.length + i }));
      say(list.length ? `Imported ${list.length} (turned off until you enable them)` : "No valid servers in that file");
    } catch {
      say("That is not a valid servers file");
    }
  };
  const exportFile = () => {
    const blob = new Blob([JSON.stringify({ servers: servers.map(({ id: _i, enabled: _e, order: _o, bridge: _b, ...rest }) => rest) }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "open-tv-servers.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <section class="card-box">
      <h3>Your servers</h3>
      <p class="hint">Only add servers you are entitled to use. They are tried in this order; if one fails the TV moves to the next.</p>
      {servers.length === 0 && !editing && <p class="hint">No server yet.</p>}
      {servers.map((s, i) => (
        <div class="srv" key={s.id}>
          <div class="srv-main">
            <b>{s.name}</b> <small>{s.base}</small>
            <small>{s.bridge === "yes" ? "remote controls work" : "controls unverified"}{s.sandbox ? " · sandboxed" : ""}</small>
          </div>
          <div class="srv-btns">
            <button class="btn" onClick={() => data.saveServer({ ...s, enabled: !s.enabled })}>{s.enabled ? "On" : "Off"}</button>
            <button class="btn" disabled={i === 0} onClick={() => data.moveServer(s.id, -1)} aria-label="Move up">↑</button>
            <button class="btn" disabled={i === servers.length - 1} onClick={() => data.moveServer(s.id, 1)} aria-label="Move down">↓</button>
            <button class="btn" onClick={() => setEditing(toForm(s))}>Edit</button>
          </div>
        </div>
      ))}
      {editing ? (
        <ServerForm form={editing} exists={servers.some((s) => s.id === editing.id)} onClose={() => setEditing(null)} />
      ) : (
        <div class="actions">
          <button class="btn primary" onClick={() => setEditing(toForm())}>Add a server</button>
          <button class="btn" onClick={() => fileRef.current?.click()}>Import</button>
          {servers.length > 0 && <button class="btn" onClick={exportFile}>Export</button>}
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void importFile(f); (e.target as HTMLInputElement).value = ""; }} />
        </div>
      )}
    </section>
  );
}

function ServerForm({ form, exists, onClose }: { form: Form; exists: boolean; onClose: () => void }) {
  const [f, setF] = useState(form);
  const set = (patch: Partial<Form>) => setF({ ...f, ...patch });
  const built = f.address.trim() ? build(f) : null;
  const preview = built && "server" in built ? previewUrls(built.server) : null;
  return (
    <div class="form">
      <label>Name</label>
      <input value={f.name} placeholder="My server" onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
      <label>Address</label>
      <input value={f.address} placeholder="https://example.com" autocapitalize="none" autocomplete="off" spellcheck={false} onInput={(e) => set({ address: (e.target as HTMLInputElement).value, bridge: "unknown" })} />
      <label>Address pattern</label>
      <select value={f.preset} onChange={(e) => set({ preset: (e.target as HTMLSelectElement).value })}>
        {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        <option value="custom">Custom…</option>
      </select>
      {f.preset === "custom" && (
        <>
          <input value={f.movie} onInput={(e) => set({ movie: (e.target as HTMLInputElement).value })} aria-label="Movie pattern" />
          <input value={f.episode} onInput={(e) => set({ episode: (e.target as HTMLInputElement).value })} aria-label="Episode pattern" />
          <p class="hint">Placeholders: {"{base} {id} {season} {episode} {start}"}. Must begin with {"{base}"}.</p>
        </>
      )}
      {built && "error" in built && <p class="error">{built.error}</p>}
      {preview && (
        <div class="preview">
          <small>Movie</small><code>{preview.movie}</code>
          <small>Episode</small><code>{preview.episode}</code>
        </div>
      )}
      <label class="check"><input type="checkbox" checked={f.sandbox} onChange={(e) => set({ sandbox: (e.target as HTMLInputElement).checked })} /> Run in a sandbox (blocks pop-ups; some players refuse to play)</label>
      {preview?.movie && <ServerTest key={preview.movie + f.sandbox} url={preview.movie} sandbox={f.sandbox} onResult={(r) => r === "yes" && f.bridge !== "yes" && set({ bridge: "yes" })} />}
      <div class="actions">
        <button class="btn primary" disabled={!built || "error" in built} onClick={() => { if (built && "server" in built) { data.saveServer(built.server); onClose(); } }}>Save</button>
        <button class="btn" onClick={onClose}>Cancel</button>
        {exists && <button class="btn danger" onClick={() => { data.removeServer(f.id); onClose(); }}>Delete</button>}
      </div>
    </div>
  );
}

// Loads a sample title the way the TV will, and listens for the bridge. What it can prove:
// the page loaded and spoke the bridge. What it cannot: a frame that refuses to be embedded
// looks identical to one that loaded, so the person judges that from the picture.
function ServerTest({ url, sandbox, onResult }: { url: string; sandbox: boolean; onResult: (r: "yes" | "silent") => void }) {
  const [run, setRun] = useState(false);
  const [result, setResult] = useState<"" | "yes" | "silent">("");
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const el = frame.current;
    if (!run || !el) return;
    let origin = "";
    try { origin = new URL(url).origin; } catch { return; }
    const link = new FrameLink(el, origin);
    let timer: ReturnType<typeof setTimeout> | undefined;
    link.onReady = () => { clearTimeout(timer); setResult("yes"); onResult("yes"); };
    const onLoad = () => { link.handleLoad(); timer = setTimeout(() => { setResult((r) => r || "silent"); onResult("silent"); }, 8000); };
    el.addEventListener("load", onLoad);
    link.start();
    return () => { clearTimeout(timer); el.removeEventListener("load", onLoad); link.stop(); };
  }, [run]);
  if (!run) return <button class="btn" onClick={() => setRun(true)}>Test this server</button>;
  return (
    <div class="test">
      <div class="test-frame">
        <iframe ref={frame} src={url} title="Server test" sandbox={sandbox ? "allow-scripts allow-same-origin allow-presentation allow-forms" : undefined} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" referrerPolicy="origin" />
      </div>
      <p class={result === "yes" ? "ok" : "hint"}>
        {result === "yes" ? "The player answered: the remote can pause, seek and control volume."
          : result === "silent" ? "The page loaded but its player did not answer the remote protocol. It may still play; the remote just cannot pause or seek (use Video controls on the TV)."
          : "Loading a sample title…"}
      </p>
      <p class="hint">If the box above is blank or shows an error, the server is refusing to be shown inside another site. See the server guide (frame-ancestors).</p>
    </div>
  );
}

// ---- TVs --------------------------------------------------------------------------------------

export function TvList() {
  const tvs = pairedTvs.value;
  return (
    <section class="card-box">
      <h3>Your TVs</h3>
      {tvs.length === 0 && <p class="hint">Open Open TV on your TV and scan the code it shows with this phone's camera.</p>}
      {tvs.map((t) => (
        <div class="srv" key={t.tvId}>
          <div class="srv-main"><b>{t.name}</b>{t.tvId === (activeTvId.value || tvs[0]?.tvId) && <small>in use</small>}</div>
          <div class="srv-btns">
            {t.tvId !== (activeTvId.value || tvs[0]?.tvId) && <button class="btn" onClick={() => (activeTvId.value = t.tvId)}>Use</button>}
            <button class="btn danger" onClick={() => { if (controller.value && t.tvId === (activeTvId.value || tvs[0]?.tvId)) controller.value.revokeSelf(); forgetTv(t.tvId); }}>Forget</button>
          </div>
        </div>
      ))}
      <p class="hint">To add another TV, scan its code the same way.</p>
    </section>
  );
}
