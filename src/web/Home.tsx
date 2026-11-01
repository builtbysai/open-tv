import { useEffect, useRef, useState } from "preact/hooks";
import { data } from "../app/data";
import { useAsync } from "../app/hooks";
import { resumeLabel } from "../app/runtime";
import { refKey, registry, type MediaRef, type Rail } from "../core/module";
import { hue, Icon, monogram } from "./icons";
import { play } from "./play";
import { titlePath } from "./router";

// ---- pieces -------------------------------------------------------------------------------

const kindName = (i: MediaRef) => (i.kind === "movie" ? "Movie" : i.kind === "tv" ? "Series" : "");

// Fades a picture in once it has loaded, and drops it (leaving the monogram) if it never does.
export const shown = (el: HTMLImageElement | null) => {
  if (el && el.complete && el.naturalWidth) el.classList.add("in");
};
export const loaded = (e: Event) => (e.target as HTMLImageElement).classList.add("in");
const broken = (e: Event) => (e.target as HTMLImageElement).classList.add("bad");

// One title. A link (so it can be opened in a new tab and shared) with a save button beside it.
export function Card({ item, note, wide }: { item: MediaRef; note?: string | null; wide?: boolean }) {
  const p = data.progressOf(item);
  const pct = p && !p.done && p.d > 0 ? Math.min(100, Math.round((p.t / p.d) * 100)) : 0;
  const art = wide ? item.backdrop || item.poster : item.poster;
  const listed = data.inList(item);
  const sub = note || [item.year || "", kindName(item)].filter(Boolean).join(" · ");
  return (
    <div class={"card" + (wide ? " wide" : "")}>
      <a class="card-link" href={titlePath(item)}>
        <span class="art" style={{ "--h": hue(item.title) } as never}>
          <span class="fallback" aria-hidden="true"><b>{monogram(item.title)}</b></span>
          {art && <img ref={shown} src={art} alt="" loading="lazy" decoding="async" onLoad={loaded} onError={broken} />}
          {pct > 0 && <span class="pbar"><span style={{ width: pct + "%" }} /></span>}
        </span>
        <span class="cap">
          <b>{item.title}</b>
          {sub && <small>{sub}</small>}
        </span>
      </a>
      <button class={"card-save" + (listed ? " on" : "")} aria-label={listed ? `Remove ${item.title} from My List` : `Add ${item.title} to My List`} onClick={() => data.toggleList(item)}>
        <Icon name={listed ? "check" : "plus"} size={18} />
      </button>
    </div>
  );
}

// A row of titles. Touch and trackpads just scroll; the arrows are for the mouse.
export function Row({ title, items, notes, wide, href }: { title: string; items: MediaRef[]; notes?: (i: MediaRef) => string | null; wide?: boolean; href?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: true });
  const measure = () => {
    const t = track.current;
    if (t) setEdge({ l: t.scrollLeft > 4, r: t.scrollLeft + t.clientWidth < t.scrollWidth - 4 });
  };
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [items.length]);
  const by = (dir: number) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <section class="row" aria-label={title}>
      <div class="row-head">
        <h2>{href ? <a href={href}>{title}</a> : title}</h2>
        <div class="row-arrows">
          <button class="round" disabled={!edge.l} onClick={() => by(-1)} aria-label={`${title}: earlier`}><Icon name="left" size={18} /></button>
          <button class="round" disabled={!edge.r} onClick={() => by(1)} aria-label={`${title}: more`}><Icon name="right" size={18} /></button>
        </div>
      </div>
      <div class={"track" + (wide ? " wide" : "")} ref={track} onScroll={measure}>
        {items.map((i) => <Card key={refKey(i)} item={i} wide={wide} note={notes ? notes(i) : null} />)}
      </div>
    </section>
  );
}

export const Grid = ({ items }: { items: MediaRef[] }) => (
  <div class="grid">{items.map((i) => <Card key={refKey(i)} item={i} />)}</div>
);

