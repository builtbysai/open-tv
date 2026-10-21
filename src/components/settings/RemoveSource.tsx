import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Source } from "../../domain/content";
import { sources as builtIn } from "../../providers/registry";
// Playlists you added yourself can be forgotten; built-in and extension lists only
// disconnect.
export const removable = (source: Source) =>
  !source.extension &&
  source.kind === "m3u" &&
  !builtIn.some((d) => d.id === source.id);
export function RemoveSource({
  source,
  onRemove,
}: {
  source: Source;
  onRemove(id: string): void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!removable(source)) return null;
  return confirming ? (
    <span className="confirm-inline">
      <button
        className="button danger small"
        onClick={() => onRemove(source.id)}
      >
        Remove
      </button>
      <button
        className="button text small"
        onClick={() => setConfirming(false)}
      >
        Keep
      </button>
    </span>
  ) : (
    <button
      className="icon-button"
      aria-label={`Remove ${source.name}`}
      onClick={() => setConfirming(true)}
    >
      <Trash2 size={16} />
    </button>
  );
}
