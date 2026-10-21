import type { Content, Source } from "../domain/content";
import type { MediaServer } from "../domain/servers";
import { privateViewingEnabled } from "../config/safety";
import type { SettingsProps } from "../components/settings/types";
import type { AccountDraft } from "../transfer/bundle";
import type { UserState } from "../persistence/user-state";
import type { useUserPatches } from "./useUserPatches";
import { Settings } from "../components/Settings";

// Settings takes a long flat list of props. This groups them by what they belong to and
// handles the few that need a bit of logic on the way through.
export function SettingsRoute({
  updates,
  guide,
  checkableItems,
  resolveUrl,
  relay,
  onRelay,
  catalog,
  servers,
  accounts,
  viewer,
  tmdb,
  extension,
  music,
  onGuidedSetup,
}: {
  updates: SettingsProps["updates"];
  guide: SettingsProps["guide"];
  checkableItems: Content[];
  resolveUrl: SettingsProps["resolveUrl"];
  relay: SettingsProps["relay"];
  onRelay: SettingsProps["onRelay"];
  catalog: {
    sources: Source[];
    status: Record<string, string>;
    onSource(source: Source, force?: boolean): void;
    onReclassify: SettingsProps["onReclassify"];
    onRemoveSource: SettingsProps["onRemoveSource"];
    onItems: SettingsProps["onItems"];
    onAccount: SettingsProps["onAccount"];
    // A source that was switched off: close anything open from it.
    onDisabled(sourceId: string): void;
  };
  servers: {
    servers: MediaServer[];
    personalMedia: Content[];
    onSave: SettingsProps["onSaveServer"];
    onRemove: SettingsProps["onRemoveServer"];
  };
  accounts: {
    saved: AccountDraft[];
    onSave: SettingsProps["onSaveAccount"];
    onForget: SettingsProps["onForgetAccount"];
    onConnect: SettingsProps["onConnectAccount"];
  };
  viewer: {
    user: UserState;
    adult: boolean;
    onAdult: SettingsProps["onAdult"];
    patches: ReturnType<typeof useUserPatches>;
  };
  tmdb: {
    status: SettingsProps["discoveryStatus"];
    hasStoredKey: boolean;
    onConnect: SettingsProps["onMetadata"];
  };
  extension: SettingsProps["extension"];
  music: SettingsProps["music"];
  onGuidedSetup(): void;
}) {
  const { patches } = viewer;
  return (
    <Settings
      updates={updates}
      guide={guide}
      checkableItems={checkableItems}
      resolveUrl={resolveUrl}
      relay={relay}
      onRelay={onRelay}
      sources={
        privateViewingEnabled
          ? catalog.sources
          : catalog.sources.filter((s) => s.classification === "general")
      }
      status={catalog.status}
      onSource={(source, force) => {
        catalog.onSource(source, force);
        if (!source.enabled && source.kind === "xtream")
          catalog.onDisabled(source.id);
      }}
      onReclassify={catalog.onReclassify}
      onRemoveSource={catalog.onRemoveSource}
      onItems={catalog.onItems}
      onAccount={catalog.onAccount}
      servers={servers.servers}
      personalMedia={servers.personalMedia}
      onSaveServer={servers.onSave}
      onRemoveServer={servers.onRemove}
      savedAccounts={accounts.saved}
      onSaveAccount={accounts.onSave}
      onForgetAccount={accounts.onForget}
      onConnectAccount={accounts.onConnect}
      user={viewer.user}
      adult={viewer.adult}
      onAdult={viewer.onAdult}
      onProfileImport={patches.importProfile}
      onDrafts={patches.setDrafts}
      onPreferences={patches.setPreferences}
      onClearHistory={patches.clearHistory}
      discoveryStatus={tmdb.status}
      hasStoredKey={tmdb.hasStoredKey}
      onMetadata={tmdb.onConnect}
      extension={extension}
      music={music}
      onGuidedSetup={onGuidedSetup}
    />
  );
}
