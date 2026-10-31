import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { data } from "../app/data";
import { refKey, type MediaRef, type Rail as RailData } from "../core/module";

// The item whose details the hero shows: whatever card has focus.
export const heroRef = signal<MediaRef | null>(null);

export function Poster({
  item,
  fid,
  onPick,
  note,
}: {
  item: MediaRef;
  fid: string;
  onPick: (item: MediaRef) => void;
  note?: string | null;
}) {
  const p = data.progressOf(item);
  const pct = p && !p.done && p.d > 0 ? Math.min(100, Math.round((p.t / p.d) * 100)) : 0;
  return (
    <button
      class="card"
      data-f={fid}
      onClick={() => onPick(item)}
      onFocus={() => (heroRef.value = item)}
    >
      {item.poster ? <img src={item.poster} alt="" decoding="async" /> : <span class="noimg">{item.title}</span>}
      {pct > 0 && (
        <span class="bar">
          <span style={{ width: pct + "%" }} />
        </span>
      )}
      {note && <span class="note">{note}</span>}
      <span class="cap">{item.title}</span>
    </button>
  );
}

export function RailRow({
  rail,
  onPick,
  notes,
}: {
  rail: RailData;
  onPick: (item: MediaRef) => void;
  notes?: (item: MediaRef) => string | null;
}) {
  return (
    <section class="rail">
      <h2>{rail.title}</h2>
      <div class="track">
        {rail.items.map((item) => (
          <Poster key={refKey(item)} item={item} fid={`${rail.id}:${refKey(item)}`} onPick={onPick} note={notes ? notes(item) : null} />
        ))}
      </div>
    </section>
  );
}

export function Hero({ item }: { item: MediaRef | null }) {
  const facts: string[] = [];
  if (item?.year) facts.push(String(item.year));
  if (item?.rating) facts.push("★ " + item.rating.toFixed(1));
  if (item) facts.push(item.kind === "movie" ? "Movie" : item.kind === "tv" ? "Series" : item.kind);
  return (
    <header class="hero" style={item?.backdrop ? { backgroundImage: `url(${item.backdrop})` } : undefined}>
      <div class="hero-shade">
        {item && (
          <>
            <h1>{item.title}</h1>
            <p class="facts">{facts.join("  ·  ")}</p>
            {item.overview && <p class="blurb">{item.overview}</p>}
          </>
        )}
      </div>
    </header>
  );
}

export function Message({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ComponentChildren;
  actions?: ComponentChildren;
}) {
  return (
    <div class="message">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div class="actions">{actions}</div>}
    </div>
  );
}
