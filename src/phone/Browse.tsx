import { useEffect, useState } from "preact/hooks";
import { data } from "../app/data";
import { useAsync } from "../app/hooks";
import { moduleOf, resumeLabel, startFor } from "../app/runtime";
import { registry, refKey, type Details, type MediaRef, type Rail, type Season } from "../core/module";
import { controller, tell } from "./link";

// Find something on the phone, send it to the TV.

export function PhoneBrowse({ onNeedSetup }: { onNeedSetup: () => void }) {
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState<MediaRef | null>(null);
  const ready = registry.all().filter((m) => m.ready());
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  const rails = useAsync<Rail[]>(
    async (signal) => {
      let failure: unknown = null;
      const lists = await Promise.all(ready.map((m) => m.rails("home", { signal }).catch((e) => ((failure = failure || e), [] as Rail[]))));
      const out: Rail[] = [];
      for (const l of lists) for (const r of l) out.push(r);
      if (!out.length && failure) throw failure;
      return out;
    },
    [data.tmdbKey.value, data.lang.value, ready.length],
  );
  const found = useAsync<MediaRef[]>(
    async (signal) => {
      if (q.length < 2) return [];
      const lists = await Promise.all(ready.map((m) => (m.search ? m.search(q, { signal }).catch(() => [] as MediaRef[]) : Promise.resolve([] as MediaRef[]))));
      const out: MediaRef[] = [];
      for (const l of lists) for (const r of l) out.push(r);
      return out;
    },
    [q, ready.length],
  );

  if (!ready.length)
    return <div class="empty"><h2>Almost there</h2><p>Add your TMDB key and a server to browse.</p><button class="btn primary" onClick={onNeedSetup}>Set up</button></div>;

  const cont = data.continueWatching.value;
  const mine = data.list.value;
  return (
    <div class="browse">
      <input class="search" type="search" placeholder="Search movies and shows" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} enterKeyHint="search" />
      {q.length >= 2 ? (
        found.loading ? <p class="hint">Searching…</p> : (found.value ?? []).length ? <Grid items={found.value ?? []} onPick={setSheet} /> : <p class="hint">{found.error || `Nothing found for “${q}”.`}</p>
      ) : (
        <>
          {cont.length > 0 && <Row title="Continue watching" items={cont.map((p) => p.ref)} onPick={setSheet} />}
          {mine.length > 0 && <Row title="My List" items={mine} onPick={setSheet} />}
          {rails.loading && !rails.value && <p class="hint">Loading…</p>}
          {rails.error && <p class="error">{rails.error}</p>}
          {(rails.value ?? []).map((r) => <Row key={r.id} title={r.title} items={r.items} onPick={setSheet} />)}
        </>
      )}
      {sheet && <Sheet item={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}

function Thumb({ item, onPick }: { item: MediaRef; onPick: (i: MediaRef) => void }) {
  return (
    <button class="thumb" onClick={() => onPick(item)}>
      {item.poster ? <img src={item.poster} alt="" decoding="async" /> : <span class="noimg">{item.title}</span>}
      <span class="cap">{item.title}</span>
    </button>
  );
}
const Row = ({ title, items, onPick }: { title: string; items: MediaRef[]; onPick: (i: MediaRef) => void }) => (
  <section class="prail"><h3>{title}</h3><div class="ptrack">{items.map((i) => <Thumb key={refKey(i)} item={i} onPick={onPick} />)}</div></section>
);
const Grid = ({ items, onPick }: { items: MediaRef[]; onPick: (i: MediaRef) => void }) => (
  <div class="pgrid">{items.map((i) => <Thumb key={refKey(i)} item={i} onPick={onPick} />)}</div>
);

function Sheet({ item, onClose }: { item: MediaRef; onClose: () => void }) {
  const mod = moduleOf(item);
  const info = useAsync<Details>((signal) => (mod?.details ? mod.details(item, { signal }) : Promise.reject(new Error("No details."))), [refKey(item)]);
  const d = info.value;
  const [season, setSeason] = useState(0);
  const seasonNo = season || d?.seasons?.[0]?.number || 0;
  const eps = useAsync<Season | null>(
    (signal) => (item.kind === "tv" && mod?.episodes && seasonNo ? mod.episodes(item, seasonNo, { signal }) : Promise.resolve(null)),
    [refKey(item), seasonNo],
  );
  const c = controller.value;
  const tvName = c?.tvName.value || "TV";
  const saved = data.progressOf(item);
  const target: MediaRef = item.kind === "tv" ? saved?.ref ?? { ...item, kind: "episode", season: 1, episode: 1 } : item;
  const label = resumeLabel(item) ?? (item.kind === "tv" ? "Play S1 E1" : "Play");
  const playOnTv = (ref: MediaRef) => void tell({ t: "play", ref, start: startFor(ref) }).then((ok) => ok && onClose());
  return (
    <div class="sheet-back" onClick={onClose}>
      <div class="sheet" onClick={(e) => e.stopPropagation()}>
        <button class="x" onClick={onClose} aria-label="Close">×</button>
        <h2>{item.title}</h2>
        <p class="facts">{(d?.facts ?? []).concat(d?.genres ?? []).join(" · ")}</p>
        <p class="blurb">{d?.ref.overview || item.overview}</p>
        <div class="actions">
          <button class="btn primary" disabled={!c} onClick={() => playOnTv(target)}>{c ? `${label} on ${tvName}` : "Pair a TV to play"}</button>
          <button class="btn" disabled={!c} onClick={() => void tell({ t: "open", ref: item }).then((ok) => ok && onClose())}>Show on TV</button>
          <button class="btn" onClick={() => data.toggleList(item)}>{data.inList(item) ? "In My List ✓" : "Add to My List"}</button>
        </div>
        {d?.seasons && d.seasons.length > 0 && (
          <>
            <select value={seasonNo} onChange={(e) => setSeason(Number((e.target as HTMLSelectElement).value))}>
              {d.seasons.map((s) => <option key={s.number} value={s.number}>{s.name}</option>)}
            </select>
            <ul class="eps">
              {(eps.value?.episodes ?? []).map((e) => (
                <li key={e.episode}><button onClick={() => playOnTv(e)}><b>{e.episode}</b> {e.epTitle || e.title}</button></li>
              ))}
            </ul>
          </>
        )}
        {info.error && !d && <p class="error">{info.error}</p>}
      </div>
    </div>
  );
}
