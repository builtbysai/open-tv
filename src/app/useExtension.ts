import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Source } from "../domain/content";
import { AppError, friendlyError } from "../domain/errors";
import { whenIdle } from "./idle";
import { appAsset } from "../config/site";
import { limitedText } from "../providers/http";
import {
  MAX_EXTENSION_BYTES,
  parseExtension,
  toSource,
  type ExtensionFile,
} from "../extension/format";
import {
  describeImport,
  summarize,
  type DataMode,
  type ExtensionData,
} from "../extension/data";
import {
  checkExtensionUrl,
  clearDeviceExtension,
  loadDeviceExtension,
  readExtensionUrl,
  saveDeviceExtension,
  setSiteExtension,
  writeExtensionUrl,
} from "../extension/store";

export interface ExtensionInfo {
  name: string;
  sources: number;
  adult: number;
  music: number;
  servers: number;
  // Where the loaded pack comes from: the site's own file, one imported here, or both.
  origins: ("device" | "site")[];
  // Where a device extension is loaded from, host only. Empty when it was imported as a file.
  from: string;
}
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};
async function download(url: string): Promise<ExtensionFile> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-cache", credentials: "omit" });
  } catch {
    throw new AppError(
      "network",
      "Could not reach that address. The host must allow browser requests (CORS).",
    );
  }
  if (!response.ok)
    throw new AppError(
      "network",
      `That address answered with an error (${response.status}).`,
    );
  return parseExtension(
    await limitedText(response, MAX_EXTENSION_BYTES),
    response.url || url,
  );
}
// Sources from an extension file: one imported on this device, and one the site itself
// serves as /extension.json (for a deployment that bundles its own).
export function useExtension(
  builtInIds: ReadonlySet<string>,
  // Adds the settings an extension carries (music instances, servers, key, profile) and
  // says what was new. Called with `import` only for a file or address a person chose.
  applyData: (file: ExtensionFile, mode: DataMode) => ExtensionData,
) {
  const apply = useRef(applyData);
  apply.current = applyData;
  const [device, setDevice] = useState<ExtensionFile | null>(null);
  const [site, setSite] = useState<ExtensionFile | null>(null);
  const [ready, setReady] = useState(false);
  const [url, setUrl] = useState("");
  useEffect(() => {
    let canceled = false;
    void (async () => {
      const saved = await loadDeviceExtension();
      if (canceled) return;
      setDevice(saved);
      setUrl(saved ? readExtensionUrl() : "");
      // The site's own file can be large, so it waits until the screen is usable.
      await whenIdle();
      let served: ExtensionFile | null = null;
      try {
        const response = await fetch(appAsset("/extension.json"), {
          cache: "no-cache",
          credentials: "omit",
        });
        if (response.ok)
          served = parseExtension(
            await limitedText(response, MAX_EXTENSION_BYTES),
            // Files next to the site's extension resolve against where it is served.
            new URL(appAsset("/extension.json"), location.href).href,
          );
      } catch {
        // No extension is served here, or it is not one: nothing to add.
      }
      if (canceled) return;
      setSiteExtension(served);
      setSite(served);
      if (served) apply.current(served, "start");
      setReady(true);
      // An extension loaded from an address is refreshed quietly; the saved copy stays if
      // the address cannot be reached.
      const savedUrl = saved ? readExtensionUrl() : "";
      if (savedUrl)
        try {
          const fresh = await download(savedUrl);
          if (canceled) return;
          await saveDeviceExtension(fresh);
          setDevice(fresh);
          apply.current(fresh, "start");
        } catch {
          // Offline or moved: keep what is on the device.
        }
    })();
    return () => {
      canceled = true;
    };
  }, []);
  const sources: Source[] = useMemo(() => {
    const map = new Map<string, Source>();
    for (const file of [site, device])
      for (const s of file?.sources ?? [])
        if (!builtInIds.has(s.id)) map.set(s.id, toSource(s));
    return [...map.values()];
  }, [site, device, builtInIds]);
  // Guides the extension suggests, from the site's file and the device's.
  const guides = useMemo(
    () => [
      ...new Map(
        [...(site?.guides ?? []), ...(device?.guides ?? [])].map((g) => [
          g.url,
          g,
        ]),
      ).values(),
    ],
    [site, device],
  );
  // One status for what is loaded: the site's file and the device's merge by source id, so
  // the counts are those of the merged pack, not of each file.
  const info: ExtensionInfo | null =
    site || device
      ? {
          name: (device ?? site)!.name,
          sources: sources.length,
          adult: sources.filter((s) => s.classification === "adult").length,
          music: new Set(
            [site, device].flatMap((f) =>
              (f?.musicProviders ?? []).map((p) => p.id),
            ),
          ).size,
          servers: new Set(
            [site, device].flatMap((f) => (f?.servers ?? []).map((s) => s.id)),
          ).size,
          origins: [
            ...(site ? ["site" as const] : []),
            ...(device ? ["device" as const] : []),
          ],
          from: device ? hostOf(url) : "",
        }
      : null;
  // Reads a chosen file, checks it, and keeps it on this device.
  const importFile = useCallback(async (file: File) => {
    if (file.size > MAX_EXTENSION_BYTES)
      throw new Error("This file is too large to be an extension.");
    try {
      const parsed = parseExtension(await file.text());
      // A file with settings and no sources only adds its settings; the extension already
      // on this device stays.
      if (parsed.sources.length) {
        await saveDeviceExtension(parsed);
        writeExtensionUrl("");
        setUrl("");
        setDevice(parsed);
      }
      return describeImport(
        parsed.sources.length,
        summarize(apply.current(parsed, "import")),
        parsed.unresolved,
      );
    } catch (error) {
      throw new Error(friendlyError(error));
    }
  }, []);
  // Loads an extension from an https address and remembers it for refreshing.
  const importUrl = useCallback(async (input: string) => {
    try {
      const address = checkExtensionUrl(input);
      const parsed = await download(address);
      if (parsed.sources.length) {
        await saveDeviceExtension(parsed);
        writeExtensionUrl(address);
        setUrl(address);
        setDevice(parsed);
      }
      return describeImport(
        parsed.sources.length,
        summarize(apply.current(parsed, "import")),
        parsed.unresolved,
      );
    } catch (error) {
      throw new Error(friendlyError(error));
    }
  }, []);
  const refresh = useCallback(async () => {
    const address = readExtensionUrl();
    if (!address)
      throw new AppError(
        "format",
        "This extension was not loaded from an address.",
      );
    return importUrl(address);
  }, [importUrl]);
  const remove = useCallback(async () => {
    await clearDeviceExtension();
    writeExtensionUrl("");
    setUrl("");
    setDevice(null);
  }, []);
  return {
    sources,
    info,
    guides,
    ready,
    importFile,
    importUrl,
    refresh,
    remove,
  };
}
