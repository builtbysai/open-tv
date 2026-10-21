import type { AccountDraft } from "../transfer/bundle";
const slot = "opentv:xtream-accounts:v1";
const MAX_ACCOUNTS = 4;
const modes = ["live", "movie", "series"];
const sameAccount = (a: AccountDraft, b: AccountDraft) =>
  a.server === b.server &&
  a.username === b.username &&
  a.mode === b.mode &&
  (a.service ?? "xtream") === (b.service ?? "xtream");
export function loadSavedAccounts(): AccountDraft[] {
  try {
    const saved = JSON.parse(localStorage.getItem(slot) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved
      .filter(
        (a): a is AccountDraft =>
          typeof a?.server === "string" &&
          typeof a.username === "string" &&
          typeof a.password === "string" &&
          modes.includes(a.mode) &&
          (a.service === undefined ||
            a.service === "jellyfin" ||
            a.service === "xtream"),
      )
      .slice(0, MAX_ACCOUNTS);
  } catch {
    return [];
  }
}
function write(accounts: AccountDraft[]) {
  try {
    if (accounts.length) localStorage.setItem(slot, JSON.stringify(accounts));
    else localStorage.removeItem(slot);
  } catch {
    // Storage can be unavailable; the account still works for this session.
  }
}
export function saveAccount(account: AccountDraft): AccountDraft[] {
  const next = [
    account,
    ...loadSavedAccounts().filter((a) => !sameAccount(a, account)),
  ].slice(0, MAX_ACCOUNTS);
  write(next);
  return next;
}
export function forgetAccount(account: AccountDraft): AccountDraft[] {
  const next = loadSavedAccounts().filter((a) => !sameAccount(a, account));
  write(next);
  return next;
}
