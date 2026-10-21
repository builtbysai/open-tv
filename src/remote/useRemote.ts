import { useCallback, useEffect, useRef, useState } from "react";
import { controlRelay } from "../config/control";
import { randomToken } from "../transfer/crypto";
import { pairings, usePairings, type Pairing } from "./pairings";
import {
  credential,
  PROTOCOL,
  type Command,
  type NowPlaying,
  type RelayMessage,
  type SyncDoc,
} from "./protocol";
import { ControlSocket, type SocketStatus } from "./socket";
import { LanLink, type LanState } from "./lan";

type Outgoing = Command extends infer C
  ? C extends { id: string }
    ? Omit<C, "id">
    : never
  : never;
export interface Remote {
  available: boolean;
  tv: Pairing | null;
  status: SocketStatus | "off";
  tvOnline: boolean;
  tvName: string;
  state: NowPlaying | null;
  // When `state` arrived, on this device's clock.
  receivedAt: number;
  // A direct connection on the home network, used when it opens.
  lan: LanState;
  send(command: Outgoing): Promise<void>;
  // A sync document for the TV, over the direct link when it is open.
  sync(doc: SyncDoc, full: boolean): boolean;
  // Makes another paired TV the one to play on, and waits until it can be reached.
  use(tvId: string): Promise<boolean>;
}
const messages: Record<string, string> = {
  offline: "Your TV isn’t reachable. Open Open TV on the TV.",
  timeout: "Your TV didn’t answer.",
  adult: "Show 18+ on the TV first.",
  unsupported: "The TV can’t do that with this player.",
  unplayable: "The TV couldn’t play this.",
  idle: "Nothing is playing on the TV.",
  background:
    "Open TV is behind another app on your TV. Open it there, then try again.",
  "adult-locked":
    "This TV doesn’t let phones show 18+. Allow it on the TV in Settings → Privacy.",
};
export const remoteMessage = (error: string) =>
  messages[error] ?? "The TV couldn’t do that.";

