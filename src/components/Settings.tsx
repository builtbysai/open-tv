import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Toast } from "./Toast";
import { PairedTvs } from "./PairedTvs";
import { SyncLine } from "./SyncLine";
import { isTVMode } from "../tv/mode";
import { persistableUrl } from "../domain/urls";
import { diagnostics, friendlyError } from "../domain/errors";
import { GuideSettings } from "./GuideSettings";
import { DeviceSettings } from "./DeviceSettings";
import { exportJson } from "../persistence/export";
import { AppearanceSettings } from "./AppearanceSettings";
import { TVSettings } from "./TVSettings";
import { TransportSettings } from "./TransportSettings";
import { VideoDiagnostics } from "./VideoDiagnostics";
import { PlaybackLog } from "./PlaybackLog";
import { ProfileSettings } from "./ProfileSettings";
import { PhoneTransfer } from "./PhoneTransfer";
import { exportProfile } from "../persistence/profile";
import { applyBundle, importedMessage } from "../transfer/apply";
import { parseBundle } from "../transfer/bundle";
import { sources as builtInSources } from "../providers/registry";
import type { Bundle } from "../transfer/bundle";
import { ProfileTransfer } from "./ProfileTransfer";
import { CatalogUpdates } from "./CatalogUpdates";
import { ServerManager } from "./ServerManager";
import { canPersistServer } from "../domain/servers";
import { PrivacySettings } from "./PrivacySettings";
import { clearCatalogCache } from "../persistence/catalog-cache";
import { SourcesSection } from "./settings/SourcesSection";
import { PlaylistSection } from "./settings/PlaylistSection";
import { ExtensionSection } from "./settings/ExtensionSection";
import { MusicProviders } from "./settings/MusicProviders";
import { MediaSection } from "./settings/MediaSection";
import { AccountSection } from "./settings/AccountSection";
import { TmdbSection } from "./settings/TmdbSection";
import { BackupSection } from "./settings/BackupSection";
import { AdultSources } from "./settings/AdultSources";
import {
  settingsTabs,
  type SettingsProps,
  type SettingsTab,
} from "./settings/types";
import { buildLabel } from "../config/build";
import { SITE_NAME } from "../config/site";
export function Settings({
  updates,
  onProfileImport,
  checkableItems,
  resolveUrl,
  relay,
  onRelay,
  servers,
  personalMedia,
  onSaveServer,
  onRemoveServer,
  sources,
  status,
  onSource,
  onReclassify,
  onRemoveSource,
  onItems,
  onAccount,
  adult,
  onAdult,
  user,
  onPreferences,
  guide,
  onMetadata,
  savedAccounts,
  onSaveAccount,
  onForgetAccount,
  onConnectAccount,
  discoveryStatus,
  hasStoredKey,
  onClearHistory,
  onGuidedSetup,
  extension,
  music,
  onDrafts,
}: SettingsProps) {
  // On a TV, sources, servers, accounts and profiles are managed from the phone; the TV
  // keeps the choices that belong to it and the 18+ switch.
  const [tv] = useState(isTVMode);
  const tabs = tv
    ? settingsTabs.filter(([id]) => id !== "profiles")
    : settingsTabs;
  const [tab, setTab] = useState<SettingsTab>(() => {
      const fallback = "sources";
      try {
        const wanted = sessionStorage.getItem("opentv:settings-tab");
        sessionStorage.removeItem("opentv:settings-tab");
        return tabs.some(([id]) => id === wanted)
          ? (wanted as SettingsTab)
          : fallback;
      } catch {
        return fallback;
      }
    }),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const mounted = useRef(true),
    connections = useRef(new Set<AbortController>());
  useEffect(() => {
    mounted.current = true;
    const active = connections.current;
    return () => {
      mounted.current = false;
      for (const controller of active) controller.abort();
      active.clear();
    };
  }, []);
  const report = (e: unknown) => setMessage(friendlyError(e));
  const exportBackup = () => {
    const playlists = sources.filter(
      (s) =>
        s.url &&
        s.kind === "m3u" &&
        !s.extension &&
        !builtInSources.some((b) => b.id === s.id) &&
        persistableUrl(new URL(s.url, location.href).href),
    );
    exportJson("open-tv-backup.json", {
      v: 1,
      kind: "open-tv-backup",
      playlists,
      servers: servers.filter(canPersistServer),
      musicProviders: music.providers,
      profile: exportProfile(user),
      // Which lists were connected, so a restore connects them again.
      connect: sources
        .filter((s) => s.enabled && s.kind !== "xtream" && s.kind !== "library")
        .map((s) => s.id),
    });
  };
  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setMessage("This backup exceeds the 2 MB limit.");
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      if (data?.kind !== "open-tv-backup") throw new Error();
      applyReceived(
        parseBundle({ ...data, exp: Date.now() + 60000 }),
        "Backup restored.",
      );
    } catch {
      setMessage("Choose an Open TV backup file.");
    }
  };
  const applyReceived = (
    bundle: Bundle,
    done = "Imported from your phone.",
  ) => {
    applyBundle(bundle, {
      onSource,
      onServer: onSaveServer,
      onMusicProvider: music.save,
      onKey: (key) => onMetadata(key, true),
      onProfile: onProfileImport,
      onAccount: onConnectAccount,
      onConnect: (ids) => {
        for (const source of sources)
          if (
            ids.includes(source.id) &&
            !source.enabled &&
            source.classification === "general" &&
            source.kind !== "xtream"
          )
            onSource({ ...source, enabled: true });
      },
    });
    if (bundle.account && !tv) setTab("sources");
    setMessage(importedMessage(bundle, done));
  };
  return (
    <div className="settings-layout">
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Settings sections"
      >
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="settings-main">
        <div
          role="tabpanel"
          id="panel-sources"
          aria-labelledby="tab-sources"
          hidden={tab !== "sources"}
        >
          {tv ? (
            <p className="settings-note">
              Connect the sources you want to browse on this TV. Adding
              playlists, servers and accounts happens on your phone.
            </p>
          ) : (
            <section className="settings-section" id="settings-guided">
              <h2>Guided setup</h2>
              <p className="muted">
                The welcome steps: bring your servers from your phone, choose
                your sources, connect TMDB, choose a profile.
              </p>
              <button className="button secondary" onClick={onGuidedSetup}>
                Run guided setup
              </button>
            </section>
          )}
          <SourcesSection
            servers={servers}
            sources={sources}
            status={status}
            onSource={onSource}
            onReclassify={onReclassify}
            onRemoveSource={onRemoveSource}
            adult={adult}
          />
          {!tv && (
            <>
              <ExtensionSection extension={extension} />
              <PlaylistSection
                onSaveServer={onSaveServer}
                onSource={onSource}
                onItems={onItems}
                user={user}
                onDrafts={onDrafts}
                setMessage={setMessage}
                mounted={mounted}
                report={report}
              />
              <ServerManager
                servers={servers}
                media={personalMedia}
                onSave={onSaveServer}
                onRemove={onRemoveServer}
              />
              <MusicProviders music={music} />
              <MediaSection
                servers={servers}
                onItems={onItems}
                user={user}
                onDrafts={onDrafts}
                setMessage={setMessage}
              />
              <AccountSection
                onAccount={onAccount}
                savedAccounts={savedAccounts}
                onSaveAccount={onSaveAccount}
                onForgetAccount={onForgetAccount}
                setMessage={setMessage}
                busy={busy}
                setBusy={setBusy}
                mounted={mounted}
                connections={connections}
                report={report}
              />
              <GuideSettings guide={guide} suggestions={extension.guides} />

              <TmdbSection
                onMetadata={onMetadata}
                discoveryStatus={discoveryStatus}
                hasStoredKey={hasStoredKey}
              />
            </>
          )}
        </div>
        <div
          role="tabpanel"
          id="panel-profiles"
          aria-labelledby="tab-profiles"
          hidden={tab !== "profiles"}
        >
          <PhoneTransfer active={tab === "profiles"} onApply={applyReceived} />
          <ProfileSettings />
          <BackupSection
            exportBackup={exportBackup}
            importBackup={importBackup}
          />
          <div id="settings-backup">
            <ProfileTransfer user={user} onImport={onProfileImport} />
          </div>
        </div>
        <div
          role="tabpanel"
          id="panel-playback"
          aria-labelledby="tab-playback"
          hidden={tab !== "playback"}
        >
          {tv ? (
            <>
              <p className="settings-note">
                Sources, servers, accounts and profiles are managed on your
                phone. Pair it from this TV’s home screen.
              </p>
              <SyncLine tv />
            </>
          ) : (
            <PairedTvs />
          )}
          <DeviceSettings />
          <div id="settings-playback">
            {!tv && <TransportSettings connection={relay} onChange={onRelay} />}
            <VideoDiagnostics
              key={updates.manifest.revision}
              items={checkableItems}
              resolveUrl={resolveUrl}
            />
          </div>
          <AppearanceSettings />
          <div id="settings-device">
            <TVSettings />
          </div>
        </div>
        <div
          role="tabpanel"
          id="panel-privacy"
          aria-labelledby="tab-privacy"
          hidden={tab !== "privacy"}
        >
          <div id="settings-privacy">
            <PrivacySettings
              adult={adult}
              onAdult={onAdult}
              preferences={user.preferences}
              onPreferences={onPreferences}
              onMessage={setMessage}
            />
            <AdultSources
              adult={adult}
              sources={sources}
              status={status}
              onSource={onSource}
              onReclassify={onReclassify}
              onRemoveSource={onRemoveSource}
            />
            <section className="settings-section">
              <h3>Privacy & storage</h3>
              <p className="muted">
                Clear history or cached catalogs. Your library stays.
              </p>
              <button
                className="button secondary"
                onClick={() => {
                  onClearHistory();
                  setMessage("General viewing history and progress cleared.");
                }}
              >
                Clear viewing history
              </button>
              <button
                className="button text"
                onClick={() =>
                  void clearCatalogCache()
                    .then(() => setMessage("Public catalog cache cleared."))
                    .catch(() => setMessage("Catalog storage is unavailable."))
                }
              >
                Clear catalog cache
              </button>
            </section>
            <section className="settings-section">
              <h3>Diagnostics</h3>
              <p className="muted">View recent app errors.</p>
              <button
                className="button text"
                onClick={() => {
                  setMessage(
                    diagnostics()
                      .map((d) => `${d.at} ${d.code}`)
                      .join("\n") || "No diagnostic events this session.",
                  );
                }}
              >
                Show diagnostics
              </button>
            </section>
          </div>
        </div>
        <div
          role="tabpanel"
          id="panel-about"
          aria-labelledby="tab-about"
          hidden={tab !== "about"}
        >
          <section className="settings-section" id="settings-version">
            <h2>Version</h2>
            <p>
              {SITE_NAME} <code>{buildLabel()}</code>
            </p>
            <p className="fine-print">Quote this when reporting a problem.</p>
          </section>
          <div id="settings-updates">
            <CatalogUpdates state={updates} />
          </div>
          <PlaybackLog />
        </div>
      </div>

      {message && (
        <Toast
          message={message}
          icon={<AlertCircle size={18} />}
          onDone={() => setMessage("")}
        />
      )}
    </div>
  );
}
