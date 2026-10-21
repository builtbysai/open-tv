import { useEffect, useRef, useState } from "react";
import { ListPlus, Music2, Play, Search } from "lucide-react";
import type { Content } from "../domain/content";
import type { Route } from "../persistence/user-state";
import type { MusicState } from "../app/useMusic";
import { musicClient, MusicUnavailableError } from "../music/client";
import { playlistIdFrom, songContent } from "../music/content";
import type { Song } from "../music/types";
import { friendlyError } from "../domain/errors";

const clock = (seconds?: number) =>
  seconds
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
    : "";
// Trending is asked for once in a while, not every time the screen opens.
let trendingCache: { at: number; key: string; songs: Song[] } | null = null;
const TRENDING_TTL = 10 * 60_000;

function Thumb({ song }: { song: Song }) {
  const [failed, setFailed] = useState(false);
  return song.thumbnail && !failed ? (
    <img
      className="song-thumb"
      src={song.thumbnail}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="song-thumb song-thumb-empty" aria-hidden="true">
      <Music2 size={18} />
    </span>
  );
}

export function MusicScreen({
  music,
  tv,
  play,
  enqueue,
  enqueueAll,
  navigate,
  setNotice,
}: {
  music: MusicState;
  tv: boolean;
  play(item: Content): void;
  enqueue(item: Content): void;
  enqueueAll(items: Content[]): void;
  navigate(route: Route): void;
  setNotice(message: string): void;
}) {
  // The Internet Archive is built in, so Music works before anything is set up.
  const configured = music.providers.some((p) => p.enabled);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Song[] | null>(null);
  const [trending, setTrending] = useState<Song[]>(trendingCache?.songs ?? []);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [playlist, setPlaylist] = useState("");
  const abort = useRef<AbortController | null>(null);
  const providerKey = music.providers
    .filter((p) => p.enabled)
    .map((p) => p.id + p.base)
    .join("|");

  const guard = async <T,>(work: (signal: AbortSignal) => Promise<T>) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setProblem(null);
    try {
      return await work(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted)
        setProblem(
          error instanceof MusicUnavailableError
            ? error.message
            : friendlyError(error),
        );
      return undefined;
    } finally {
      if (abort.current === controller) setBusy(false);
    }
  };
  useEffect(() => {
    if (
      trendingCache?.key === providerKey &&
      Date.now() - trendingCache.at < TRENDING_TTL
    ) {
      setTrending(trendingCache.songs);
      return;
    }
    let canceled = false;
    const controller = new AbortController();
    musicClient
      .trending(controller.signal)
      .then((songs) => {
        if (canceled) return;
        trendingCache = { at: Date.now(), key: providerKey, songs };
        setTrending(songs);
      })
      .catch((error) => {
        if (!canceled && error instanceof MusicUnavailableError)
          setProblem(error.message);
      });
    return () => {
      canceled = true;
      controller.abort();
    };
    // The providers decide whether to ask again.
  }, [providerKey]);
  useEffect(() => () => abort.current?.abort(), []);

  const playSong = (song: Song) => {
    music.remember(song);
    play(songContent(song));
  };
  const search = async (text: string) => {
    const q = text.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const found = await guard((signal) => musicClient.search(q, signal));
    if (found) setResults(found.slice(0, 40));
  };
  const playPlaylist = async () => {
    const id = playlistIdFrom(playlist);
    if (!id) {
      setProblem("Paste a playlist address, or its ID.");
      return;
    }
    const songs = await guard((signal) => musicClient.playlist(id, signal));
    if (!songs) return;
    if (!songs.length) {
      setProblem("That playlist has no songs, or it is private.");
      return;
    }
    const items = songs.slice(0, 100).map(songContent);
    music.remember(songs[0]);
    play(items[0]);
    enqueueAll(items.slice(1));
    setNotice(`Playing a playlist of ${items.length} songs.`);
  };
  const row = (song: Song) => (
    <li className="song-row" key={song.id}>
      <button
        className="song-main"
        onClick={() => playSong(song)}
        aria-label={`Play ${song.title}${song.artist ? ` by ${song.artist}` : ""}`}
      >
        <Thumb song={song} />
        <span className="song-copy">
          <strong>{song.title}</strong>
          <span>{song.artist}</span>
          {song.source && <span className="song-source">{song.source}</span>}
        </span>
        <span className="song-time">{clock(song.duration)}</span>
        <Play size={16} aria-hidden="true" />
      </button>
      <button
        className="icon-button"
        aria-label={`Add ${song.title} to the queue`}
        onClick={() => enqueue(songContent(song))}
      >
        <ListPlus size={18} />
      </button>
    </li>
  );

  return (
    <div className="music-screen">
      {/* Searching means typing, which happens on the phone; the TV shows what's popular. */}
      {!tv && (
        <form
          className="search-box"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            void search(query);
          }}
        >
          <Search size={26} />
          <input
            type="search"
            aria-label="Search songs"
            placeholder="Search songs and artists"
            value={query}
            autoComplete="off"
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
      )}
      {!configured && !tv && (
        <div className="music-note">
          <p>
            Playing from the Internet Archive, built in. Audius is a free, open
            music service that needs no account.
          </p>
          <button
            className="button secondary"
            onClick={() =>
              music.save({
                id: music.newId(),
                name: "Audius",
                type: "audius",
                base: "https://api.audius.co",
                enabled: true,
              })
            }
          >
            Use Audius
          </button>
        </div>
      )}
      {problem && (
        <div className="music-problem" role="alert">
          <p>{problem}</p>
          <div className="actions">
            <button
              className="button secondary"
              onClick={() => void search(query)}
              disabled={!query.trim()}
            >
              Try again
            </button>
            <button
              className="button secondary"
              onClick={() => navigate("settings")}
            >
              Check provider addresses
            </button>
          </div>
        </div>
      )}
      {!!trending.length && (
        <section aria-label="Trending music" className="music-trending">
          <h2>Trending</h2>
          <ul className="song-rail">
            {trending.slice(0, 20).map((song) => (
              <li key={song.id}>
                <button
                  className="song-card"
                  onClick={() => playSong(song)}
                  aria-label={`Play ${song.title}${song.artist ? ` by ${song.artist}` : ""}`}
                >
                  <Thumb song={song} />
                  <strong>{song.title}</strong>
                  <span>{song.artist}</span>
                  {song.source && (
                    <span className="song-source">{song.source}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {busy && (
        <p className="muted" role="status">
          Looking…
        </p>
      )}
      {results && (
        <section aria-label="Search results">
          <h2>{results.length ? "Results" : "No songs found"}</h2>
          <ul className="song-list">{results.map(row)}</ul>
        </section>
      )}
      <details className="music-playlist">
        <summary>Play a playlist</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void playPlaylist();
          }}
        >
          <label>
            Playlist address or ID
            <input
              value={playlist}
              onChange={(event) => setPlaylist(event.target.value)}
              placeholder="https://…?list=PL…"
              autoComplete="off"
            />
          </label>
          <button className="button secondary" type="submit">
            Play playlist
          </button>
        </form>
      </details>
    </div>
  );
}
