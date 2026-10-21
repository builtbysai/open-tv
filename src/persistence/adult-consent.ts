const KEY = "opentv:adult-consent:v1";
const ACTIVE = "opentv:adult-active:v1";
const TRUST = "opentv:adult-trust:v1";
// The 18+ confirmation is asked once per device. Whether 18+ content is shown is remembered
// too, until it is hidden again. Only the choice is kept; the lists themselves are reloaded.
export function hasAdultConsent(): boolean {
  try {
    return Boolean(JSON.parse(localStorage.getItem(KEY) || "null")?.at);
  } catch {
    return false;
  }
}
export function recordAdultConsent() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: new Date().toISOString() }));
  } catch {
    /* Without storage the confirmation is asked again next time. */
  }
}
const flag = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};
const setFlag = (key: string, on: boolean) => {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* The choice then lasts for this visit only. */
  }
};
// 18+ was shown when the app last closed, so it should come back.
export const adultWasActive = () => flag(ACTIVE);
export const setAdultActive = (on: boolean) => setFlag(ACTIVE, on);
// A trusted device restores 18+ without asking for the PIN again.
export const adultTrusted = () => flag(TRUST);
export const setAdultTrusted = (on: boolean) => setFlag(TRUST, on);
// On a TV: a paired phone that shows 18+ may show it here too (off until allowed here).
const PHONES = "opentv:adult-phones:v1";
export const phonesMayShowAdult = () => flag(PHONES);
export const setPhonesMayShowAdult = (on: boolean) => setFlag(PHONES, on);
export function forgetAdultConsent() {
  setFlag(ACTIVE, false);
  setFlag(TRUST, false);
  setFlag(PHONES, false);
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* Nothing was stored. */
  }
}
