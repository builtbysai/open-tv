import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { Qr } from "../app/Qr";
import { data } from "../app/data";
import { useAsync } from "../app/hooks";
import { appReady, moduleOf, resumeLabel } from "../app/runtime";
import { randomId } from "../core/crypto";
import { registry, refKey, type Details, type MediaRef, type Rail, type Season } from "../core/module";
import { DEFAULT_EPISODE, DEFAULT_MOVIE } from "../modules/movies/pattern";
import { normalizeBase, validateServer } from "../modules/movies/servers";
import { renameTv, tvIdentity } from "../remote/pairing";
import { focusInitial } from "./nav";
import { go, play, route, routeKey, searchText, tvHost, typing } from "./state";
import { Hero, heroRef, Message, RailRow } from "./ui";

const open = (ref: MediaRef) => go({ name: "details", ref });

// After content appears, put focus on it (the remembered card when coming back).
function useFocusWhen(ready: boolean) {
  useEffect(() => {
    if (ready) focusInitial(routeKey(route.value));
  }, [ready]);
}

// ---------------------------------------------------------------------------------------------

export function Setup() {
  const host = tvHost.value;
  const status = host?.client.link.value;
  const url = host ? host.pairingUrl() : "";
  const [manual, setManual] = useState(false);
  useEffect(() => {
    focusInitial("setup");
  }, [manual]);
  return (
    <div class="setup">
      <div class="setup-text">
        <h1>Welcome to Open TV</h1>
        <ol>
          <li>Scan this code with your phone's camera.</li>
          <li>Add your TMDB key and your server.</li>
          <li>Pick something to watch. Your phone is the remote.</li>
        </ol>
        <p class="hint">
          {status === "online" ? "Waiting for your phone…" : status === "refused" ? host?.client.reason.value : "Connecting to the remote service…"}
        </p>
        <button class="btn" data-f="setup:manual" data-first onClick={() => setManual(!manual)}>
          {manual ? "Hide" : "Set up on this TV instead"}
        </button>
      </div>
      <div class="setup-qr">{manual ? <TvSetupForm /> : <Qr text={url} label="Pairing code for your phone" />}</div>
    </div>
  );
}

