import { statusLine, useSyncStatus } from "../sync/store";

// One quiet line: when this device last synced with its paired device, or that syncing
// stopped because the pairing was removed.
export function SyncLine({ tv }: { tv: boolean }) {
  const line = statusLine(useSyncStatus(), tv);
  return line ? (
    <p className="muted sync-line" role="status">
      {line}
    </p>
  ) : null;
}
