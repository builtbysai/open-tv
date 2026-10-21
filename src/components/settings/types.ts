import type { MutableRefObject } from "react";
import type { Content, Source } from "../../domain/content";
import type { EpisodicProvider } from "../../providers/contracts";
import type { GuideConnection } from "../../app/useGuide";
import type { UserState } from "../../persistence/user-state";
import type { FormDrafts } from "../../domain/view-state";
import type { RelayConnection } from "../../playback/transport";
import type { PlaybackResolver } from "../../playback/transport";
import type { AccountDraft, Bundle } from "../../transfer/bundle";
import { type CatalogUpdateState } from "../CatalogUpdates";
import { type MediaServer } from "../../domain/servers";
export interface SettingsProps {
  updates: CatalogUpdateState;
  onProfileImport(profile: UserState): void;
  checkableItems: Content[];
  resolveUrl: PlaybackResolver;
  relay: RelayConnection | null;
  onRelay(value: RelayConnection | null): void;
  servers: MediaServer[];
  personalMedia: Content[];
  onSaveServer(server: MediaServer): boolean;
  onRemoveServer(id: string): void;
  sources: Source[];
  status: Record<string, string>;
  onSource(source: Source, force?: boolean): void;
  onReclassify(source: Source, to: "general" | "adult"): void;
  onRemoveSource(id: string): void;
  onItems(source: Source, items: Content[]): void;
  onAccount(provider: EpisodicProvider, signal: AbortSignal): Promise<number>;
  adult: boolean;
  onAdult(value: boolean): void;
  user: UserState;
  onPreferences(patch: Partial<UserState["preferences"]>): void;
  guide: GuideConnection;
  onMetadata(key: string, remember: boolean): void;
  savedAccounts: AccountDraft[];
  onSaveAccount(account: AccountDraft): void;
  onForgetAccount(account: AccountDraft): void;
  onConnectAccount(account: AccountDraft): void;
  discoveryStatus: "idle" | "loading" | "ready" | "rejected" | "unavailable";
  hasStoredKey: boolean;
  onClearHistory(): void;
  extension: {
    info: import("../../app/useExtension").ExtensionInfo | null;
    guides: { name: string; url: string }[];
    importFile(file: File): Promise<string>;
    importUrl(url: string): Promise<string>;
    refresh(): Promise<string>;
    remove(): Promise<void>;
  };
  music: import("../../app/useMusic").MusicState;
  onGuidedSetup(): void;
  onDrafts(patch: FormDrafts): void;
}

// State the Settings shell owns and its sections share.
export interface SettingsShared {
  message: string;
  setMessage(message: string): void;
  busy: boolean;
  setBusy(busy: boolean): void;
  mounted: MutableRefObject<boolean>;
  connections: MutableRefObject<Set<AbortController>>;
  report(error: unknown): void;
  exportBackup(): void;
  importBackup(file: File | undefined): Promise<void>;
  applyReceived(bundle: Bundle, done?: string): void;
  tab: SettingsTab;
  setTab(tab: SettingsTab): void;
}

export const settingsTabs = [
  ["sources", "Sources"],
  ["profiles", "Profiles & data"],
  ["playback", "This device"],
  ["privacy", "Privacy"],
  ["about", "About"],
] as const;
export type SettingsTab = (typeof settingsTabs)[number][0];
