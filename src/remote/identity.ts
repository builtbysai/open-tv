import { randomToken } from "../transfer/crypto";
// This TV's identity on the control relay: a random id (shown only in its pairing code)
// and a secret that never leaves the device. Made once and kept.
export interface TvIdentity {
  id: string;
  secret: string;
}
const KEY = "opentv:tv-identity:v1";
const valid = (value: unknown): value is TvIdentity => {
  const v = value as TvIdentity | null;
  return (
    !!v &&
    /^[A-Za-z0-9_-]{16,64}$/.test(v.id ?? "") &&
    /^[A-Za-z0-9_-]{32,64}$/.test(v.secret ?? "")
  );
};
export function tvIdentity(storage: Storage = localStorage): TvIdentity {
  try {
    const stored = JSON.parse(storage.getItem(KEY) || "null");
    if (valid(stored)) return stored;
  } catch {
    /* Made below. */
  }
  const made = { id: randomToken(16), secret: randomToken(32) };
  try {
    storage.setItem(KEY, JSON.stringify(made));
  } catch {
    /* Lasts for this visit; the phone will need to pair again. */
  }
  return made;
}
