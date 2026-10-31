import { data } from "../app/data";
import { open, seal, type Sealed } from "../core/crypto";
import { missingFrom, parseDoc, type Doc } from "../core/lww";

// Keeps this device's document equal to its peers', through the relay, end to end encrypted.
// Both sides run the same logic: push what changed, merge what arrives, and send back anything
// the sender was missing or had older. When both sides are equal nothing further is sent.
export class SyncChannel {
  private stop: () => void;
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private key: CryptoKey,
    private send: (sealed: Sealed, to?: string) => boolean,
  ) {
    this.stop = data.onLocalChange((keys) => {
      for (const k of keys) this.pending.add(k);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 400);
    });
  }
  close() {
    this.stop();
    clearTimeout(this.timer);
  }

  private async push(doc: Doc, to?: string) {
    if (!Object.keys(doc).length) return;
    try {
      this.send(await seal(this.key, JSON.stringify(doc)), to);
    } catch {
      /* Encryption needs a secure page; without one sync is simply off. */
    }
  }
  private flush() {
    const keys = [...this.pending];
    this.pending.clear();
    const all = data.doc.value;
    const part: Doc = {};
    for (const k of keys) if (all[k]) part[k] = all[k];
    void this.push(part);
  }
  // Everything we have, to one peer (or all): used on connect.
  pushAll(to?: string) {
    void this.push(data.doc.value, to);
  }

  async receive(sealed: Sealed, from?: string): Promise<string[]> {
    const plain = await open(this.key, sealed);
    if (plain === null) return [];
    let remote: Doc | null = null;
    try {
      remote = parseDoc(JSON.parse(plain));
    } catch {
      /* Not a document. */
    }
    if (!remote) return [];
    const changed = data.applyRemote(remote);
    // Reply only about keys the sender mentioned and we hold newer: a partial update must not
    // trigger a full-document reply. (Entries only we have go out in pushAll on connect.)
    const mentioned: Doc = {};
    for (const k of Object.keys(remote)) if (data.doc.value[k]) mentioned[k] = data.doc.value[k];
    const back = missingFrom(mentioned, remote);
    if (Object.keys(back).length) void this.push(back, from);
    return changed;
  }
}
