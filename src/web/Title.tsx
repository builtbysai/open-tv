import { useState } from "preact/hooks";
import { data } from "../app/data";
import { useAsync } from "../app/hooks";
import { moduleOf, resumeLabel } from "../app/runtime";
import type { Details, MediaRef, Season } from "../core/module";
import { say } from "../remote/pairing";
import { Empty, loaded, Row, shown } from "./Home";
import { hue, Icon, monogram } from "./icons";
import { controller, tell } from "./link";
import { effectiveTarget, play, setTarget } from "./play";
import { back, type Route } from "./router";

// A title: what it is, where to watch it (this browser or the paired TV), and for a show, its
// seasons and episodes.
export function TitlePage({ route }: { route: Extract<Route, { name: "title" }> }) {
  const stub: MediaRef = { mod: route.mod, kind: route.kind, id: route.id, title: "" };
  const mod = moduleOf(stub);
  const info = useAsync<Details>(
    (signal) => (mod?.details ? mod.details(stub, { signal }) : Promise.reject(new Error("This title is not available."))),
    [route.mod, route.kind, route.id],
  );
  const d = info.value;
  const item = d?.ref ?? stub;
  const isShow = item.kind === "tv";
  const [chosen, setChosen] = useState(0);
  const seasonNo = chosen || d?.seasons?.[0]?.number || 0;
  const eps = useAsync<Season | null>(
    (signal) => (isShow && mod?.episodes && seasonNo ? mod.episodes(item, seasonNo, { signal }) : Promise.resolve(null)),
    [route.id, seasonNo, isShow],
  );
  const c = controller.value;
  const tvName = c?.tvName.value || "TV";
  const where = effectiveTarget();

  if (info.error && !d)
    return (
      <div class="wrap">
        <Empty icon="info" title="Could not open this title">{info.error}</Empty>
        <div class="empty-actions">
          <button class="btn ghost" onClick={() => back("#/")}><Icon name="back" size={18} /> Back</button>
          <button class="btn primary" onClick={info.retry}><Icon name="retry" size={18} /> Try again</button>
        </div>
      </div>
    );
  if (!d) return <div class="title-skeleton" aria-busy="true"><i /></div>;

  const saved = data.progressOf(item);
  const target1: MediaRef = isShow ? saved?.ref ?? { ...item, kind: "episode", season: 1, episode: 1 } : item;
  const label = resumeLabel(item) ?? (isShow ? "Play S1 E1" : "Play");
  const listed = data.inList(item);
  const kind = item.kind === "movie" ? "Movie" : "Series";

  return (
    <article class="title">
      <div class="title-bg" style={item.backdrop ? { backgroundImage: `url(${item.backdrop})` } : undefined} />
      <div class="wrap title-body">
        <button class="crumb" onClick={() => back("#/")}><Icon name="back" size={18} /> Back</button>
        <div class="title-head">
          <div class="title-poster" style={{ "--h": hue(item.title) } as never}>
            <span class="fallback" aria-hidden="true"><b>{monogram(item.title)}</b></span>
            {item.poster && <img src={item.poster} alt="" onLoad={loaded} ref={shown} />}
          </div>
          <div class="title-info">
            <p class="eyebrow">{kind}</p>
            <h1>{item.title}</h1>
            <p class="facts">{d.facts.join("  ·  ")}</p>
            {d.genres.length > 0 && <p class="chips">{d.genres.map((g) => <span key={g}>{g}</span>)}</p>}
            {d.tagline && <p class="tagline">{d.tagline}</p>}
            {item.overview && <p class="blurb">{item.overview}</p>}
            {d.cast.length > 0 && <p class="cast"><b>Starring</b> {d.cast.slice(0, 6).join(", ")}</p>}

            {c && (
              <div class="seg" role="group" aria-label="Where to watch">
                <button class={where === "here" ? "on" : ""} onClick={() => setTarget("here")}>This device</button>
                <button class={where === "tv" ? "on" : ""} onClick={() => setTarget("tv")}>{tvName}</button>
              </div>
            )}
            <div class="actions">
              <button class="btn primary" onClick={() => play(target1)}><Icon name="play" size={18} /> {label}{where === "tv" ? ` on ${tvName}` : ""}</button>
              <button class={"btn ghost" + (listed ? " on" : "")} onClick={() => data.toggleList(item)}>
                <Icon name={listed ? "check" : "plus"} size={18} /> {listed ? "In My List" : "My List"}
              </button>
              {c && (
                <button class="btn ghost" onClick={() => void tell({ t: "open", ref: item }).then((ok) => ok && say(`Opened on ${tvName}`))}>
                  <Icon name="tv" size={18} /> Show on {tvName}
                </button>
              )}
            </div>
          </div>
        </div>

        {isShow && d.seasons && d.seasons.length > 0 && (
          <section class="episodes" aria-label="Episodes">
            <div class="ep-head">
              <h2>Episodes</h2>
              {d.seasons.length > 1 && (
                <div class="season-tabs" role="tablist" aria-label="Season">
                  {d.seasons.map((s) => (
                    <button key={s.number} role="tab" aria-selected={s.number === seasonNo} class={s.number === seasonNo ? "on" : ""} onClick={() => setChosen(s.number)}>{s.name}</button>
                  ))}
                </div>
              )}
            </div>
            <ul class="ep-list">
              {(eps.value?.episodes ?? []).map((e) => {
                const cur = saved && saved.ref.season === e.season && saved.ref.episode === e.episode;
                const pct = cur && saved && !saved.done && saved.d > 0 ? Math.min(100, Math.round((saved.t / saved.d) * 100)) : 0;
                return (
                  <li key={e.episode}>
                    <button class="ep" onClick={() => play(e)}>
                      <span class="ep-n">{e.episode}</span>
                      <span class="ep-still">
                        {e.poster && <img src={e.poster} alt="" loading="lazy" onLoad={loaded} ref={shown} />}
                        <span class="ep-play"><Icon name="play" size={22} /></span>
                        {pct > 0 && <span class="pbar"><span style={{ width: pct + "%" }} /></span>}
                      </span>
                      <span class="ep-text">
                        <b>{e.epTitle || e.title}</b>
                        {cur && saved && !saved.done && saved.t > 15 && <em>Resume from {Math.floor(saved.t / 60)}m</em>}
                        {e.overview && <small>{e.overview}</small>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {eps.loading && !eps.value && <p class="hint">Loading episodes…</p>}
          </section>
        )}

        {d.related.length > 0 && <Row title="More like this" items={d.related} />}
      </div>
    </article>
  );
}