// The phone side: keeps a connection to the chosen TV while this page is open, shows what
// it is playing and sends it commands.
export function useRemote(
  deviceName: string,
  onSync?: (doc: SyncDoc, full: boolean) => void,
): Remote {
  const { list, active } = usePairings();
  const tv = list.find((p) => p.tvId === active) ?? null;
  const on = !!controlRelay && !!tv;
  const [status, setStatus] = useState<Remote["status"]>("off");
  const [tvOnline, setTvOnline] = useState(false);
  const [tvName, setTvName] = useState("");
  const [state, setState] = useState<{ state: NowPlaying; at: number } | null>(
    null,
  );
  const socket = useRef<ControlSocket | null>(null);
  const link = useRef<LanLink | null>(null);
  const syncRef = useRef(onSync);
  syncRef.current = onSync;
  const [lan, setLan] = useState<LanState>("off");
  const reachable = useRef({ tvId: "", online: false });
  reachable.current = { tvId: tv?.tvId ?? "", online: tvOnline };
  const pending = useRef(
    new Map<
      string,
      { resolve(): void; reject(e: Error): void; timer: number }
    >(),
  );
  const key = tv ? `${tv.tvId}:${tv.controllerId}:${tv.token}` : "";
  useEffect(() => {
    setState(null);
    setTvOnline(false);
    if (!on || !tv) {
      setStatus("off");
      return;
    }
    const waiting = pending.current;
    const receive = (message: RelayMessage) => {
      if (message.t === "hello") {
        socket.current?.send({ t: "name", name: deviceName });
        return;
      }
      if (message.t === "presence") {
        setTvOnline(message.tv);
        setTvName(message.tvName);
        pairings.setOnline(tv.tvId, message.tv);
        if (!message.tv) {
          setState(null);
          link.current?.close();
        } else if (link.current && link.current.state === "off")
          // The TV is here: try the direct path once per connection.
          void link.current.start();
        return;
      }
      if (message.t === "signal") {
        void link.current?.receive(message.data);
        return;
      }
      if (message.t === "state") {
        setState({ state: message.state, at: Date.now() });
        return;
      }
      if (message.t === "sync") {
        syncRef.current?.(message.doc, message.full === true);
        return;
      }
      if (message.t === "ack") {
        const entry = waiting.get(message.id);
        if (!entry) return;
        waiting.delete(message.id);
        clearTimeout(entry.timer);
        if (message.ok) entry.resolve();
        else entry.reject(new Error(message.error || "failed"));
      }
    };
    const ws = new ControlSocket(
      `${controlRelay}/v1/tv/${tv.tvId}`,
      () => [PROTOCOL, credential.controller(tv.controllerId, tv.token)],
      receive,
      (next) => {
        setStatus(next);
        if (next !== "open") {
          setTvOnline(false);
          pairings.setOnline(tv.tvId, false);
        }
        // The TV removed this phone, or forgot itself: the pairing is over (unless
        // this phone has just paired with it again).
        if (
          next === "refused" &&
          pairings
            .get()
            .list.some((p) => p.tvId === tv.tvId && p.token === tv.token)
        )
          pairings.remove(tv.tvId);
      },
    );
    socket.current = ws;
    link.current = LanLink.supported()
      ? new LanLink(
          (data) => ws.send({ t: "signal", data }),
          (data) => {
            try {
              receive(JSON.parse(data) as RelayMessage);
            } catch {
              /* Ignore. */
            }
          },
          setLan,
        )
      : null;
    ws.start();
    return () => {
      link.current?.close(false);
      link.current = null;
      setLan("off");
      ws.stop();
      socket.current = null;
      for (const entry of waiting.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("offline"));
      }
      waiting.clear();
    };
    // The pairing's identity, not the object, decides when to reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key, deviceName]);
  const send = useCallback((command: Outgoing) => {
    const id = randomToken(9);
    return new Promise<void>((resolve, reject) => {
      const message = { ...command, id };
      if (!link.current?.send(message) && !socket.current?.send(message)) {
        reject(new Error("offline"));
        return;
      }
      const timer = window.setTimeout(() => {
        pending.current.delete(id);
        reject(new Error("timeout"));
      }, 10000);
      pending.current.set(id, { resolve, reject, timer });
    });
  }, []);
  const sync = useCallback((doc: SyncDoc, full: boolean) => {
    const message = { t: "sync", doc, ...(full ? { full } : {}) };
    return !!link.current?.send(message) || !!socket.current?.send(message);
  }, []);
  const use = useCallback((tvId: string) => {
    pairings.choose(tvId);
    return new Promise<boolean>((resolve) => {
      const started = Date.now();
      const check = () => {
        const now = reachable.current;
        if (now.tvId === tvId && now.online && socket.current?.open)
          return resolve(true);
        if (Date.now() - started > 6000) return resolve(false);
        setTimeout(check, 150);
      };
      check();
    });
  }, []);
  return {
    available: !!controlRelay,
    tv,
    status,
    tvOnline,
    tvName,
    state: state?.state ?? null,
    receivedAt: state?.at ?? 0,
    lan,
    send,
    sync,
    use,
  };
}

// Pairs this device using the one-time code from the TV's QR. Resolves once the relay
// has issued this device its own token. Pairing again with the same TV replaces the old
// entry on both sides. `doc` (this device's sync document) goes to the TV at once.
export function claimPairing(
  tvId: string,
  code: string,
  name: string,
  doc?: SyncDoc | null,
): Promise<Pairing> {
  return new Promise((resolve, reject) => {
    if (!controlRelay) {
      reject(new Error("off"));
      return;
    }
    const previous = pairings.get().list.find((p) => p.tvId === tvId);
    const ws = new WebSocket(`${controlRelay}/v1/tv/${tvId}`, [
      PROTOCOL,
      credential.claim(code),
      ...(previous
        ? [credential.controller(previous.controllerId, previous.token)]
        : []),
    ]);
    let tvName = name;
    let done = false;
    let tvHere = false;
    let sent = !doc;
    const sendDoc = () => {
      if (sent || !done || !tvHere) return;
      sent = true;
      ws.send(JSON.stringify({ t: "sync", doc, full: true }));
    };
    const timer = window.setTimeout(() => {
      ws.close();
      if (!done) reject(new Error("timeout"));
    }, 12000);
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as RelayMessage;
        if (message.t === "presence") {
          tvName = message.tvName || tvName;
          tvHere = message.tv;
          sendDoc();
        }
        if (message.t === "paired") {
          done = true;
          clearTimeout(timer);
          const pairing: Pairing = {
            tvId,
            controllerId: message.controllerId,
            token: message.token,
            name: tvName || "TV",
            pairedAt: Date.now(),
          };
          pairings.add(pairing);
          sendDoc();
          // Waits a moment for the TV's name, then hands over to the regular connection.
          setTimeout(() => {
            if (tvName && tvName !== pairing.name)
              pairings.rename(tvId, tvName);
            ws.close(1000);
          }, 400);
          resolve(pairing);
        }
      } catch {
        /* Ignore. */
      }
    };
    ws.onclose = () => {
      clearTimeout(timer);
      if (!done) reject(new Error("refused"));
    };
  });
}

// Ends a pairing from this side: the relay forgets this device's token and the TV sees it
// gone at once. Forgotten here even when the relay can't be reached.
export function revokePairing(pairing: Pairing): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      pairings.remove(pairing.tvId);
      resolve();
    };
    if (!controlRelay) return finish();
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${controlRelay}/v1/tv/${pairing.tvId}`, [
        PROTOCOL,
        credential.controller(pairing.controllerId, pairing.token),
      ]);
    } catch {
      return finish();
    }
    const timer = window.setTimeout(() => {
      ws.close();
      finish();
    }, 6000);
    ws.onmessage = (event) => {
      try {
        if ((JSON.parse(String(event.data)) as RelayMessage).t === "hello")
          ws.send(JSON.stringify({ t: "revoke" }));
      } catch {
        /* Ignore. */
      }
    };
    ws.onclose = () => {
      clearTimeout(timer);
      finish();
    };
  });
}
