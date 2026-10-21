import { useCallback, useEffect, useRef, useState } from "react";
import { controlRelay } from "../config/control";
import { randomToken } from "../transfer/crypto";
import { tvIdentity, type TvIdentity } from "./identity";
import {
  credential,
  PROTOCOL,
  type Command,
  type NowPlaying,
  type Peer,
  type RelayMessage,
  type SyncDoc,
} from "./protocol";
import { ControlSocket, type SocketStatus } from "./socket";
import { LanLink } from "./lan";
import { parseControllerMessage } from "./protocol";

export interface CommandResult {
  ok: boolean;
  error?: string;
}
export interface Receiver {
  enabled: boolean;
  tvId: string;
  status: SocketStatus | "off";
  controllers: Peer[];
  // A one-time pairing code for the QR on the idle screen; rotates while shown.
  claim: string;
  report(state: NowPlaying): void;
  revoke(id: string | "*"): void;
  // A sync document for one phone, or for every paired phone.
  sync(doc: SyncDoc, full: boolean, to?: string): boolean;
}
const CLAIM_EVERY = 9 * 60 * 1000;

// The TV side of the control relay: stays connected while the app runs, answers paired
// phones' commands and tells them what is playing, on change only.
export function useReceiver(
  enabled: boolean,
  name: string,
  onSync: ((doc: SyncDoc, full: boolean, from: string) => void) | undefined,
  onCommand: (command: Command) => CommandResult | Promise<CommandResult>,
): Receiver {
  const on = enabled && !!controlRelay;
  const identity = useRef<TvIdentity | null>(null);
  if (on && !identity.current) identity.current = tvIdentity();
  const [status, setStatus] = useState<Receiver["status"]>(
    on ? "connecting" : "off",
  );
  const [controllers, setControllers] = useState<Peer[]>([]);
  const [claim, setClaim] = useState("");
  const socket = useRef<ControlSocket | null>(null);
  const handler = useRef(onCommand);
  handler.current = onCommand;
  const syncHandler = useRef(onSync);
  syncHandler.current = onSync;
  const last = useRef<{ state: NowPlaying; sentAt: number } | null>(null);
  const known = useRef(0);
  // Direct links to phones on the same network, by phone.
  const links = useRef(new Map<string, LanLink>());
  const issue = useCallback(() => {
    const code = randomToken(16);
    if (socket.current?.send({ t: "claim", code })) setClaim(code);
  }, []);
  useEffect(() => {
    if (!on || !identity.current) {
      setStatus("off");
      return;
    }
    const { id, secret } = identity.current;
    const receive = (message: RelayMessage) => {
      if (message.t === "hello") {
        socket.current?.send({ t: "name", name });
        issue();
        const state = last.current?.state;
        if (state) socket.current?.send({ t: "state", state });
        return;
      }
      if (message.t === "signal") {
        const from = message.from;
        if (!from) return;
        let link = links.current.get(from);
        if (!link) {
          const made: LanLink = new LanLink(
            (data) => socket.current?.send({ t: "signal", to: from, data }),
            (data) => {
              const command = parseControllerMessage(data);
              if (command?.t === "sync")
                syncHandler.current?.(command.doc, command.full === true, from);
              else if (command && "id" in command)
                run(command as Command, (reply) => made.send(reply));
            },
            (state) => {
              if (state === "open" && last.current)
                made.send({ t: "state", state: last.current.state });
              if (state === "failed" || state === "off")
                links.current.delete(from);
            },
          );
          link = made;
          links.current.set(from, link);
        }
        void link.receive(message.data);
        return;
      }
      if (message.t === "presence") {
        setControllers(message.controllers);
        for (const [id, link] of links.current)
          if (!message.controllers.some((c) => c.id === id && c.online)) {
            link.close();
            links.current.delete(id);
          }
        // A code is used up by the phone that paired with it.
        if (message.controllers.length > known.current) issue();
        known.current = message.controllers.length;
        return;
      }
      if (message.t === "sync") {
        if (message.from)
          syncHandler.current?.(
            message.doc,
            message.full === true,
            message.from,
          );
        return;
      }
      if ("from" in message && "id" in message) {
        const { from, ...command } = message;
        run(command as Command, (reply) =>
          socket.current?.send({ ...reply, to: from }),
        );
      }
    };
    // Runs a command and answers on the path it came by.
    const run = (command: Command, reply: (ack: object) => void) => {
      void Promise.resolve()
        .then(() => handler.current(command))
        .catch(() => ({ ok: false, error: "failed" }))
        .then((result) =>
          reply({
            t: "ack",
            id: command.id,
            ok: result.ok,
            ...(result.error ? { error: result.error } : {}),
          }),
        );
    };
    const ws = new ControlSocket(
      `${controlRelay}/v1/tv/${id}`,
      () => [PROTOCOL, credential.tv(secret)],
      receive,
      setStatus,
    );
    socket.current = ws;
    ws.start();
    const rotate = window.setInterval(issue, CLAIM_EVERY);
    const lanLinks = links.current;
    return () => {
      clearInterval(rotate);
      ws.stop();
      socket.current = null;
      for (const link of lanLinks.values()) link.close();
      lanLinks.clear();
    };
  }, [on, name, issue]);
  const report = useCallback((state: NowPlaying) => {
    const previous = last.current?.state;
    const expected = previous
      ? previous.phase === "playing"
        ? previous.position + (Date.now() - last.current!.sentAt) / 1000
        : previous.position
      : 0;
    const changed =
      !previous ||
      previous.phase !== state.phase ||
      previous.title !== state.title ||
      previous.itemId !== state.itemId ||
      previous.canSeek !== state.canSeek ||
      previous.canStep !== state.canStep ||
      previous.visible !== state.visible ||
      Math.abs(previous.duration - state.duration) > 1 ||
      Math.abs(expected - state.position) > 2;
    if (!changed) return;
    last.current = { state, sentAt: Date.now() };
    socket.current?.send({ t: "state", state });
    for (const link of links.current.values()) link.send({ t: "state", state });
  }, []);
  const revoke = useCallback((id: string) => {
    socket.current?.send({ t: "revoke", id });
  }, []);
  const sync = useCallback((doc: SyncDoc, full: boolean, to?: string) => {
    const message = { t: "sync", doc, ...(full ? { full } : {}) };
    if (to && links.current.get(to)?.send(message)) return true;
    return !!socket.current?.send({ ...message, ...(to ? { to } : {}) });
  }, []);
  return {
    enabled: on,
    tvId: identity.current?.id ?? "",
    status,
    controllers,
    claim,
    report,
    revoke,
    sync,
  };
}
