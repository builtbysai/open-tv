import { useEffect, useRef, useState } from "preact/hooks";
import { data } from "../app/data";
import { useAsync } from "../app/hooks";
import { resumeLabel } from "../app/runtime";
import { refKey, registry, type MediaRef, type Rail } from "../core/module";
import { play } from "./play";
import { titlePath } from "./router";

// ---- pieces -------------------------------------------------------------------------------

export function Thumb({ item, note }: { item: MediaRef; note?: string | null }) {
  const p = data.progressOf(item);
  const pct = p && !p.done && p.d > 0 ? Math.min(100, Math.round((p.t / p.d) * 100)) : 0;
  return (
    <a class="thumb" href={titlePath(item)} title={item.title}>
      <span class="art">
        {item.poster ? <img src={item.poster} alt="" loading="lazy" decoding="async" /> : <span class="noimg">{item.title}</span>}
        {pct > 0 && <span class="pbar"><span style={{ width: pct + "%" }} /></span>}
        {note && <span class="note">{note}</span>}
      </span>
      <span class="cap">{item.title}</span>
    </a>
  );
}

// A row of titles with arrows for mouse users (touch and trackpads just scroll).
export function Row({ title, items, notes }: { title: string; items: MediaRef[]; notes?: (i: MediaRef) => string | null }) {
  const track = useRef<HTMLDivElement>(null);
  const by = (dir: number) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <section class="prail">
      <h3>{title}</h3>
      <div class="prail-wrap">
        <button class="arrow left" onClick={() => by(-1)} aria-label={`${title}: earlier`}>‹</button>
        <div class="ptrack" ref={track}>{items.map((i) => <Thumb key={refKey(i)} item={i} note={notes ? notes(i) : null} />)}</div>
        <button class="arrow right" onClick={() => by(1)} aria-label={`${title}: more`}>›</button>
      </div>
    </section>
  );
}

export const Grid = ({ items }: { items: MediaRef[] }) => (
  <div class="pgrid">{items.map((i) => <Thumb key={refKey(i)} item={i} />)}</div>
);

export function Hero({ item }: { item: MediaRef }) {
  const facts = [item.year ? String(item.year) : "", item.rating ? "★ " + item.rating.toFixed(1) : "", item.kind === "movie" ? "Movie" : "Series"].filter(Boolean);
  return (
    <section class="hero" style={item.backdrop ? { backgroundImage: `url(${item.backdrop})` } : undefined}>
      <div class="hero-shade">
        <h1>{item.title}</h1>
        <p class="facts">{facts.join(" · ")}</p>
        {item.overview && <p class="blurb">{item.overview}</p>}
        <div class="actions">
          <button class="btn primary" onClick={() => play(item.kind === "tv" ? { ...(data.progressOf(item)?.ref ?? { ...item, kind: "episode", season: 1, episode: 1 }) } : item)}>▶ Play</button>
          <a class="btn" href={titlePath(item)}>Details</a>
        </div>
      </div>
    </section>
  );
}

export const Empty = ({ title, children }: { title: string; children?: unknown }) => (
  <div class="empty"><h2>{title}</h2>{children ? <p>{children as string}</p> : null}</div>
);

// ---- pages --------------------------------------------------------------------------------

export function Home({ section }: { section: string }) {
  const ready = registry.all().filter((m) => m.ready());
  const rails = useAsync<Rail[]>(
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
  if (!ready.length)
    return (
      <div class="empty">
        <h2>Almost there</h2>
        <p>Add your TMDB key and a server to start watching.</p>
        <a class="btn primary" href="#/setup">Set up</a>
      </div>
    );
  const cont = section === "home" ? data.continueWatching.value : [];
  const mine = section === "home" ? data.list.value : [];
  const featured = (rails.value ?? []).map((r) => r.items.filter((i) => i.backdrop)[0]).filter(Boolean)[0];
  return (
    <div class="home">
      {featured && <Hero item={featured} />}
      {cont.length > 0 && <Row title="Continue watching" items={cont.map((p) => p.ref)} notes={resumeLabel} />}
      {mine.length > 0 && <Row title="My List" items={mine} />}
      {rails.loading && !rails.value && <div class="skeleton" aria-busy="true"><div /><div /><div /><div /><div /></div>}
      {rails.error && !rails.value && (
        <div class="empty">
          <h2>{rails.kind === "auth" ? "TMDB rejected your key" : "Could not load"}</h2>
          <p>{rails.error}</p>
          <button class="btn primary" onClick={rails.retry}>Try again</button>
          <a class="btn" href="#/setup">Setup</a>
        </div>
      )}
      {(rails.value ?? []).map((r) => <Row key={r.id} title={r.title} items={r.items} />)}
    </div>
  );
}

export function SearchPage({ q }: { q: string }) {
  const ready = registry.all().filter((m) => m.ready() && m.search);
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const found = useAsync<MediaRef[]>(
    async (signal) => {
      if (debounced.length < 2) return [];
      const lists = await Promise.all(ready.map((m) => m.search!(debounced, { signal }).catch(() => [] as MediaRef[])));
      const out: MediaRef[] = [];
      for (const l of lists) for (const r of l) out.push(r);
      return out;
    },
    [debounced, ready.length],
  );
  if (q.trim().length < 2) return <Empty title="Search">Type at least two letters.</Empty>;
  if (found.loading && !found.value) return <div class="skeleton"><div /><div /><div /><div /><div /></div>;
  const items = found.value ?? [];
  return items.length ? <Grid items={items} /> : <Empty title={`Nothing found for “${q.trim()}”`}>{found.error}</Empty>;
}

export function ListPage() {
  const items = data.list.value;
  return items.length ? (
    <div class="page"><h2>My List</h2><Grid items={items} /></div>
  ) : (
    <Empty title="Your list is empty">Open a title and choose “Add to My List”. It follows you to every device you pair.</Empty>
  );
}
