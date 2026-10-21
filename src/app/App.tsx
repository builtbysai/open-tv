import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { Search, Play, LockKeyhole, X } from "lucide-react";
import { Toast } from "../components/Toast";
import { RemoteBar } from "../components/RemoteBar";
import { useRemote } from "../remote/useRemote";
import { deviceName, tvName } from "../remote/name";
import { playOnTv, remoteMessage, useTvReceiver } from "./useTvControl";
import { positionNow } from "../remote/items";
import { usePairings } from "../remote/pairings";
import { isAudio, type Content } from "../domain/content";
import { canView, queryCatalog } from "../domain/privacy";
import { applyContentPolicy } from "../domain/content-policy";
import { privateViewingEnabled } from "../config/safety";
import type { ReportTarget } from "../domain/reporting";
import { mergeProfile, parseProfile } from "../persistence/profile";
import {
  newData,
  rememberApplied,
  sameServer,
  type DataMode,
  type ExtensionData,
} from "../extension/data";
import type { ExtensionFile } from "../extension/format";
import { sources as builtInSources } from "../providers/registry";
import { sensitiveUrl, mediaUrl } from "../domain/urls";
import {
  playbackResolver,
  type PlaybackResolver,
  type RelayConnection,
} from "../playback/transport";
import { TmdbProvider } from "../providers/tmdb";
import { useDiscovery } from "./useDiscovery";
import { useTitles } from "./useTitles";
import { useSearch } from "./useSearch";
import { nextEpisode } from "../domain/episodes";
import { applyBundle, importedMessage } from "../transfer/apply";
import type { AccountDraft, Bundle } from "../transfer/bundle";
import { useSimilar } from "./useSimilar";
import { SearchIdle, SearchKinds } from "../screens/SearchTools";
import { deviceStorage, useProfiles } from "../components/ProfileGate";
import { profileStorage } from "../persistence/accounts";
import { loadTmdbKey, saveTmdbKey } from "../persistence/tmdb-key";
import { isArchive } from "../domain/discover";
import {
  contentAliases,
  loadUserState,
  progressFor,
  saveUserState,
  type UserState,
} from "../persistence/user-state";
import {
  AppHeader,
  MobileNavigation,
  AppFooter,
} from "../components/Navigation";
import { Browse } from "../screens/Browse";
import { useViewerSession } from "./useViewerSession";
import { useScrollRestoration } from "./useScrollRestoration";
import { useCatalog } from "./useCatalog";
import { useAccounts } from "./useAccounts";
import { hideReminder } from "../persistence/onboarding";
import { useServerLibrary } from "./useServerLibrary";
import { useViewerLists } from "./useViewerLists";
import { useOnboarding } from "./useOnboarding";
import { useSelection } from "./useSelection";
import { useCards } from "./useCards";
import { useExtension } from "./useExtension";
import { useMusic } from "./useMusic";
import { MusicScreen } from "../screens/Music";
import { musicClient, musicIdOf } from "../music/client";
import { useUserPatches } from "./useUserPatches";
import { DetailHost } from "./DetailHost";
import { PageHeading } from "../screens/PageHeading";
import { usePlaybackActions } from "./usePlaybackActions";
import { useLibraryActions } from "./useLibraryActions";
import { isKidsSafe } from "../domain/kids";
import { isTVMode } from "../tv/mode";
import { postDeviceMessage } from "../tv/device";
import { useCatalogUpdates } from "./useCatalogUpdates";
import { useGuide } from "./useGuide";
import { useRemoteNavigation } from "../tv/useRemoteNavigation";
import { Home } from "../screens/Home";
import { Skeleton } from "../components/Skeleton";
import { ListenTabs } from "../components/ListenTabs";
import { Confetti } from "../components/Confetti";
import { AdultUnlock } from "../components/AdultUnlock";
import {
  adultTrusted,
  adultWasActive,
  hasAdultConsent,
  setAdultActive,
  setAdultTrusted,
  phonesMayShowAdult,
} from "../persistence/adult-consent";
import { preloadScreens } from "./idle";
const builtInSourceIds: ReadonlySet<string> = new Set(
  builtInSources.map((s) => s.id),
);
// Settings and the grouping around it load together, only when the screen opens.
// Screens not every visit needs load when they are first shown.
const ReceiverIdle = lazy(() =>
  import("../components/ReceiverIdle").then((m) => ({
    default: m.ReceiverIdle,
  })),
);
const LibraryScreen = lazy(() =>
  import("../screens/Library").then((m) => ({ default: m.LibraryScreen })),
);
const Onboarding = lazy(() =>
  import("../components/Onboarding").then((m) => ({ default: m.Onboarding })),
);
const SettingsRoute = lazy(() =>
  import("./SettingsRoute").then((m) => ({ default: m.SettingsRoute })),
);
const Player = lazy(() =>
  import("../components/Player").then((m) => ({ default: m.Player })),
);
const Legal = lazy(() =>
  import("../components/Legal").then((m) => ({ default: m.Legal })),
);
function initialMetadata(): TmdbProvider | null {
  const key = loadTmdbKey();
  return key ? new TmdbProvider(key) : null;
}
const clock = (seconds: number) => {
  const s = Math.floor(seconds),
    h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
export default function App({ profileId }: { profileId: string }) {
  useEffect(preloadScreens, []);
  const [celebrate, setCelebrate] = useState(false);
  const storage = useMemo(
    () => profileStorage(deviceStorage(), profileId),
    [profileId],
  );
  const [tv] = useState(isTVMode);
  // On a TV the idle screen comes first; browsing there is the fallback, the phone the
  // main way to choose.
  // A link to a particular screen (#/live, #/settings) opens it directly.
  const [surface, setSurface] = useState<"idle" | "browse">(() =>
    tv && !/^#\/(?!home\b)\w/.test(location.hash) ? "idle" : "browse",
  );
  const [user, setUser] = useState(() => loadUserState(storage));
  const [reportTarget, setReportTarget] = useState<ReportTarget>();
  const [relay, setRelay] = useState<RelayConnection | null>(null);
  // Songs play through placeholder addresses that are resolved here, when their turn comes.
  const resolvePlayback = useMemo(() => {
    const inner = playbackResolver(relay);
    const resolver: PlaybackResolver = async (url, signal, format) =>
      inner(
        musicIdOf(url) ? await musicClient.resolveUrl(url, signal) : url,
        signal,
        format,
      );
    resolver.invalidate = inner.invalidate;
    return resolver;
  }, [relay]);
  const [adult, setAdult] = useState(false),
    [selected, setSelected] = useState<Content | null>(null),
    [playing, setPlaying] = useState<Content | null>(null),
    [restore, setRestore] = useState(true),
    [notice, setNotice] = useState(""),
    [metadata, setMetadata] = useState(initialMetadata);
  const profiles = useProfiles();
  // Only public trending lists are requested; the shelves are matched against your servers.
  const connectKey = (key: string, remember: boolean) => {
    saveTmdbKey(key, remember);
    setMetadata(key ? new TmdbProvider(key) : null);
  };
  const discovery = useDiscovery(metadata, true);
  // With a working TMDB key, trending titles replace the free-archive features.
  const curated =
    Boolean(metadata) &&
    discovery.status !== "rejected" &&
    discovery.status !== "unavailable";
  const updates = useCatalogUpdates();
  const guide = useGuide(adult);
  const rules = updates.manifest.policy;
  const policyRef = useRef(rules);
  policyRef.current = rules;
  const scrollPosition = useRef(0);
  const {
    route,
    query,
    view,
    genre,
    language,
    country,
    limit,
    navigate,
    updateView,
    setQuery,
  } = useViewerSession(user, setUser, scrollPosition);
  const extensionData = useRef<
    (file: ExtensionFile, mode: DataMode) => ExtensionData
  >(() => ({ musicProviders: [], servers: [] }));
  const extension = useExtension(builtInSourceIds, (file, mode) =>
    extensionData.current(file, mode),
  );
  const music = useMusic();
  const {
    sources,
    status,
    catalog,
    personalMedia,
    servers,
    saveServer,
    removeServer,
    replaceMedia,
    removeMedia,
    updateSource,
    reclassify,
    addItems,
    setDerivedItems,
    removeSource,
    connectAccount,
    loadEpisodes,
  } = useCatalog(adult, setNotice, updates, extension.sources);
  const accounts = useAccounts(connectAccount, setNotice);
  const { library, items: libraryTitles } = useServerLibrary(servers);
  useEffect(
    () => setDerivedItems("embed-library", libraryTitles),
    [libraryTitles, setDerivedItems],
  );
  useEffect(
    () => setDerivedItems("music", music.items),
    [music.items, setDerivedItems],
  );
  const publicProviderIds = useMemo(
    () =>
      new Set(
        sources
          .filter((definition) =>
            builtInSources.some(
              (source) =>
                source.id === definition.id &&
                source.url &&
                definition.url &&
                mediaUrl(source.url, location.href) ===
                  mediaUrl(definition.url, location.href),
            ),
          )
          .map((source) => source.id),
      ),
    [sources],
  );
  const content = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null),
    currentUser = useRef(user),
    privateRef = useRef(adult),
    routeRef = useRef(route);
  currentUser.current = user;
  privateRef.current = adult;
  routeRef.current = route;
  // Each screen eases in when the route changes.
  useEffect(() => {
    const element = content.current;
    if (!element) return;
    element.classList.remove("route-enter");
    void element.offsetWidth;
    element.classList.add("route-enter");
  }, [route]);
  const kids = profiles.active.kids === true;
  useEffect(() => {
    if (kids && (route === "settings" || route === "music")) navigate("home");
    // No typing on a TV, so no search screen there.
    if (tv && route === "search") navigate("home");
  }, [kids, tv, route, navigate]);
  const visible = useMemo(() => {
    const items = queryCatalog(catalog, {
      adultUnlocked: adult,
      policy: rules,
    });
    return kids ? items.filter(isKidsSafe) : items;
  }, [catalog, adult, rules, kids]);
  const playingAllowed = useMemo(
    () => playing && applyContentPolicy([playing], rules)[0] === playing,
    [playing, rules],
  );
  useEffect(() => {
    if (playing && !playingAllowed) {
      setPlaying(null);
      setNotice("Playback stopped. This listing was restricted.");
      setUser((old) => ({
        ...old,
        session: { ...old.session, nowId: undefined },
      }));
    }
  }, [playing, playingAllowed]);
  const allowedEpisodes = useCallback(
    async (series: Content, signal: AbortSignal) =>
      queryCatalog(await loadEpisodes(series, signal), {
        adultUnlocked: privateRef.current,
        policy: policyRef.current,
      }),
    [loadEpisodes],
  );
  const publicCheckItems = useMemo(
    () =>
      visible.filter(
        (item) => publicProviderIds.has(item.providerId) && !item.serverId,
      ),
    [visible, publicProviderIds],
  );
  const {
    movies,
    live,
    audio,
    newOnServers,
    libraryIndex,
    shelves,
    featured,
    airing,
    watchProviders,
    wishlistTitles,
    toggleWishlist,
    loadLibraryEpisodes,
  } = useTitles({
    visible,
    metadata,
    discovery,
    curated,
    kids,
    library,
    libraryTitles,
    servers,
    sources,
    selected,
    setSelected,
    user,
    setUser,
    setNotice,
    setDerivedItems,
  });
  const {
    visibleByAlias,
    favorites,
    recent,
    continueWatching,
    listenAgain,
    suggestions,
  } = useViewerLists(visible, user, adult, rules, curated);
  const genres = useMemo(
    () =>
      [
        ...new Set(
          (route === "movies"
            ? movies
            : route === "live"
              ? live
              : route === "audio"
                ? audio
                : visible
          ).flatMap((c) => c.genres),
        ),
      ].sort(),
    [route, movies, live, audio, visible],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (!saveUserState(storage, user))
          setNotice("Storage is full. Export a backup to keep your changes.");
      } catch {
        setNotice("Storage is unavailable. Changes won’t be saved.");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [user, storage]);
  useEffect(() => {
    const flush = () => {
      try {
        const state = currentUser.current;
        saveUserState(storage, {
          ...state,
          session: {
            ...state.session,
            scroll: {
              ...state.session.scroll,
              [routeRef.current]: scrollPosition.current,
            },
          },
        });
      } catch {
        /* Private browsing may disable storage. */
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [storage]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "/" &&
        !(event.target as HTMLElement).matches("input,textarea,select") &&
        !playing &&
        !selected
      ) {
        event.preventDefault();
        navigate("search");
        setTimeout(
          () =>
            document.querySelector<HTMLInputElement>("#global-search")?.focus(),
          0,
        );
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [navigate, playing, selected]);
  const acceptAccount = (account: AccountDraft) => {
    accounts.save(account);
    void accounts.connect(account);
  };
  const receiveBundle = (bundle: Bundle) =>
    applyBundle(bundle, {
      onSource: (source) => updateSource(source),
      onServer: saveServer,
      onMusicProvider: music.save,
      onKey: (key) => connectKey(key, true),
      onProfile: (profile) =>
        setUser((current) => mergeProfile(current, profile)),
      onAccount: acceptAccount,
      onConnect: (ids) => {
        for (const source of sources)
          if (
            ids.includes(source.id) &&
            !source.enabled &&
            source.classification === "general" &&
            source.kind !== "xtream"
          )
            updateSource({ ...source, enabled: true });
      },
    });
  // Settings that came with an extension file: music instances and servers are added once,
  // and the TMDB key and profile only when a person imported the file.
  extensionData.current = (file, mode) => {
    const data = newData(file, mode, storage, {
      music: (p) =>
        music.providers.some(
          (x) => x.id === p.id || (x.type === p.type && x.base === p.base),
        ),
      server: (s) => servers.some((x) => x.id === s.id || sameServer(x, s)),
    });
    for (const provider of data.musicProviders) music.save(provider);
    for (const server of data.servers) saveServer(server);
    if (data.tmdbKey) connectKey(data.tmdbKey, true);
    if (data.profile) {
      try {
        const profile = parseProfile(JSON.stringify(data.profile));
        setUser((current) => mergeProfile(current, profile));
      } catch {
        /* An unreadable profile is skipped; the rest still applies. */
      }
    }
    rememberApplied(storage, file);
    return data;
  };
  const lock = useCallback(
    (enabled: boolean) => {
      if (enabled && (!privateViewingEnabled || kids)) return;
      if (enabled) postDeviceMessage({ type: "privacy", enabled: true });
      setAdult(enabled);
      setAdultActive(enabled);
      // Hiding 18+ only hides: an 18+ title that is open or playing closes, and nothing
      // else changes.
      if (!enabled) {
        setSelected((old) => (old && !canView(old) ? null : old));
        setPlaying((old) => (old && !canView(old) ? null : old));
      }
    },
    [kids],
  );
  useEffect(() => {
    postDeviceMessage({ type: "privacy", enabled: adult });
  }, [adult]);
  // 18+ stays on until it is hidden. When the app opens and it was on, it comes back: at
  // once on a trusted device or with no PIN, otherwise after the PIN.
  const [unlockPrompt, setUnlockPrompt] = useState(false);
  useEffect(() => {
    if (kids || !privateViewingEnabled) return;
    if (!hasAdultConsent() || !adultWasActive()) return;
    if (!user.preferences.pinHash || adultTrusted()) lock(true);
    else setUnlockPrompt(true);
    // Decided once, when the app opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The Android app leaving the screen: what plays stops, and 18+ is locked away.
  const onSuspend = useRef(() => {});
  onSuspend.current = () => {
    for (const media of document.querySelectorAll<HTMLMediaElement>(
      "video,audio",
    ))
      media.pause();
    if (privateRef.current) lock(false);
    else if (playing?.streams[0]?.format === "embed") setPlaying(null);
  };
  useEffect(() => {
    const suspend = () => onSuspend.current();
    window.addEventListener("opentv:suspend", suspend);
    return () => window.removeEventListener("opentv:suspend", suspend);
  }, []);
  useRemoteNavigation(tv, route, navigate, () => {
    if (surface !== "browse") return false;
    setSurface("idle");
    return true;
  });
  // Moving between the idle screen and browsing puts focus somewhere known.
  useEffect(() => {
    if (!tv || surface !== "browse") return;
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('.app-header [aria-current="page"]')
        ?.focus({ preventScroll: true }),
    );
  }, [tv, surface]);
  const remote = useRemote(deviceName());
  const paired = usePairings();
  const tvReady = !tv && !!remote.tv && remote.tvOnline;
  const sendToTv = async (
    item: Content,
    options: { tvId?: string; start?: number } = {},
  ) => {
    setSelected(null);
    if (options.tvId && options.tvId !== remote.tv?.tvId) {
      const reached = await remote.use(options.tvId);
      if (!reached) {
        setNotice(remoteMessage("offline"));
        return;
      }
    }
    const list = browseList.current.length ? browseList.current : visible;
    const send = () =>
      playOnTv(remote, item, list, {
        start: options.start ?? progressFor(user, item),
        queue,
      });
    try {
      await send();
      setNotice(`Playing on ${remote.tv?.name || "TV"}.`);
    } catch (error) {
      const reason = (error as Error).message;
      // 18+ shown here: ask the TV to show it too, then try once more.
      if (reason === "adult" && adult) {
        try {
          await remote.send({ t: "adult", show: true });
          await send();
          setNotice(`Playing on ${remote.tv?.name || "TV"}.`);
          return;
        } catch (again) {
          setNotice(remoteMessage((again as Error).message));
          return;
        }
      }
      setNotice(remoteMessage(reason));
    }
  };
  // Where Play goes: this device, or the paired TV. Kept on this device.
  const [playTarget, setPlayTarget] = useState<"here" | "tv">(() => {
    try {
      return localStorage.getItem("opentv:play-target:v1") === "tv"
        ? "tv"
        : "here";
    } catch {
      return "here";
    }
  });
  const choosePlayTarget = (target: "here" | "tv") => {
    setPlayTarget(target);
    try {
      localStorage.setItem("opentv:play-target:v1", target);
    } catch {
      /* For this visit. */
    }
  };
  // What plays on the TV counts on this device too: progress and history, for titles
  // this device has and only general ones.
  const savedFromTv = useRef({ id: "", phase: "" });
  useEffect(() => {
    const state = remote.state;
    if (tv || !state?.itemId) return;
    const item = visibleByAlias.get(state.itemId);
    if (!item || state.duration <= 0) return;
    const last = savedFromTv.current;
    if (last.id === state.itemId && last.phase === state.phase) return;
    const first = last.id !== state.itemId;
    savedFromTv.current = { id: state.itemId, phase: state.phase };
    const position = positionNow(state, remote.receivedAt);
    const finished =
      state.phase === "ended" || position > state.duration * 0.95;
    setUser((old) => {
      const progress = { ...old.progress };
      for (const alias of contentAliases(item)) delete progress[alias];
      if (!finished && position > 5) progress[item.id] = Math.floor(position);
      return {
        ...old,
        progress,
        history: first
          ? [
              { id: item.id, at: Date.now() },
              ...old.history.filter(
                (h) => !contentAliases(item).includes(h.id),
              ),
            ].slice(0, 100)
          : old.history,
      };
    });
    // Only when the TV's state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote.state]);
  // Continue on this device from where the TV is.
  const playHere = () => {
    const state = remote.state;
    const item = state?.itemId ? visibleByAlias.get(state.itemId) : undefined;
    if (!state || !item) {
      setNotice("This title isn’t on this device.");
      return;
    }
    handedOver.current = {
      id: item.id,
      seconds: positionNow(state, remote.receivedAt),
    };
    void remote.send({ t: "stop" }).catch(() => undefined);
    play(item);
  };

  const {
    toggleFavorite,
    toggleCollection,
    createCollection,
    renameCollection,
    deleteCollection,
  } = useLibraryActions({ setUser, setNotice });
  const {
    selectedPermitted,
    select,
    close: closeSelected,
    selectedResume,
  } = useSelection({
    selected,
    setSelected,
    visible,
    user,
    setUser,
    adult,
    rules,
    policyRef,
    metadata,
  });
  const browseList = useRef<Content[]>([]);
  const {
    play,
    closePlayer,
    changeChannel,
    channelEntry,
    minimized,
    setMinimized,
    queue,
    enqueue,
    enqueueAll,
    clearQueue,
    removeFromQueue,
    moveInQueue,
  } = usePlaybackActions({
    browse: browseList,
    playing,
    setPlaying,
    adult,
    policy: policyRef,
    setSelected,
    setRestore,
    setUser,
    setNotice,
    visible,
    live,
    audio,
    movies,
  });
  // Play goes to the paired TV when that is chosen and the TV can be reached.
  const playAny = (item: Content) => {
    if (!tv && playTarget === "tv" && tvReady) void sendToTv(item);
    else play(item);
  };
  // A position handed over by a phone, used when that item opens.
  const handedOver = useRef<{ id: string; seconds: number } | null>(null);
  const receiver = useTvReceiver({
    tv,
    name: tvName(),
    visible,
    adult,
    playing,
    play,
    closePlayer,
    changeChannel,
    startAt: (id, seconds) => (handedOver.current = { id, seconds }),
    setAdult: (show) => {
      if (!show) {
        if (privateRef.current) lock(false);
        return true;
      }
      if (privateRef.current) return true;
      if (
        !privateViewingEnabled ||
        kids ||
        !hasAdultConsent() ||
        !phonesMayShowAdult()
      )
        return false;
      lock(true);
      return true;
    },
  });
  const {
    hasSources,
    setupDone,
    onboardingOpen,
    reminderOff,
    setReminderOff,
    openOnboarding,
    closeOnboarding,
  } = useOnboarding({
    servers,
    personalMedia,
    sources,
    metadata,
    // The TV sets itself up from a phone, on its idle screen.
    kids: kids || tv,
  });
  const openLegal = (item?: Content) => {
    setReportTarget(
      item
        ? {
            id: item.id,
            providerId: item.providerId,
            restricted:
              adult ||
              item.classification !== "general" ||
              !publicProviderIds.has(item.providerId) ||
              !!item.serverId ||
              item.streams.some((stream) => sensitiveUrl(stream.url)),
          }
        : undefined,
    );
    closeSelected();
    navigate("legal");
  };
  const restored =
    restore && user.session.nowId
      ? visible.find((c) => contentAliases(c).includes(user.session.nowId!))
      : undefined;
  // After a reload, a song comes back in the mini player where you were: paused and
  // ready, since a browser won't start sound by itself, or playing in the TV app. Films,
  // episodes, live channels and stations are offered through Continue, from the same
  // position, so a reload never covers the screen with a player.
  const [heldStart, setHeldStart] = useState<string | null>(null);
  const broughtBack = useRef(false);
  useEffect(() => {
    if (broughtBack.current || !restored || playing) return;
    if (!isAudio(restored) || restored.type === "radio") return;
    broughtBack.current = true;
    if (!tv) setHeldStart(restored.id);
    play(restored);
    setMinimized(true);
    // Once, when the remembered title is found.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);
  useEffect(() => {
    if (heldStart && playing?.id !== heldStart) setHeldStart(null);
  }, [playing, heldStart]);
  const {
    searching,
    kindCounts,
    filtered,
    topGenres,
    unownedMatches,
    searchKind,
    setSearchKind,
  } = useSearch({
    query,
    route,
    visible,
    movies,
    live,
    audio,
    adult,
    kids,
    rules,
    genre,
    language,
    country,
    metadata,
    libraryIndex,
    library,
  });
  // What the current screen lists after its filters: Shuffle and Previous/Next stay in it.
  const pool = route === "library" ? favorites : filtered;
  browseList.current = [
    "live",
    "audio",
    "movies",
    "search",
    "library",
  ].includes(route)
    ? pool
    : [];
  const upNext = useMemo(
    () => (playing ? nextEpisode(playing, visible) : undefined),
    [playing, visible],
  );
  const similar = useSimilar(
    selected,
    movies,
    libraryIndex,
    metadata,
    selected?.classification === "general",
  );
  const patches = useUserPatches(setUser);
  const { card, rail } = useCards({
    user,
    setUser,
    select,
    toggleFavorite,
    navigate,
    updateView,
  });
  useScrollRestoration(
    main,
    content,
    route,
    user.session.scroll[route] || 0,
    (value) => {
      setUser((old) => ({
        ...old,
        session: {
          ...old.session,
          scroll: { ...old.session.scroll, [route]: value },
        },
      }));
    },
    scrollPosition,
    `${genre}|${language}|${country}|${query}|${user.session.library.tab}`,
  );
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      {tv && surface === "idle" ? (
        <Suspense fallback={<Skeleton label="Loading" />}>
          <ReceiverIdle
            receiver={receiver}
            onBrowse={() => setSurface("browse")}
            onSettings={() => {
              setSurface("browse");
              navigate("settings");
            }}
            onBundle={(bundle) => {
              receiveBundle(bundle);
              setNotice(importedMessage(bundle, "Imported from your phone."));
            }}
          />
        </Suspense>
      ) : (
        <>
          <AppHeader
            tv={tv}
            route={route}
            adult={adult}
            navigate={navigate}
            profile={profiles.active}
            onSwitchProfile={() => {
              saveUserState(storage, currentUser.current);
              profiles.switchProfile();
            }}
            playTarget={
              !tv && remote.tv
                ? {
                    target: playTarget,
                    tvName: remote.tv.name,
                    online: remote.tvOnline,
                    onChange: choosePlayTarget,
                  }
                : undefined
            }
          />
          {adult && (
            <div className="private-banner">
              <LockKeyhole size={14} />
              18+ content shown
              <button onClick={() => lock(false)}>Hide</button>
            </div>
          )}
          <main
            id="main"
            ref={main}
            className={`main-content route-${route}`}
            tabIndex={-1}
          >
            <div ref={content} className="scroll-content">
              {restored && !playing && (
                <div className="restore-banner">
                  <span>
                    Continue: <strong>{restored.title}</strong>
                    {progressFor(user, restored) > 5 &&
                      ` · from ${clock(progressFor(user, restored))}`}
                  </span>
                  <button
                    className="button text"
                    onClick={() => playAny(restored)}
                  >
                    <Play size={15} />
                    Resume
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Dismiss resume"
                    onClick={() => setRestore(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              {route === "home" && (
                <Home
                  featured={featured}
                  movies={movies}
                  live={live}
                  audio={audio}
                  listenAgain={listenAgain}
                  favorites={favorites}
                  wishlist={wishlistTitles}
                  airing={airing}
                  continueWatching={continueWatching}
                  recommended={suggestions}
                  newOnServers={newOnServers}
                  shelves={shelves}
                  showArchive={!curated}
                  surprisePool={
                    curated ? movies.filter((c) => !isArchive(c)) : movies
                  }
                  onSearchSources={(text) => {
                    setQuery(text);
                    navigate("search");
                  }}
                  setupDone={
                    kids || onboardingOpen || reminderOff || setupDone === 2
                      ? null
                      : setupDone
                  }
                  setupSteps={{ tmdb: Boolean(metadata), sources: hasSources }}
                  onContinueSetup={openOnboarding}
                  onHideSetupReminder={() => {
                    hideReminder();
                    setReminderOff(true);
                  }}
                  hasSourceError={Object.values(status).some((s) =>
                    s.startsWith("Error"),
                  )}
                  rail={rail}
                  navigate={navigate}
                  play={playAny}
                  select={select}
                />
              )}
              {route !== "home" && (
                <div className="page-content">
                  {route !== "legal" && (
                    <PageHeading
                      route={route}
                      pool={pool}
                      onPlay={playAny}
                      onNotice={setNotice}
                    />
                  )}
                  {(route === "audio" || route === "music") && (
                    <ListenTabs route={route} kids={kids} navigate={navigate} />
                  )}
                  {route === "music" ? (
                    <MusicScreen
                      music={music}
                      tv={tv}
                      play={playAny}
                      enqueue={enqueue}
                      enqueueAll={enqueueAll}
                      navigate={navigate}
                      setNotice={setNotice}
                    />
                  ) : route === "legal" ? (
                    <Suspense
                      fallback={<Skeleton label="Loading content policy" />}
                    >
                      <Legal target={reportTarget} />
                    </Suspense>
                  ) : route === "settings" ? (
                    <Suspense
                      fallback={<Skeleton label="Loading settings" rows={6} />}
                    >
                      <SettingsRoute
                        updates={updates}
                        guide={guide}
                        checkableItems={publicCheckItems}
                        resolveUrl={resolvePlayback}
                        relay={relay}
                        onRelay={(value) => {
                          setPlaying(null);
                          setRelay(value);
                        }}
                        catalog={{
                          sources,
                          status,
                          onSource: updateSource,
                          onReclassify: reclassify,
                          onRemoveSource: removeSource,
                          onItems: addItems,
                          onAccount: connectAccount,
                          onDisabled: (id) => {
                            if (selected?.providerId === id) setSelected(null);
                            if (playing?.providerId === id) setPlaying(null);
                          },
                        }}
                        servers={{
                          servers,
                          personalMedia,
                          onSave: saveServer,
                          onRemove: removeServer,
                        }}
                        accounts={{
                          saved: accounts.saved,
                          onSave: accounts.save,
                          onForget: accounts.forget,
                          onConnect: acceptAccount,
                        }}
                        viewer={{ user, adult, onAdult: lock, patches }}
                        tmdb={{
                          status: discovery.status,
                          hasStoredKey: Boolean(metadata),
                          onConnect: connectKey,
                        }}
                        extension={extension}
                        music={music}
                        onGuidedSetup={openOnboarding}
                      />
                    </Suspense>
                  ) : (
                    <>
                      {route === "search" && (
                        <div className="search-box">
                          <Search size={26} />
                          <input
                            id="global-search"
                            type="search"
                            placeholder="Search channels, films and series"
                            aria-label="Search catalog"
                            value={query}
                            autoComplete="off"
                            maxLength={300}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                          <kbd>/</kbd>
                        </div>
                      )}
                      {searching && (
                        <SearchKinds
                          counts={kindCounts}
                          value={searchKind}
                          onChange={setSearchKind}
                        />
                      )}
                      {route === "library" ? (
                        <Suspense
                          fallback={<Skeleton label="Loading your library" />}
                        >
                          <LibraryScreen
                            servers={servers}
                            visible={visible}
                            personalMedia={queryCatalog(personalMedia, {
                              adultUnlocked: adult,
                            })}
                            view={user.session.library}
                            onViewChange={patches.setLibraryView}
                            collections={user.collections}
                            onCreateCollection={createCollection}
                            onCollection={toggleCollection}
                            onRenameCollection={renameCollection}
                            onDeleteCollection={deleteCollection}
                            onEdit={replaceMedia}
                            onRemove={removeMedia}
                            onRemoveHistory={patches.removeHistory}
                            onClearHistory={patches.clearHistory}
                            favorites={favorites}
                            wishlist={wishlistTitles}
                            continueWatching={continueWatching}
                            recent={recent}
                            renderCard={card}
                            onItems={addItems}
                            onNotice={setNotice}
                            navigate={navigate}
                          />
                        </Suspense>
                      ) : route === "search" && !searching ? (
                        <SearchIdle genres={topGenres} onPick={setQuery}>
                          {shelves
                            .slice(0, 2)
                            .map((shelf) => rail(shelf.title, shelf.items))}
                        </SearchIdle>
                      ) : (
                        <Browse
                          syncing={
                            Object.values(status).some(
                              (s) => s === "Syncing…",
                            ) ||
                            sources.some(
                              (s) =>
                                s.enabled &&
                                s.kind !== "xtream" &&
                                !status[s.id],
                            )
                          }
                          route={route}
                          query={query}
                          filtered={filtered}
                          visible={visible}
                          genres={genres}
                          genre={genre}
                          language={language}
                          country={country}
                          limit={limit}
                          guide={guide.programs}
                          guideStatus={guide.displayState}
                          renderCard={card}
                          onFilter={updateView}
                          onMore={() => updateView({ limit: limit + 72 })}
                          guideView={view.guide}
                          onGuideView={(guide) => updateView({ guide })}
                          play={playAny}
                          navigate={navigate}
                        />
                      )}
                      {route === "search" &&
                        unownedMatches.length > 0 &&
                        rail("Not in your library", unownedMatches)}
                    </>
                  )}
                </div>
              )}
              <AppFooter
                navigate={(next) => {
                  if (next === "legal") openLegal();
                  else navigate(next);
                }}
              />
            </div>
          </main>
        </>
      )}
      {selected && selectedPermitted && canView(selected, adult) && (
        <DetailHost
          key={`${selected.id}:${updates.manifest.revision}`}
          selected={selected}
          permitted={selectedPermitted}
          user={user}
          sources={sources}
          visible={visible}
          visibleByAlias={visibleByAlias}
          similar={similar}
          resume={selectedResume}
          watch={watchProviders}
          resolveUrl={resolvePlayback}
          loadLibraryEpisodes={loadLibraryEpisodes}
          allowedEpisodes={allowedEpisodes}
          card={card}
          onQueue={enqueue}
          onWishlist={toggleWishlist}
          onReport={openLegal}
          onClose={closeSelected}
          onPlay={(item) =>
            // The title's own "Play here" plays here; its episodes and server rows
            // follow where Play goes.
            item.id === selected.id ? play(item) : playAny(item)
          }
          onPlayOnTv={
            tvReady || paired.list.length > 1
              ? (item, tvId) => void sendToTv(item, { tvId })
              : undefined
          }
          tvName={remote.tv?.name}
          tvs={paired.list.map((p) => ({ id: p.tvId, name: p.name }))}
          onFavorite={toggleFavorite}
          onCollection={toggleCollection}
          onSelect={select}
          onSearchSources={(text) => {
            setSelected(null);
            setQuery(text);
            navigate("search");
          }}
        />
      )}
      {channelEntry && (
        <div className="channel-entry" role="status">
          {channelEntry}
        </div>
      )}
      {playing && playingAllowed && canView(playing, adult) && (
        <Suspense
          fallback={<div className="player-placeholder">Opening player…</div>}
        >
          <Player
            resolveUrl={resolvePlayback}
            tv={tv}
            item={playing}
            startPaused={heldStart === playing.id}
            startAt={
              handedOver.current?.id === playing.id
                ? handedOver.current.seconds
                : progressFor(user, playing)
            }
            volume={user.preferences.volume}
            muted={user.preferences.muted}
            onClose={closePlayer}
            onSendToTv={
              tvReady
                ? (seconds) => {
                    const item = playing;
                    closePlayer();
                    void sendToTv(item, { start: seconds });
                  }
                : undefined
            }
            tvLabel={remote.tv?.name}
            minimized={minimized}
            onMinimize={() => setMinimized(true)}
            onExpand={() => setMinimized(false)}
            onNext={changeChannel}
            // Only songs whose service has a player page (not Internet Archive) offer it.
            onMusicEmbed={
              musicClient.embedUrl(playing.providerItemId || "")
                ? (item) => {
                    const url = musicClient.embedUrl(item.providerItemId || "");
                    if (url)
                      setPlaying({
                        ...item,
                        streams: [{ url, format: "embed", guard: "click" }],
                      });
                  }
                : undefined
            }
            onEmbedFailed={(item, url) => {
              library.reject(url);
              setPlaying({
                ...item,
                streams: [
                  ...item.streams.filter((s) => s.url !== url),
                  ...item.streams.filter((s) => s.url === url),
                ],
              });
            }}
            onProgress={(id, time, finished) => {
              const item = visibleByAlias.get(id);
              if (!item) return;
              const update = (old: UserState) => {
                const progress = { ...old.progress };
                for (const alias of contentAliases(item))
                  delete progress[alias];
                if (!finished) progress[id] = Math.floor(time);
                return { ...old, progress };
              };
              setUser(update);
              // The page is going away (a reload, say): write now, not after a render.
              if (document.visibilityState === "hidden") {
                currentUser.current = update(currentUser.current);
                try {
                  saveUserState(storage, currentUser.current);
                } catch {
                  /* Storage is unavailable. */
                }
              }
            }}
            onVolume={(volume, muted) => {
              setUser((old) => ({
                ...old,
                preferences: { ...old.preferences, volume, muted },
              }));
            }}
            upNext={upNext}
            queue={queue}
            onClearQueue={clearQueue}
            onRemoveFromQueue={removeFromQueue}
            onMoveInQueue={moveInQueue}
            onEnded={() => {
              if (playing.seriesId && !upNext) changeChannel(1, false);
              // On-demand audio carries on to the queue, then the next in the list.
              else if (playing.type === "audio") changeChannel(1, false);
            }}
          />
        </Suspense>
      )}
      {unlockPrompt && user.preferences.pinHash && (
        <AdultUnlock
          pinHash={user.preferences.pinHash}
          pinSalt={user.preferences.pinSalt || ""}
          onUnlock={() => {
            setUnlockPrompt(false);
            lock(true);
          }}
          onSkip={() => {
            setUnlockPrompt(false);
            setAdultActive(false);
          }}
          onTrust={() => setAdultTrusted(true)}
        />
      )}
      {celebrate && <Confetti onDone={() => setCelebrate(false)} />}
      {onboardingOpen && (
        <Suspense fallback={null}>
          <Onboarding
            hasSources={hasSources}
            sources={sources.filter(
              (s) =>
                s.classification === "general" &&
                s.kind !== "xtream" &&
                s.kind !== "library" &&
                s.id !== "personal-media",
            )}
            onSource={updateSource}
            hasKey={Boolean(metadata)}
            onBundle={(bundle) => {
              receiveBundle(bundle);
              setNotice(importedMessage(bundle, "Imported from your phone."));
            }}
            onKey={(key) => connectKey(key, true)}
            onExtensionFile={extension.importFile}
            onExtensionUrl={extension.importUrl}
            onClose={(result) => {
              closeOnboarding(result);
              if (result === "done") setCelebrate(true);
            }}
            onEnterManually={() => {
              closeOnboarding("skipped");
              try {
                sessionStorage.setItem("opentv:settings-tab", "sources");
              } catch {
                /* Settings opens on its first tab. */
              }
              navigate("settings");
            }}
          />
        </Suspense>
      )}
      {!tv && (
        <RemoteBar remote={remote} onNotice={setNotice} onPlayHere={playHere} />
      )}
      {notice && <Toast message={notice} onDone={() => setNotice("")} />}
      <MobileNavigation route={route} navigate={navigate} />
    </div>
  );
}
