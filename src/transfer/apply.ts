import type { Source } from "../domain/content";
import type { MusicProvider } from "../music/types";
import type { MediaServer } from "../domain/servers";
import { parseProfile } from "../persistence/profile";
import type { UserState } from "../persistence/user-state";
import type { AccountDraft, Bundle } from "./bundle";
export interface BundleHandlers {
  onSource(source: Source): void;
  onServer(server: MediaServer): void;
  onMusicProvider(provider: MusicProvider): void;
  onKey(key: string): void;
  onProfile(profile: UserState): void;
  onAccount(account: AccountDraft): void;
  // Connect these sources if they exist here and aren't connected yet.
  onConnect?(ids: string[]): void;
}
// Applies a validated bundle from a phone or a backup file. An unreadable profile is
// skipped so the rest still imports.
export function applyBundle(bundle: Bundle, handlers: BundleHandlers) {
  for (const playlist of bundle.playlists) handlers.onSource(playlist);
  // Servers keep the on/off state they had where they came from.
  for (const server of bundle.servers) handlers.onServer(server);
  for (const provider of bundle.musicProviders ?? [])
    handlers.onMusicProvider(provider);
  if (bundle.tmdbKey) handlers.onKey(bundle.tmdbKey);
  if (bundle.profile) {
    try {
      handlers.onProfile(parseProfile(JSON.stringify(bundle.profile)));
    } catch {
      /* Skipped. */
    }
  }
  if (bundle.account) handlers.onAccount(bundle.account);
  if (bundle.connect?.length) handlers.onConnect?.(bundle.connect);
}
export const importedMessage = (bundle: Bundle, done: string) =>
  bundle.account ? "Imported. Connecting your account…" : done;
