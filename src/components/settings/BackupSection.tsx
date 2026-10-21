import { Download, Upload } from "lucide-react";
import type { SettingsShared } from "./types";
export function BackupSection({
  exportBackup,
  importBackup,
}: Pick<SettingsShared, "exportBackup" | "importBackup">) {
  return (
    <section className="settings-section" id="settings-backup-all">
      <h2>Backup</h2>
      <p className="muted">
        One file with your playlists, which sources are connected, servers,
        music providers, list and history. Logins, keys and personal media
        (export that from Library) are never included.
      </p>
      <div className="import-row">
        <button className="button secondary" onClick={exportBackup}>
          <Download size={16} />
          Export backup
        </button>
        <label className="button secondary file-input">
          <Upload size={16} />
          Import backup
          <input
            type="file"
            accept=".json"
            onChange={(e) => {
              void importBackup(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </section>
  );
}
