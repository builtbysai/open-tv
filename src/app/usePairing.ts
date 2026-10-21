import { useCallback, useEffect, useState } from "react";
import { publicSiteUrl } from "../config/site";
import { decrypt, randomToken } from "../transfer/crypto";
import { Assembler, parseChunk, subscribe } from "../transfer/relay";
import { parseBundle, bundleIsEmpty, type Bundle } from "../transfer/bundle";
export interface Pairing {
  link: string;
  status: "idle" | "waiting" | "error";
  bundle: Bundle | null;
  clear(): void;
  restart(): void;
}
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
// Listens for one encrypted setup bundle from a phone while `enabled` is true.
export function usePairing(enabled: boolean): Pairing {
  const [session, setSession] = useState(() => ({
    room: randomToken(16),
    key: randomToken(32),
  }));
  const [status, setStatus] = useState<Pairing["status"]>("idle");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const assembler = new Assembler();
    const seen = new Set<string>();
    let last = "all";
    setStatus("waiting");
    const receive = async (payload: string) => {
      try {
        const next = parseBundle(await decrypt(session.key, payload));
        if (!bundleIsEmpty(next)) setBundle(next);
      } catch {
        /* Wrong key, tampering or expiry: ignore. */
      }
    };
    void (async () => {
      let failures = 0;
      while (!controller.signal.aborted) {
        try {
          await subscribe(
            session.room,
            last,
            (id, message) => {
              last = id;
              const chunk = parseChunk(message);
              if (!chunk) return;
              const done = assembler.add(chunk);
              if (done && !seen.has(done.id)) {
                seen.add(done.id);
                void receive(done.payload);
              }
            },
            controller.signal,
          );
          failures = 0;
          setStatus("waiting");
          await sleep(1500, controller.signal);
        } catch {
          if (controller.signal.aborted) return;
          failures++;
          if (failures >= 4) setStatus("error");
          await sleep(Math.min(2000 * failures, 10000), controller.signal);
        }
      }
    })();
    return () => controller.abort();
  }, [enabled, session]);
  const restart = useCallback(() => {
    setBundle(null);
    setSession({ room: randomToken(16), key: randomToken(32) });
  }, []);
  return {
    link: `${publicSiteUrl()}#/pair?r=${session.room}&k=${session.key}`,
    status,
    bundle,
    clear: () => setBundle(null),
    restart,
  };
}