const reduceMotion = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The big banner: a few of today's titles, turning over by themselves until you point at it.
export function Hero({ items }: { items: MediaRef[] }) {
  const [at, setAt] = useState(0);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (hold || items.length < 2 || reduceMotion()) return;
    const t = setInterval(() => setAt((n) => (n + 1) % items.length), 9000);
    return () => clearInterval(t);
  }, [hold, items.length]);
  const item = items[at % items.length];
  const facts = [item.year ? String(item.year) : "", item.rating ? "★ " + item.rating.toFixed(1) : "", kindName(item)].filter(Boolean);
  const start = () => play(item.kind === "tv" ? { ...(data.progressOf(item)?.ref ?? { ...item, kind: "episode", season: 1, episode: 1 }) } : item);
  return (
    <section class="hero" aria-roledescription="carousel" aria-label="Featured" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocusIn={() => setHold(true)} onFocusOut={() => setHold(false)}>
      {items.map((it, n) => <img key={refKey(it)} class={"hero-img" + (n === at ? " on" : "")} src={it.backdrop} alt="" loading={n === 0 ? "eager" : "lazy"} />)}
      <div class="hero-shade" />
      <div class="wrap">
        <div class="hero-copy" key={refKey(item)}>
          <p class="eyebrow">Trending now</p>
          <h1>{item.title}</h1>
          <p class="facts">{facts.join("  ·  ")}</p>
          {item.overview && <p class="blurb">{item.overview}</p>}
          <div class="actions">
            <button class="btn primary" onClick={start}><Icon name="play" size={18} /> Play</button>
            <a class="btn ghost" href={titlePath(item)}><Icon name="info" size={18} /> More info</a>
          </div>
        </div>
        {items.length > 1 && (
          <div class="hero-dots">
            {items.map((it, n) => <button key={refKey(it)} class={n === at ? "on" : ""} aria-label={`Show ${it.title}`} aria-current={n === at} onClick={() => setAt(n)} />)}
          </div>
        )}
      </div>
    </section>
  );
}

export const Empty = ({ title, children, icon }: { title: string; children?: unknown; icon?: string }) => (
  <div class="empty">
    {icon && <span class="empty-icon"><Icon name={icon} size={28} /></span>}
    <h2>{title}</h2>
    {children ? <p>{children as string}</p> : null}
  </div>
);

const RowSkeleton = () => (
  <div class="skeleton" aria-busy="true">
    <i class="sk-title" />
    <div>{[0, 1, 2, 3, 4, 5, 6].map((n) => <i key={n} class="sk-card" />)}</div>
  </div>
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
      <div class="wrap">
        <div class="empty">
          <span class="empty-icon"><Icon name="settings" size={28} /></span>
          <h2>Almost there</h2>
          <p>Add your TMDB key and a server to start watching.</p>
          <a class="btn primary" href="#/setup">Set up</a>
        </div>
      </div>
    );
  const cont = section === "home" ? data.continueWatching.value : [];
  const mine = section === "home" ? data.list.value : [];
  // The first picture-ready title of each rail, without repeats.
  const seen: Record<string, boolean> = {};
  const featured: MediaRef[] = [];
  for (const r of rails.value ?? []) {
    const pick = r.items.filter((i) => i.backdrop && !seen[refKey(i)])[0];
    if (pick && featured.length < 5) {
      seen[refKey(pick)] = true;
      featured.push(pick);
    }
  }
  return (
    <div class="home">
      {featured.length > 0 && <Hero items={featured} />}
      <div class="wrap">
        {cont.length > 0 && <Row title="Continue watching" wide items={cont.map((p) => p.ref)} notes={resumeLabel} />}
        {mine.length > 0 && <Row title="My List" href="#/list" items={mine} />}
        {rails.loading && !rails.value && (
          <>
            <RowSkeleton />
            <RowSkeleton />
          </>
        )}
        {rails.error && !rails.value && (
          <div class="empty">
            <span class="empty-icon"><Icon name="info" size={28} /></span>
            <h2>{rails.kind === "auth" ? "TMDB rejected your key" : "Could not load"}</h2>
            <p>{rails.error}</p>
            <button class="btn primary" onClick={rails.retry}><Icon name="retry" size={18} /> Try again</button>
            <a class="btn ghost" href="#/setup">Setup</a>
          </div>
        )}
        {(rails.value ?? []).map((r) => <Row key={r.id} title={r.title} items={r.items} />)}
      </div>
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
  const text = q.trim();
  if (text.length < 2) return <div class="wrap"><Empty icon="search" title="Search">Type at least two letters.</Empty></div>;
  if (found.loading && !found.value) return <div class="wrap"><RowSkeleton /></div>;
  const items = found.value ?? [];
  return (
    <div class="wrap page">
      {items.length ? (
        <>
          <h1 class="page-title">Results for “{text}”</h1>
          <Grid items={items} />
        </>
      ) : (
        <Empty icon="search" title={`Nothing found for “${text}”`}>{found.error || "Try another spelling, or fewer words."}</Empty>
      )}
    </div>
  );
}

export function ListPage() {
  const items = data.list.value;
  return (
    <div class="wrap page">
      {items.length ? (
        <>
          <h1 class="page-title">My List</h1>
          <Grid items={items} />
        </>
      ) : (
        <Empty icon="plus" title="Your list is empty">Press + on any title to keep it here. It follows you to every device you pair.</Empty>
      )}
    </div>
  );
}
