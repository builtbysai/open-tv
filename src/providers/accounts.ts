import type { AccountDraft } from "../transfer/bundle";
import type { EpisodicProvider } from "./contracts";
import { JellyfinProvider } from "./jellyfin";
import { XtreamProvider } from "./xtream";
// One entry point for the account kinds that sign in with a server, username and password.
export function accountProvider(account: AccountDraft): EpisodicProvider {
  if (account.service === "jellyfin")
    return new JellyfinProvider(
      account.server,
      account.username,
      account.password,
      account.mode === "series" ? "series" : "movie",
    );
  return new XtreamProvider(
    account.server,
    account.username,
    account.password,
    account.mode,
  );
}