// For a TV with a keyboard or a pointer: the minimum to get going without a phone.
function TvSetupForm() {
  const [key, setKey] = useState(data.tmdbKey.value);
  const [base, setBase] = useState("");
  const [error, setError] = useState("");
  const save = () => {
    const norm = base.trim() ? normalizeBase(base) : null;
    if (norm && "error" in norm) return setError(norm.error);
    if (!key.trim()) return setError("Enter your TMDB key.");
    data.setTmdbKey(key.trim());
    if (norm) {
      const s = validateServer({
        id: randomId(8), name: new URL(norm.base).hostname, base: norm.base, movie: DEFAULT_MOVIE, episode: DEFAULT_EPISODE,
        sandbox: false, enabled: true, order: data.servers.value.length, bridge: "unknown",
      });
      if (s) data.saveServer(s);
    }
    setError("");
  };
  return (
    <div class="form">
      <label>TMDB key</label>
      <input data-f="f:key" value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} />
      <label>Server address</label>
      <input data-f="f:base" placeholder="https://example.com" value={base} onInput={(e) => setBase((e.target as HTMLInputElement).value)} />
      {error && <p class="error">{error}</p>}
      <button class="btn" data-f="f:save" onClick={save}>Save</button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function Browse({ section }: { section: string }) {
  const ready = registry.all().filter((m) => m.ready());
  const rails = useAsync(
    async (signal) => {
      let failure: unknown = null;
      const lists = await Promise.all(ready.map((m) => m.rails(section, { signal }).catch((e) => ((failure = failure || e), [] as Rail[]))));
      const out: Rail[] = [];
      for (const l of lists) for (const r of l) out.push(r);
      if (!out.length && failure) throw failure;
      return out;
    },
    [section, data.tmdbKey.value, data.lang.value, ready.length],
  );
  const cont = section === "home" ? data.continueWatching.value : [];
  const mine = section === "home" ? data.list.value : [];
  const have = !!rails.value || cont.length > 0 || mine.length > 0;
  useFocusWhen(have);

  if (rails.loading && !have) return <Message title="Loading…" />;
  if (rails.error && !have)
    return (
      <Message
        title={rails.kind === "auth" ? "TMDB rejected your key" : "Could not load"}
        actions={
          <>
            <button class="btn" data-f="m:retry" data-first onClick={rails.retry}>Try again</button>
            <button class="btn" data-f="m:settings" onClick={() => go({ name: "settings" })}>Settings</button>
          </>
        }
      >
        {rails.error}
      </Message>
    );
  return (
    <div class="browse">
      <Hero item={heroRef.value} />
      <div class="rails">
        {cont.length > 0 && (
          <RailRow
            rail={{ id: "cont", title: "Continue watching", items: cont.map((p) => p.ref) }}
            onPick={(ref) => play(ref)}
            notes={(ref) => resumeLabel(ref)}
          />
        )}
        {mine.length > 0 && <RailRow rail={{ id: "mine", title: "My List", items: mine }} onPick={open} />}
        {(rails.value ?? []).map((r) => <RailRow key={r.id} rail={r} onPick={open} />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function Search() {
  const q = searchText.value.trim();
  const mods = registry.all().filter((m) => m.ready() && m.search);
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 400);
    return () => clearTimeout(t);
  }, [q]);
  const results = useAsync<MediaRef[]>(
    async (signal) => {
      if (debounced.length < 2) return [];
      const lists = await Promise.all(mods.map((m) => m.search!(debounced, { signal }).catch(() => [] as MediaRef[])));
      const out: MediaRef[] = [];
      for (const l of lists) for (const r of l) out.push(r);
      return out;
    },
    [debounced, mods.length],
  );
  useEffect(() => {
    focusInitial("search");
  }, []);
  const items = results.value ?? [];
  return (
    <div class="search">
      <input
        data-f="search:input"
        data-first
        class="search-input"
        placeholder="Search movies and shows — or type on your phone"
        value={searchText.value}
        onInput={(e) => (searchText.value = (e.target as HTMLInputElement).value)}
        onFocus={() => (typing.value = true)}
        onBlur={() => (typing.value = false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {q.length < 2 ? (
        <p class="hint">Search by title. The phone remote has a keyboard for this.</p>
      ) : results.loading && !items.length ? (
        <p class="hint">Searching…</p>
      ) : !items.length ? (
        <p class="hint">{results.error || `Nothing found for “${q}”.`}</p>
      ) : (
        <div class="grid">
          {items.map((it) => (
            <GridCard key={refKey(it)} item={it} />
          ))}
        </div>
      )}
    </div>
  );
}

function GridCard({ item }: { item: MediaRef }) {
  return (
    <button class="card" data-f={`g:${refKey(item)}`} onClick={() => open(item)}>
      {item.poster ? <img src={item.poster} alt="" decoding="async" /> : <span class="noimg">{item.title}</span>}
      <span class="cap">{item.title}</span>
    </button>
  );
}

export function MyList() {
  const items = data.list.value;
  useFocusWhen(items.length > 0);
  if (!items.length)
    return (
      <Message title="Your list is empty">Open a title and choose “Add to My List”. It will be here on every device.</Message>
    );
  return (
    <div class="search">
      <h1 class="page-title">My List</h1>
      <div class="grid">{items.map((it) => <GridCard key={refKey(it)} item={it} />)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function DetailsScreen({ item }: { item: MediaRef }) {
  const mod = moduleOf(item);
  const info = useAsync<Details>((signal) => (mod?.details ? mod.details(item, { signal }) : Promise.reject(new Error("No details."))), [refKey(item)]);
  const d = info.value;
  const [season, setSeason] = useState(0);
  const seasonNo = season || d?.seasons?.[0]?.number || 0;
  const isShow = item.kind === "tv";
  const eps = useAsync<Season | null>(
    (signal) => (isShow && mod?.episodes && seasonNo ? mod.episodes(item, seasonNo, { signal }) : Promise.resolve(null)),
    [refKey(item), seasonNo],
  );
  useFocusWhen(true);
  useEffect(() => {
    if (d) focusInitial(routeKey(route.value));
  }, [!!d]);

  const saved = data.progressOf(item);
  const target: MediaRef = isShow ? saved?.ref ?? { ...item, kind: "episode", season: 1, episode: 1 } : item;
  const label = resumeLabel(item) ?? (isShow ? "Play S1 E1" : "Play");
  const inList = data.inList(item);
  const shown = d?.ref ?? item;

  return (
    <div class="details" style={shown.backdrop ? { backgroundImage: `url(${shown.backdrop})` } : undefined}>
      <div class="details-shade">
        <h1>{item.title}</h1>
        <p class="facts">{(d?.facts ?? []).concat(d?.genres ?? []).join("  ·  ")}</p>
        {d?.tagline && <p class="tagline">{d.tagline}</p>}
        <p class="blurb long">{shown.overview || item.overview}</p>
        {d && d.cast.length > 0 && <p class="cast">With {d.cast.slice(0, 5).join(", ")}</p>}
        <div class="actions">
          <button class="btn primary" data-f="d:play" data-first onClick={() => play(target)}>{label}</button>
          <button class="btn" data-f="d:list" onClick={() => data.toggleList(item)}>{inList ? "In My List ✓" : "Add to My List"}</button>
        </div>
        {info.error && !d && <p class="error">{info.error}</p>}
        {isShow && d?.seasons && d.seasons.length > 0 && (
          <>
            <div class="chips">
              {d.seasons.map((s) => (
                <button key={s.number} class={"chip" + (s.number === seasonNo ? " on" : "")} data-f={`d:s${s.number}`} onClick={() => setSeason(s.number)}>
                  {s.name}
                </button>
              ))}
            </div>
            {eps.value && (
              <div class="track episodes">
                {eps.value.episodes.map((e) => (
                  <button key={e.episode} class="ep" data-f={`d:e${e.season}:${e.episode}`} onClick={() => play(e)}>
                    {e.poster ? <img src={e.poster} alt="" decoding="async" /> : <span class="noimg" />}
                    <span class="cap">{e.episode}. {e.epTitle || e.title}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {d && d.related.length > 0 && (
          <RailRow rail={{ id: "rel", title: "More like this", items: d.related }} onPick={open} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function Settings() {
  const host = tvHost.value;
  const phones = host?.phones.value ?? [];
  const servers = data.servers.value;
  const [pairing, setPairing] = useState(false);
  useEffect(() => {
    focusInitial("settings");
  }, []);
  return (
    <div class="settings">
      <h1 class="page-title">Settings</h1>

      <h2>Phones</h2>
      {phones.length === 0 && <p class="hint">No phone is paired yet.</p>}
      {phones.map((p) => (
        <div class="row" key={p.id}>
          <span>{p.name}{p.online ? " · connected" : ""}</span>
          <button class="btn" data-f={`s:rm:${p.id}`} onClick={() => host?.revoke(p.id)}>Remove</button>
        </div>
      ))}
      <button class="btn" data-f="s:pair" data-first onClick={() => setPairing(!pairing)}>{pairing ? "Hide code" : "Pair a phone"}</button>
      {pairing && host && <Qr text={host.pairingUrl()} label="Pairing code for your phone" />}

      <h2>Servers</h2>
      {servers.length === 0 && <p class="hint">No server yet. Add one from your phone.</p>}
      {servers.map((s) => (
        <div class="row" key={s.id}>
          <span>{s.name} <small>{s.base}</small></span>
          <button class="btn" data-f={`s:srv:${s.id}`} onClick={() => data.saveServer({ ...s, enabled: !s.enabled })}>
            {s.enabled ? "On" : "Off"}
          </button>
        </div>
      ))}

      <h2>This TV</h2>
      <div class="row">
        <span>Name: {host ? tvName() : "TV"}</span>
        <button class="btn" data-f="s:name" onClick={() => rename()}>Rename</button>
      </div>
      {!appReady() && <TvSetupForm />}

      <h2>About</h2>
      <p class="hint">
        <img class="tmdb" src="branding/tmdb.svg" alt="TMDB" /> This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
      <p class="hint">Open TV {__APP_VERSION__}</p>
    </div>
  );
}

const name = signal(tvIdentity().name);
const tvName = () => name.value;
function rename() {
  // A TV keyboard is slow; cycle through sensible names rather than ask for typing.
  const names = ["TV", "Living room", "Bedroom", "Kitchen", "Den"];
  const next = names[(names.indexOf(name.value) + 1) % names.length];
  renameTv(next);
  name.value = next;
  tvHost.value?.rename(next);
}
