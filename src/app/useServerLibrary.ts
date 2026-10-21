import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { MediaServer } from "../domain/servers";
import { ServerLibrary } from "./serverLibrary";
export function useServerLibrary(servers: MediaServer[]) {
  const library = useRef<ServerLibrary | null>(null);
  library.current ??= new ServerLibrary(
    (() => {
      try {
        return localStorage;
      } catch {
        return undefined;
      }
    })(),
  );
  const lib = library.current;
  useEffect(() => lib.setServers(servers), [lib, servers]);
  const version = useSyncExternalStore(lib.subscribe, lib.getVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => lib.items(), [lib, version]);
  return { library: lib, items };
}
