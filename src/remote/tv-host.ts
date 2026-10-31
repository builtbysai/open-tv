import { effect, signal } from "@preact/signals";
import { importKey, randomId } from "../core/crypto";
import { SyncChannel } from "./sync";
import { pairingLink, say, type TvIdentity } from "./pairing";
import { credential, type Command, type NowPlaying, type PeerInfo, type RelayMessage } from "./protocol";
import { RelayClient, relayUrl } from "./relay-client";

const CLAIM_REFRESH = 9 * 60 * 1000;
const STATE_HEARTBEAT = 5000;

// The TV's side of the remote: connects to the relay, offers a pairing code, runs commands
// from phones and tells them what is on screen.
export class TvHost {
  readonly client: RelayClient;
  readonly phones = signal<PeerInfo[]>([]);
  readonly code = signal("");
  private sync: SyncChannel | null = null;
  private seen = new Set<string>();
  private claimTimer: ReturnType<typeof setInterval> | undefined;
  private stopEffect: (() => void) | undefined;
  private lastKey = "";
  private lastSent = 0;
  private name: string;
  private knowsPhones = false;

  constructor(
    private identity: TvIdentity,
    private snapshot: () => NowPlaying,
    // Runs a phone's command. `true` when done, otherwise a short reason for the phone to show.
    private handle: (cmd: Command) => true | string,
  ) {
    this.name = identity.name;
    this.client = new RelayClient(
      () => relayUrl(identity.tvId),
      () => [credential.tv(identity.secret)],
    );
    this.client.onOpen = () => {
      this.knowsPhones = false;
      this.newClaim();
      this.lastKey = "";
      this.pushState();
      this.sync?.pushAll();
    };
    this.client.onMessage = (m) => this.receive(m);
  }

  readonly pairingUrl = () => (this.code.value ? pairingLink(this.identity.tvId, this.code.value, this.identity.key) : "");

  async start() {
    try {
      const key = await importKey(this.identity.key);
      this.sync = new SyncChannel(key, (sealed, to) => this.client.send({ t: "sync", ...sealed, ...(to ? { to } : {}) }));
    } catch {
      /* No secure context: remote control still works, setup sync does not. */
    }
    this.client.start();
    this.claimTimer = setInterval(() => this.newClaim(), CLAIM_REFRESH);
    this.stopEffect = effect(() => {
      const s = this.snapshot();
      this.maybePush(s);
    });
  }
  stop() {
    this.client.stop();
    clearInterval(this.claimTimer);
    this.stopEffect?.();
    this.sync?.close();
  }

  newClaim() {
    const code = randomId(12);
    if (this.client.send({ t: "claim", code })) this.code.value = code;
  }
  revoke(id: string) {
    this.client.send({ t: "revoke", id });
  }
  rename(name: string) {
    this.name = name;
    this.client.send({ t: "name", name });
  }

  // Positions change every second; phones move them on themselves, so only a change in
  // anything else (or a slow heartbeat) is worth a message.
  private maybePush(s: NowPlaying) {
    const { pos: _p, at: _a, ...rest } = s;
    const key = JSON.stringify(rest);
    const now = Date.now();
    if (key === this.lastKey && now - this.lastSent < STATE_HEARTBEAT) return;
    if (this.client.send({ t: "state", state: s })) {
      this.lastKey = key;
      this.lastSent = now;
    }
  }
  private pushState() {
    this.maybePush(this.snapshot());
  }

  private receive(m: RelayMessage) {
    switch (m.t) {
      case "presence": {
        // A new entry after the first presence means a phone just paired: say so and replace
        // the spent code.
        if (this.knowsPhones && m.controllers.length > this.phones.value.length) {
          say("Phone connected");
          this.newClaim();
        }
        this.knowsPhones = true;
        this.phones.value = m.controllers;
        const online = m.controllers.filter((c) => c.online);
        for (const c of online) {
          if (!this.seen.has(c.id)) {
            this.seen.add(c.id);
            this.sync?.pushAll(c.id);
            this.pushState();
          }
        }
        for (const id of [...this.seen]) if (!online.some((c) => c.id === id)) this.seen.delete(id);
        break;
      }
      case "sync":
        void this.sync?.receive(m, m.from);
        break;
      case "hello":
      case "paired":
      case "state":
      case "ack":
        break;
      default: {
        const cmd = m as Command & { from: string };
        const result = this.handle(cmd);
        this.client.send({ t: "ack", id: cmd.id, to: cmd.from, ok: result === true, ...(result === true ? {} : { error: result }) });
      }
    }
  }
}
