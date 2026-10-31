import { useState } from "preact/hooks";
import { data } from "../app/data";
import { useAsync } from "../app/hooks";
import { moduleOf, resumeLabel } from "../app/runtime";
import type { Details, MediaRef, Season } from "../core/module";
import { say } from "../remote/pairing";
import { Empty, Row } from "./Home";
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
      <Empty title="Could not open this title">
        {info.error}
        <br />
        <button class="btn" onClick={() => back("#/")}>Back</button> <button class="btn primary" onClick={info.retry}>Try again</button>
      </Empty>
    );
  if (!d) return <div class="skeleton tall" aria-busy="true"><div /></div>;

  const saved = data.progressOf(item);
  const target1: MediaRef = isShow ? saved?.ref ?? { ...item, kind: "episode", season: 1, episode: 1 } : item;
  const label = resumeLabel(item) ?? (isShow ? "Play S1 E1" : "Play");
  const listed = data.inList(item);

  return (
    <article class="title" style={item.backdrop ? { backgroundImage: `url(${item.backdrop})` } : undefined}>
      <div class="title-shade">
        <div class="title-head">
          {item.poster && <img class="title-poster" src={item.poster} alt="" />}
          <div class="title-info">
            <h1>{item.title}</h1>
            <p class="facts">{d.facts.concat(d.genres).join(" · ")}</p>
            {d.tagline && <p class="tagline">{d.tagline}</p>}
            <p class="blurb">{item.overview}</p>
            {d.cast.length > 0 && <p class="cast">With {d.cast.slice(0, 6).join(", ")}</p>}

            {c && (
              <div class="seg" role="group" aria-label="Where to watch">
                <button class={where === "here" ? "on" : ""} onClick={() => setTarget("here")}>This device</button>
                <button class={where === "tv" ? "on" : ""} onClick={() => setTarget("tv")}>{tvName}</button>
              </div>
            )}
            <div class="actions">
              <button class="btn primary" onClick={() => play(target1)}>▶ {label}{where === "tv" ? ` on ${tvName}` : ""}</button>
              {c && <button class="btn" onClick={() => void tell({ t: "open", ref: item }).then((ok) => ok && say(`Opened on ${tvName}`))}>Show on {tvName}</button>}
              <button class="btn" onClick={() => data.toggleList(item)}>{listed ? "In My List ✓" : "+ My List"}</button>
            </div>
          </div>
        </div>

        {isShow && d.seasons && d.seasons.length > 0 && (
          <section class="episodes">
            <div class="ep-head">
              <h3>Episodes</h3>
              <select value={seasonNo} aria-label="Season" onChange={(e) => setChosen(Number((e.target as HTMLSelectElement).value))}>
                {d.seasons.map((s) => <option key={s.number} value={s.number}>{s.name}</option>)}
              </select>
            </div>
            <ul>
              {(eps.value?.episodes ?? []).map((e) => {
                const p = data.progressOf(item);
                const cur = p && p.ref.season === e.season && p.ref.episode === e.episode;
                return (
                  <li key={e.episode}>
                    <button onClick={() => play(e)}>
                      {e.poster ? <img src={e.poster} alt="" loading="lazy" /> : <span class="still" />}
                      <span class="ep-text">
                        <b>{e.episode}. {e.epTitle || e.title}</b>
                        {e.overview && <small>{e.overview}</small>}
                        {cur && !p!.done && p!.t > 15 && <em>Resume {Math.floor(p!.t / 60)}m</em>}
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
