import {
  parseUpdateManifest,
  sameManifest,
  trustedUpdateUrl,
  type UpdateManifest,
} from "../domain/catalog-updates";
import { limitedText, sourceFetch } from "../providers/http";

export const UPDATE_STORAGE_KEY = "opentv:public-updates:v1";
const INTERVAL = 30 * 60000,
  MAX_BACKOFF = 6 * 3600000;
export interface UpdateSnapshot {
  manifest: UpdateManifest;
  status:
    | "bundled"
    | "cached"
    | "checking"
    | "current"
    | "updated"
    | "offline"
    | "disabled";
  checkedAt: number;
  attemptAt: number;
  nextCheckAt: number;
  failures: number;
}
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export class CatalogUpdateService {
  private listeners = new Set<(state: UpdateSnapshot) => void>();
  private active?: {
    controller: AbortController;
    promise: Promise<UpdateSnapshot>;
  };
  private state: UpdateSnapshot;
  readonly endpoint: string | null;
  constructor(
    endpoint: string | null,
    private baseline: UpdateManifest,
    private storage?: Storage,
    private fetcher: typeof sourceFetch = sourceFetch,
    private now = Date.now,
  ) {
    this.endpoint = endpoint && trustedUpdateUrl(endpoint);
    this.state = {
      manifest: baseline,
      status: this.endpoint ? "bundled" : "disabled",
      checkedAt: 0,
      attemptAt: 0,
      nextCheckAt: 0,
      failures: 0,
    };
    this.restore();
  }
  get snapshot() {
    return this.state;
  }
  subscribe(listener: (state: UpdateSnapshot) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(state: UpdateSnapshot) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
  private acceptable(manifest: UpdateManifest) {
    const current = this.state.manifest;
    if (
      manifest.revision < current.revision ||
      manifest.revision < this.baseline.revision ||
      (manifest.revision === current.revision &&
        !sameManifest(manifest, current))
    )
      throw new Error("Stale or conflicting public update.");
  }
  restore() {
    if (!this.endpoint) return;
    try {
      const text = this.storage?.getItem(UPDATE_STORAGE_KEY);
      if (!text || text.length > 1000000) return;
      const value = JSON.parse(text);
      if (value?.version !== 1 || value.endpoint !== this.endpoint) return;
      const manifest = parseUpdateManifest(value.manifest);
      this.acceptable(manifest);
      const bounded = (value: unknown, max: number) =>
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= max
          ? value
          : 0;
      const now = this.now();
      this.publish({
        manifest,
        status: "cached",
        checkedAt: bounded(value.checkedAt, now + 60000),
        attemptAt: bounded(value.attemptAt, now + 60000),
        nextCheckAt: bounded(value.nextCheckAt, now + MAX_BACKOFF),
        failures: Math.floor(bounded(value.failures, 9)),
      });
    } catch {
      /* Retain the last valid in-memory or compiled policy. */
    }
  }
  private save() {
    try {
      const { manifest, checkedAt, attemptAt, nextCheckAt, failures } =
        this.state;
      this.storage?.setItem(
        UPDATE_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          endpoint: this.endpoint,
          manifest,
          checkedAt,
          attemptAt,
          nextCheckAt,
          failures,
        }),
      );
    } catch {
      /* Memory-only operation still enforces this session's policy. */
    }
  }
  cancel() {
    this.active?.controller.abort();
  }
  check(force = false): Promise<UpdateSnapshot> {
    if (this.active) return this.active.promise;
    const now = this.now();
    if (
      !this.endpoint ||
      (!force && now < this.state.nextCheckAt) ||
      (this.state.attemptAt > 0 && now - this.state.attemptAt < 15000)
    )
      return Promise.resolve(this.state);
    const controller = new AbortController();
    const previous = this.state;
    this.publish({ ...previous, status: "checking", attemptAt: now });
    const run = async () => {
      try {
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(8000),
        ]);
        const response = await this.fetcher(this.endpoint!, {
          signal,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
        });
        if (
          !response.ok ||
          !/^application\/json(?:;|$)/i.test(
            response.headers.get("content-type") || "",
          )
        )
          throw new Error();
        const manifest = parseUpdateManifest(
          JSON.parse(await limitedText(response, 1000000)),
        );
        signal.throwIfAborted();
        this.acceptable(manifest);
        const at = this.now();
        this.publish({
          manifest,
          status:
            manifest.revision > this.baseline.revision ? "updated" : "current",
          checkedAt: at,
          attemptAt: now,
          nextCheckAt: at + INTERVAL,
          failures: 0,
        });
        this.save();
      } catch {
        if (controller.signal.aborted)
          this.publish({ ...this.state, status: previous.status });
        else {
          const failures = Math.min(this.state.failures + 1, 9);
          this.publish({
            ...this.state,
            status: "offline",
            failures,
            nextCheckAt:
              this.now() + Math.min(MAX_BACKOFF, 60000 * 2 ** (failures - 1)),
          });
          this.save();
        }
      } finally {
        this.active = undefined;
      }
      return this.state;
    };
    const promise = Promise.resolve().then(run);
    this.active = { controller, promise };
    return promise;
  }
}
