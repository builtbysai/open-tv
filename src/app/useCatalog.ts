import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deduplicate, type Content, type Source } from "../domain/content";
import { persistableUrl } from "../domain/urls";
import { canPersistContent, upsertMedia } from "../domain/library";
import type { EpisodicProvider } from "../providers/contracts";
import { AppError, friendlyError } from "../domain/errors";
import { sources as defaults } from "../providers/registry";
import { loadSource } from "../providers/catalog";
import { useMediaServers } from "./useMediaServers";
import { resolveServerMedia } from "../domain/servers";
import { readLibrary, writeLibrary } from "../persistence/library";
import type { UpdateManifest } from "../domain/catalog-updates";
import { publicCatalogUpdate } from "../config/updates";
function storedSources(): Source[] {
  try {
    const data = JSON.parse(localStorage.getItem("opentv:sources:v1") || "[]");
    if (!Array.isArray(data)) return defaults;
    const merged = [...defaults];
    for (const s of data) {
      if (
        !s ||
        typeof s.id !== "string" ||
        typeof s.name !== "string" ||
        (s.kind !== "directory" &&
          (typeof s.url !== "string" ||
            !persistableUrl(new URL(s.url, location.href).href))) ||
        !["general", "adult", "unknown"].includes(s.classification) ||
        !["m3u", "catalog", "directory"].includes(s.kind)
      )
        continue;
      const index = merged.findIndex((d) => d.id === s.id);
      if (index >= 0)
        merged[index] = { ...merged[index], enabled: s.enabled === true };
      else if (s.kind === "m3u")
        merged.push({
          id: s.id,
          name: s.name.slice(0, 100),
          url: s.url,
          kind: "m3u",
          classification: s.classification,
          enabled: s.enabled === true,
          description:
            typeof s.description === "string"
              ? s.description.slice(0, 1000)
              : "Your playlist",
          refreshHours: Math.max(1, Number(s.refreshHours) || 24),
        });
    }
    return merged;
  } catch {
    return defaults;
  }
}
const EXTENSION_ENABLED = "opentv:extension-enabled:v1";
// Earlier builds kept connected 18+ extension lists apart; they join the others once.
const ADULT_SOURCES = "opentv:adult-sources:v1";
function connectedExtensionLists(): Record<string, boolean> {
  let saved: Record<string, boolean> = {};
  try {
    const value = JSON.parse(localStorage.getItem(EXTENSION_ENABLED) || "{}");
    if (value && typeof value === "object") saved = value;
    const adult = JSON.parse(localStorage.getItem(ADULT_SOURCES) || "null");
    if (Array.isArray(adult)) {
      for (const id of adult) saved[String(id)] ??= true;
      localStorage.setItem(EXTENSION_ENABLED, JSON.stringify(saved));
      localStorage.removeItem(ADULT_SOURCES);
    }
  } catch {
    /* Nothing remembered. */
  }
  return saved;
}
// Remembers whether an extension list is connected before the extension is here (a
// choice synced from another device), so it connects when the list arrives.
export function rememberExtensionList(id: string, enabled: boolean) {
  try {
    localStorage.setItem(
      EXTENSION_ENABLED,
      JSON.stringify({ ...connectedExtensionLists(), [id]: enabled }),
    );
  } catch {
    /* Device storage may be disabled. */
  }
}
interface Pending {
  controller: AbortController;
}
export function useCatalog(
  adult: boolean,
  setNotice: (message: string) => void,
  updates: {
    manifest: UpdateManifest;
    endpoint: string | null;
    paused: boolean;
  },
  extensionSources: Source[] = [],
) {
  const { servers, saveServer, removeServer } = useMediaServers(
    adult,
    setNotice,
  );
  // One list of sources and one catalog. 18+ sources and titles are ordinary entries that
  // stay out of view while 18+ is hidden (see queryCatalog); nothing is dropped on lock.
  const [listed, setListed] = useState(storedSources);
  const [catalogs, setCatalogs] = useState<Record<string, Content[]>>({});
  // Accounts live in memory only, but they are ordinary sources: they are visible in
  // normal viewing and their adult-looking titles are filtered per item.
  const [accountSources, setAccountSources] = useState<Record<string, Source>>(
      {},
    ),
    [accountCatalogs, setAccountCatalogs] = useState<Record<string, Content[]>>(
      {},
    ),
    [accountStatus, setAccountStatus] = useState<Record<string, string>>({});
  const [listedStatus, setListedStatus] = useState<Record<string, string>>({});
  const accounts = useRef(new Map<string, EpisodicProvider>());
  const updateRef = useRef(updates),
    sourceVersions = useRef(new Map<string, string>());
  updateRef.current = updates;
  const requests = useRef(new Map<string, Pending>()),
    listedRef = useRef(listed),
    catalogRef = useRef(catalogs),
    accountCatalogRef = useRef(accountCatalogs),
    hydration = useRef<Promise<void> | null>(null);
  listedRef.current = listed;
  catalogRef.current = catalogs;
  accountCatalogRef.current = accountCatalogs;
  const setSources = (next: Source[]) => {
    listedRef.current = next;
    setListed(next);
  };
  const setCatalog = (next: Record<string, Content[]>) => {
    catalogRef.current = next;
    setCatalogs(next);
  };
  const sources = useMemo(() => {
    const map = new Map(listed.map((s) => [s.id, s]));
    for (const s of Object.values(accountSources)) map.set(s.id, s);
    return [...map.values()];
  }, [listed, accountSources]);
  const status = { ...listedStatus, ...accountStatus };
  const catalog = useMemo(() => {
    const definitions = new Map(sources.map((s) => [s.id, s]));
    const data = { ...catalogs, ...accountCatalogs };
    return deduplicate(
      Object.entries(data)
        .filter(([id]) => definitions.get(id)?.enabled !== false)
        .sort(
          ([a], [b]) =>
            (definitions.get(b)?.priority ?? 0) -
              (definitions.get(a)?.priority ?? 0) || a.localeCompare(b),
        )
        .flatMap(([, items]) =>
          items.map((item) => resolveServerMedia(item, servers)),
        ),
    );
  }, [catalogs, accountCatalogs, sources, servers]);
  const persistLibrary = useCallback(
    (items: Content[]) => {
      void writeLibrary(items).then((ok) => {
        if (!ok)
          setNotice("Storage is unavailable. Export a backup before closing.");
      });
    },
    [setNotice],
  );
  const load = useCallback(async (source: Source, force = false) => {
    requests.current.get(source.id)?.controller.abort();
    const controller = new AbortController();
    requests.current.set(source.id, { controller });
    const timeout = setTimeout(() => controller.abort(), 30000);
    setListedStatus((old) => ({ ...old, [source.id]: "Syncing…" }));
    const update = publicCatalogUpdate(
      source,
      updateRef.current.manifest,
      updateRef.current.endpoint,
    );
    const previousVersion = sourceVersions.current.get(source.id);
    const retainPreviousVersion = () => {
      if (update)
        sourceVersions.current.set(
          source.id,
          previousVersion || update.baseline.sha256,
        );
    };
    try {
      if (update)
        sourceVersions.current.set(
          source.id,
          update.remote?.release.sha256 || update.baseline.sha256,
        );
      const { items, freshness } = await loadSource(
        source,
        controller.signal,
        force,
        true,
        update,
      );
      if (controller.signal.aborted) return;
      if (freshness === "stale" || freshness === "bundled")
        retainPreviousVersion();
      const next = { ...catalogRef.current, [source.id]: items };
      catalogRef.current = next;
      setCatalogs(next);
      setListedStatus((old) => ({
        ...old,
        [source.id]: `${items.length.toLocaleString()} ${items.length === 1 ? "entry" : "entries"} · ${freshness === "stale" ? "offline cache" : freshness === "bundled" ? "bundled fallback" : freshness === "cached" ? "cached" : "synced"}`,
      }));
    } catch (error) {
      if (requests.current.get(source.id)?.controller !== controller) return;
      retainPreviousVersion();
      setListedStatus((old) => ({
        ...old,
        [source.id]: controller.signal.aborted
          ? "Sync canceled or timed out. Retry when connected."
          : `Error · ${friendlyError(error)}`,
      }));
    } finally {
      clearTimeout(timeout);
      if (requests.current.get(source.id)?.controller === controller)
        requests.current.delete(source.id);
    }
  }, []);
  useEffect(() => {
    let canceled = false;
    const queue = listedRef.current.filter(
      (s) => s.enabled && (s.url || s.inline || s.kind === "directory"),
    );
    const worker = async () => {
      while (!canceled && queue.length) {
        const source = queue.shift()!;
        if (listedRef.current.some((s) => s.id === source.id && s.enabled))
          await load(source);
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    const ready = readLibrary().then((items) => {
      if (!canceled) {
        const merged = upsertMedia(
          items,
          catalogRef.current["personal-media"] || [],
        );
        const next = { ...catalogRef.current, "personal-media": merged };
        catalogRef.current = next;
        setCatalogs(next);
      }
    });
    hydration.current = ready;
    const active = requests.current;
    const connected = accounts.current;
    return () => {
      canceled = true;
      for (const pending of active.values()) pending.controller.abort();
      active.clear();
      for (const account of connected.values()) account.dispose();
      connected.clear();
    };
  }, [load]);
  useEffect(() => {
    if (updates.paused) return;
    for (const source of listedRef.current) {
      if (!source.enabled) continue;
      const update = publicCatalogUpdate(
        source,
        updates.manifest,
        updates.endpoint,
      );
      const previous = sourceVersions.current.get(source.id);
      const next = update?.remote?.release.sha256 || update?.baseline.sha256;
      if (previous && next && previous !== next) void load(source);
    }
  }, [updates.manifest, updates.endpoint, updates.paused, load]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "opentv:sources:v1",
        JSON.stringify(
          listed.filter(
            (s) =>
              !s.extension &&
              (s.kind === "directory" ||
                (s.url &&
                  persistableUrl(new URL(s.url, location.href).href))) &&
              ["m3u", "catalog", "directory"].includes(s.kind),
          ),
        ),
      );
    } catch {
      /* Device storage may be disabled. */
    }
  }, [listed]);
  // Sources from an extension file arrive after start (they are read from storage), and go
  // away when the extension is removed. Which ones were connected is remembered.
  useEffect(() => {
    const saved = connectedExtensionLists();
    const ids = new Set(extensionSources.map((s) => s.id));
    const next = listedRef.current.filter((s) => !s.extension || ids.has(s.id));
    const gone = listedRef.current.filter((s) => s.extension && !ids.has(s.id));
    const added: Source[] = [];
    const updated: Source[] = [];
    for (const source of extensionSources) {
      // Nothing from an extension connects by itself: only what you connected before.
      const index = next.findIndex((s) => s.id === source.id);
      if (index >= 0) {
        const entry = { ...source, enabled: next[index].enabled };
        // A refreshed extension can rename a list or change its address or data.
        if (JSON.stringify(entry) !== JSON.stringify(next[index]))
          updated.push(entry);
        next[index] = entry;
      } else {
        const entry = { ...source, enabled: saved[source.id] ?? false };
        next.push(entry);
        added.push(entry);
      }
    }
    if (
      !gone.length &&
      !added.length &&
      !updated.length &&
      next.length === listedRef.current.length
    )
      return;
    listedRef.current = next;
    setListed(next);
    if (gone.length) {
      const drop = new Set(gone.map((s) => s.id));
      const kept = Object.fromEntries(
        Object.entries(catalogRef.current).filter(([id]) => !drop.has(id)),
      );
      catalogRef.current = kept;
      setCatalogs(kept);
    }
    for (const source of [...added, ...updated])
      if (source.enabled) void load(source);
  }, [extensionSources, load]);
  // Choices are merged in, never replaced: the extension's lists arrive after start, and
  // the choices for lists not loaded yet (or removed and imported again) must survive.
  useEffect(() => {
    const lists = listed.filter((s) => s.extension);
    if (!lists.length) return;
    try {
      localStorage.setItem(
        EXTENSION_ENABLED,
        JSON.stringify({
          ...connectedExtensionLists(),
          ...Object.fromEntries(lists.map((s) => [s.id, s.enabled])),
        }),
      );
    } catch {
      /* Device storage may be disabled. */
    }
  }, [listed]);
  const updateSource = (source: Source, force = false) => {
    if (source.kind === "xtream") {
      if (source.enabled) {
        setNotice("Sign in below to reconnect.");
        return;
      }
      accounts.current.get(source.id)?.dispose();
      accounts.current.delete(source.id);
      const key = `account:${source.id}`;
      requests.current.get(key)?.controller.abort();
      requests.current.delete(key);
      const next = { ...accountCatalogRef.current };
      delete next[source.id];
      accountCatalogRef.current = next;
      setAccountCatalogs(next);
      setAccountSources((old) => ({ ...old, [source.id]: source }));
      setAccountStatus((old) => ({
        ...old,
        [source.id]: "Disconnected · sign in again to reconnect",
      }));
      return;
    }
    if (source.enabled && source.classification !== "general" && !adult) {
      setNotice("Show 18+ content in Settings to connect this source.");
      return;
    }
    setSources(
      listedRef.current.some((s) => s.id === source.id)
        ? listedRef.current.map((s) => (s.id === source.id ? source : s))
        : [...listedRef.current, source],
    );
    requests.current.get(source.id)?.controller.abort();
    requests.current.delete(source.id);
    if (
      source.enabled &&
      (source.url || source.inline || source.kind === "directory")
    )
      void load(source, force);
    else
      setListedStatus((old) => ({
        ...old,
        [source.id]: source.enabled ? "Local media ready" : "Disconnected",
      }));
  };
  // Forgets a playlist you added yourself (Disconnect only switches it off).
  const removeSource = (id: string) => {
    const source = listedRef.current.find((s) => s.id === id);
    if (!source || source.extension || defaults.some((d) => d.id === id))
      return;
    requests.current.get(id)?.controller.abort();
    requests.current.delete(id);
    setSources(listedRef.current.filter((s) => s.id !== id));
    const next = { ...catalogRef.current };
    delete next[id];
    setCatalog(next);
    setListedStatus((old) => {
      const rest = { ...old };
      delete rest[id];
      return rest;
    });
  };
  // Moves a source you added yourself between the general list and 18+, in place.
  const reclassify = (source: Source, to: "general" | "adult") => {
    if (source.extension || source.kind === "xtream") return;
    if (defaults.some((d) => d.id === source.id)) return;
    if (source.classification === to) return;
    if (to === "adult" && !adult) {
      setNotice("Show 18+ content in Settings to move a source into it.");
      return;
    }
    const moved: Source = { ...source, classification: to };
    setSources(listedRef.current.map((s) => (s.id === source.id ? moved : s)));
    if (moved.enabled) void load(moved, true);
  };
  const addItems = (source: Source, items: Content[]) => {
    if (source.id === "personal-media") {
      const next = {
        ...catalogRef.current,
        "personal-media": upsertMedia(
          catalogRef.current["personal-media"] || [],
          items,
        ),
      };
      setCatalog(next);
      void (hydration.current || Promise.resolve()).then(() =>
        persistLibrary(catalogRef.current["personal-media"] || []),
      );
      setListedStatus((old) => ({
        ...old,
        [source.id]: `${items.length} entries imported`,
      }));
      return;
    }
    if (
      source.kind !== "xtream" &&
      source.classification !== "general" &&
      !adult
    ) {
      setNotice("Show 18+ content in Settings to add 18+ sources.");
      return;
    }
    const account = source.kind === "xtream";
    if (account) setAccountSources((old) => ({ ...old, [source.id]: source }));
    else if (!listedRef.current.some((s) => s.id === source.id))
      setSources([...listedRef.current, source]);
    const ref = account ? accountCatalogRef : catalogRef;
    const next = {
      ...ref.current,
      [source.id]: deduplicate([...(ref.current[source.id] || []), ...items]),
    };
    ref.current = next;
    (account ? setAccountCatalogs : setCatalogs)(next);
    (account ? setAccountStatus : setListedStatus)((old) => ({
      ...old,
      [source.id]: `${items.length} entries imported`,
    }));
  };
  // Items that belong to no listed source, such as titles found on your servers. They
  // live in memory only.
  const setDerivedItems = useCallback(
    (key: string, items: Content[], merge = false) => {
      const old = catalogRef.current[key] || [];
      const next = {
        ...catalogRef.current,
        [key]: merge ? deduplicate([...old, ...items]) : items,
      };
      catalogRef.current = next;
      setCatalogs(next);
    },
    [],
  );
  const connectAccount = async (
    provider: EpisodicProvider,
    signal: AbortSignal,
  ): Promise<number> => {
    const id = provider.source.id,
      key = `account:${id}`;
    requests.current.get(key)?.controller.abort();
    accounts.current.get(id)?.dispose();
    accounts.current.set(id, provider);
    const controller = new AbortController();
    requests.current.set(key, { controller });
    setAccountSources((old) => ({ ...old, [id]: provider.source }));
    // A replacement account must not leave its old credential-bearing streams visible.
    const cleared = { ...accountCatalogRef.current };
    delete cleared[id];
    accountCatalogRef.current = cleared;
    setAccountCatalogs(cleared);
    setAccountStatus((old) => ({ ...old, [id]: "Connecting…" }));
    const requestSignal = AbortSignal.any([signal, controller.signal]);
    try {
      const items = await provider.load(requestSignal);
      requestSignal.throwIfAborted();
      if (accounts.current.get(id) !== provider)
        throw new DOMException("Connection ended", "AbortError");
      addItems(provider.source, items);
      setAccountStatus((old) => ({
        ...old,
        [id]: `${items.length.toLocaleString()} ${items.length === 1 ? "entry" : "entries"} · connected`,
      }));
      return items.length;
    } catch (error) {
      if (accounts.current.get(id) === provider) {
        accounts.current.delete(id);
        provider.dispose();
        setAccountSources((old) => ({
          ...old,
          [id]: { ...provider.source, enabled: false },
        }));
        setAccountStatus((old) => ({
          ...old,
          [id]: `Error · ${requestSignal.aborted ? "Connection canceled or timed out. Sign in again." : friendlyError(error)}`,
        }));
      }
      throw error;
    } finally {
      if (requests.current.get(key)?.controller === controller)
        requests.current.delete(key);
    }
  };
  const loadEpisodes = useCallback(
    async (series: Content, signal: AbortSignal): Promise<Content[]> => {
      const provider = accounts.current.get(series.providerId);
      if (!provider)
        throw new AppError(
          "authorization",
          "Account disconnected. Sign in again in Settings.",
        );
      const items = await provider.loadEpisodes(series, signal);
      signal.throwIfAborted();
      if (accounts.current.get(series.providerId) !== provider)
        throw new DOMException("Connection ended", "AbortError");
      const next = {
        ...accountCatalogRef.current,
        [series.providerId]: deduplicate([
          ...(accountCatalogRef.current[series.providerId] || []),
          ...items,
        ]),
      };
      accountCatalogRef.current = next;
      setAccountCatalogs(next);
      return items;
    },
    [],
  );
  const replaceMedia = (item: Content) => {
    addItems(
      {
        id: "personal-media",
        name: "Personal media",
        kind: "library",
        enabled: true,
        classification: "general",
        description: "Your media",
        refreshHours: 0,
      },
      [item],
    );
  };
  const removeMedia = (id: string) => {
    const current = catalogRef.current["personal-media"] || [];
    if (!current.some((item) => item.id === id)) return;
    const next = {
      ...catalogRef.current,
      "personal-media": current.filter((item) => item.id !== id),
    };
    setCatalog(next);
    persistLibrary(next["personal-media"]);
  };
  return {
    sources,
    status,
    catalog,
    personalMedia: (catalogs["personal-media"] || []).map((item) =>
      resolveServerMedia(item, servers),
    ),
    servers,
    saveServer,
    removeServer,
    updateSource,
    removeSource,
    reclassify,
    addItems,
    setDerivedItems,
    replaceMedia,
    removeMedia,
    connectAccount,
    loadEpisodes,
    canPersistMedia: canPersistContent,
  };
}
