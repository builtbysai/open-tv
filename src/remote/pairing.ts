import { signal } from "@preact/signals";
import { newSecretKey, randomId } from "../core/crypto";
import { hasHost } from "../core/env";
import { persisted, readJson, writeJson } from "../core/store";

// Identity of a TV: who it is to the relay (id + secret) and the key that encrypts setup data
// between it and its phones. Created once on first run and kept in the TV's storage.
export interface TvIdentity {
  tvId: string;
  secret: string;
  key: string;
  name: string;
}
const TV_KEY = "otv:tv";
const idLike = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v);

export function tvIdentity(): TvIdentity {
  const saved = readJson<TvIdentity>(TV_KEY, (v) => {
    const r = v as Partial<TvIdentity> | null;
    return r && idLike(r.tvId) && idLike(r.secret) && idLike(r.key) && typeof r.name === "string" ? (r as TvIdentity) : null;
  });
  if (saved) return saved;
  const made: TvIdentity = { tvId: randomId(12), secret: randomId(24), key: newSecretKey(), name: "TV" };
  writeJson(TV_KEY, made);
  return made;
}
export function renameTv(name: string) {
  writeJson(TV_KEY, { ...tvIdentity(), name });
}

// A TV a phone is paired with.
export interface PairedTv {
  tvId: string;
  name: string;
  controllerId: string;
  token: string;
  key: string;
  at: number;
}
export const pairedTvs = persisted<PairedTv[]>("otv:tvs", [], (v) =>
  Array.isArray(v)
    ? v.filter(
        (t): t is PairedTv =>
          !!t && idLike(t.tvId) && idLike(t.controllerId) && idLike(t.token) && idLike(t.key) && typeof t.name === "string",
      )
    : null,
);
export const activeTvId = persisted<string>("otv:active", "", (v) => (typeof v === "string" ? v : null));

export const activeTv = (): PairedTv | null =>
  pairedTvs.value.find((t) => t.tvId === activeTvId.value) ?? pairedTvs.value[0] ?? null;

export function savePairedTv(tv: PairedTv) {
  pairedTvs.value = [...pairedTvs.value.filter((t) => t.tvId !== tv.tvId), tv];
  activeTvId.value = tv.tvId;
}
export function forgetTv(tvId: string) {
  pairedTvs.value = pairedTvs.value.filter((t) => t.tvId !== tvId);
  if (activeTvId.value === tvId) activeTvId.value = pairedTvs.value[0]?.tvId ?? "";
}

// The link a phone opens (from the TV's QR code). The decryption key sits in the fragment,
// which browsers never send to any server.
function base(): string {
  if (hasHost() && __SITE_URL__) return __SITE_URL__.replace(/\/?$/, "/");
  return location.origin + location.pathname;
}
export const pairingLink = (tvId: string, code: string, key: string) => `${base()}#/pair/${tvId}/${code}/${key}`;
export function parsePairingHash(hash: string): { tvId: string; code: string; key: string } | null {
  const m = /^#?\/pair\/([A-Za-z0-9_-]{8,64})\/([A-Za-z0-9_-]{8,64})\/([A-Za-z0-9_-]{43})$/.exec(hash);
  return m ? { tvId: m[1], code: m[2], key: m[3] } : null;
}

// Short-lived text for the UI ("Phone connected").
export const toast = signal("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function say(message: string, ms = 3500) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), ms);
}
