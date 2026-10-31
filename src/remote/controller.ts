import { signal } from "@preact/signals";
import { importKey, randomId } from "../core/crypto";
import { SyncChannel } from "./sync";
import { savePairedTv, type PairedTv } from "./pairing";
import { credential, type Command, type NowPlaying, type PeerInfo, type RelayMessage } from "./protocol";
import { RelayClient, relayUrl } from "./relay-client";

type Body<T> = T extends unknown ? Omit<T, "id"> : never;
export type CommandBody = Body<Command>;

// The phone's side: one connection to one paired TV. Sends commands and waits for the TV's
// answer, shows what the TV is doing, and keeps setup data in step.
export class Controller {
  readonly client: RelayClient;
  readonly state = signal<NowPlaying | null>(null);
  readonly tvOnline = signal(false);
  readonly tvName = signal("");
  readonly phones = signal<PeerInfo[]>([]);
  // Set when the TV removed this phone: the app should forget the pairing.
  readonly removed = signal(false);
  private sync: SyncChannel | null = null;
  private waiting = new Map<string, (ok: boolean, error?: string) => void>();
  private tv: PairedTv;

  constructor(tv: PairedTv) {
    this.tv = tv;
    this.tvName.value = tv.name;
    this.client = new RelayClient(
      () => relayUrl(tv.tvId),
      () => [credential.controller(this.tv.controllerId, this.tv.token)],
    );
    this.client.onOpen = () => this.sync?.pushAll();
    this.client.onRefused = (code) => {
      if (code === 4401) this.removed.value = true;
    };
    this.client.onMessage = (m) => this.receive(m);
  }

  async start() {
    try {
      const key = await importKey(this.tv.key);
      this.sync = new SyncChannel(key, (sealed) => this.client.send({ t: "sync", ...sealed }));
    } catch {
      /* Sync is off without a secure page; the remote still works. */
    }
    this.client.start();
  }
  stop() {
    this.client.stop();
    this.sync?.close();
    for (const done of this.waiting.values()) done(false, "Disconnected");
    this.waiting.clear();
  }

  // Resolves with the TV's answer, or a reason it did not get through.
  send(body: CommandBody, timeout = 6000): Promise<{ ok: boolean; error?: string }> {
    const id = randomId(9);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        resolve({ ok: false, error: "No answer from the TV" });
      }, timeout);
      this.waiting.set(id, (ok, error) => {
        clearTimeout(timer);
        resolve({ ok, error });
      });
      if (!this.client.send({ ...body, id })) {
        this.waiting.delete(id);
        clearTimeout(timer);
        resolve({ ok: false, error: "Not connected" });
      }
    });
  }
  // Fire and forget, for key presses where the next press is the retry.
  press(body: CommandBody) {
    this.client.send({ ...body, id: randomId(9) });
  }

  revokeSelf() {
    this.client.send({ t: "revoke" });
  }
  rename(name: string) {
    this.client.send({ t: "name", name });
  }

  private receive(m: RelayMessage) {
    switch (m.t) {
      case "state":
        this.state.value = m.state;
        break;
      case "presence":
        this.tvOnline.value = m.tv;
        this.tvName.value = m.tvName;
        this.phones.value = m.controllers;
        if (m.tvName !== this.tv.name) {
          this.tv = { ...this.tv, name: m.tvName };
          savePairedTv(this.tv);
        }
        if (!m.tv) this.state.value = null;
        break;
      case "ack": {
        const done = this.waiting.get(m.id);
        if (done) {
          this.waiting.delete(m.id);
          done(m.ok, m.error);
        }
        break;
      }
      case "sync":
        void this.sync?.receive(m);
        break;
      default:
        break;
    }
  }
}

// Pairs a phone with a TV from a scanned link. Resolves with the saved TV, or says why not.
export function claim(tvId: string, code: string, key: string, old?: PairedTv): Promise<PairedTv> {
  return new Promise((resolve, reject) => {
    const creds = [credential.claim(code), ...(old ? [credential.controller(old.controllerId, old.token)] : [])];
    const client = new RelayClient(() => relayUrl(tvId), () => creds);
    let done = false;
    const finish = (error?: string, tv?: PairedTv) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.stop();
      if (tv) {
        savePairedTv(tv);
        resolve(tv);
      }
      else reject(new Error(error || "Could not pair"));
    };
    const timer = setTimeout(() => finish("The TV did not answer. Is it on and online?"), 15000);
    client.onRefused = (_c, reason) => finish(reason);
    let name = "TV";
    let paired: { controllerId: string; token: string } | null = null;
    const complete = () => {
      if (paired)
        finish(undefined, { tvId, name, controllerId: paired.controllerId, token: paired.token, key, at: Date.now() });
    };
    client.onMessage = (m) => {
      if (m.t === "presence") name = m.tvName;
      if (m.t === "paired") {
        paired = { controllerId: m.controllerId, token: m.token };
        // The TV's name arrives in the presence message right after; do not wait long for it.
        setTimeout(complete, 1500);
      } else if (m.t === "presence") complete();
    };
    client.start();
  });
}
