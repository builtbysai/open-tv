import { useMemo, useRef, useState } from "react";
import {
  validateServer,
  canPersistServer,
  type MediaServer,
} from "../domain/servers";
import { readServers, writeServers } from "../persistence/servers";
function initialServers(): MediaServer[] {
  try {
    return readServers(localStorage);
  } catch {
    return [];
  }
}
// One list of servers, saved the same way whether 18+ is shown or not. 18+ servers are
// kept with the rest and left out of view while 18+ is hidden.
export function useMediaServers(
  adult: boolean,
  onNotice: (message: string) => void,
) {
  const [saved, setSaved] = useState(initialServers);
  const current = useRef(saved),
    shown = useRef(adult);
  current.current = saved;
  shown.current = adult;
  const servers = useMemo(
    () => saved.filter((s) => adult || s.classification === "general"),
    [saved, adult],
  );
  const persist = (next: MediaServer[]) => {
    current.current = next;
    setSaved(next);
    try {
      if (writeServers(localStorage, next)) return;
    } catch {
      /* Storage may be disabled. */
    }
    onNotice(
      "Server changes work in this tab, but device storage is unavailable.",
    );
  };
  const saveServer = (value: MediaServer): boolean => {
    const server = validateServer(value);
    if (!server || !canPersistServer(server)) {
      onNotice(
        "Enter a valid server name and HTTP(S) address without query parameters or embedded credentials.",
      );
      return false;
    }
    if (server.classification !== "general" && !shown.current) {
      onNotice(
        "Show 18+ content in Settings to add adult or unclassified servers.",
      );
      return false;
    }
    if (
      current.current.length >= 200 &&
      !current.current.some((s) => s.id === server.id)
    ) {
      onNotice("You can save up to 200 servers on this device.");
      return false;
    }
    persist([...current.current.filter((s) => s.id !== server.id), server]);
    return true;
  };
  const removeServer = (id: string) =>
    persist(current.current.filter((s) => s.id !== id));
  return { servers, saveServer, removeServer };
}
