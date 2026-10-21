import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Download,
  Upload,
  Library,
  Plus,
  Pencil,
  Trash2,
  Undo2,
  FolderPlus,
  Check,
} from "lucide-react";
import type { MediaServer } from "../domain/servers";
import { type Content, type Source } from "../domain/content";
import type { Route, NamedCollection } from "../persistence/user-state";
import { contentAliases } from "../persistence/user-state";
import type { LibraryView } from "../domain/view-state";
import { canPersistContent } from "../domain/library";
import { validateContent } from "../providers/catalog";
import { exportJson } from "../persistence/export";
import { MediaEditor } from "../components/MediaEditor";
import { useRestricted } from "../components/ProfileGate";
interface Props {
  servers: MediaServer[];
  visible: Content[];
  personalMedia: Content[];
  favorites: Content[];
  wishlist: Content[];
  continueWatching: Content[];
  recent: Content[];
  view: LibraryView;
  onViewChange(patch: Partial<LibraryView>): void;
  collections: NamedCollection[];
  onCreateCollection(name: string): string | null;
  onRenameCollection(id: string, name: string): void;
  onDeleteCollection(id: string): void;
  onCollection(id: string, item: Content): void;
  renderCard(item: Content): ReactNode;
  onItems(source: Source, items: Content[]): void;
  onEdit(item: Content): void;
  onRemove(id: string): void;
  onRemoveHistory(item: Content): void;
  onClearHistory(): void;
  onNotice(message: string): void;
  navigate(route: Route): void;
}
export function LibraryScreen({
  onRemoveHistory,
  onClearHistory,
  servers,
  visible,
  personalMedia,
  favorites,
  wishlist,
  continueWatching,
  recent,
  view,
  onViewChange,
  collections,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onCollection,
  renderCard,
  onItems,
  onEdit,
  onRemove,
  onNotice,
  navigate,
}: Props) {
  const restricted = useRestricted();
  const [confirming, setConfirming] = useState<"collection" | "history" | null>(
    null,
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [libraryTab, setTab] = useState(view.tab),
    [limit, setLimitValue] = useState(view.limit),
    [editing, setEditing] = useState<Content | null>(null),
    [removed, setRemoved] = useState<Content | null>(null),
    [createOpen, setCreateOpen] = useState(false),
    [renameOpen, setRenameOpen] = useState(false);
  const setLibraryTab = (tab: string) => {
    setTab(tab);
    setLimitValue(72);
    onViewChange({ tab, limit: 72 });
  };
  const setLimit = (next: number | ((old: number) => number)) => {
    const value = typeof next === "number" ? next : next(limit);
    setLimitValue(value);
    onViewChange({ limit: value });
  };
  const activeCollection = collections.find(
    (c) => `collection:${c.id}` === libraryTab,
  );
  const items = useMemo(
    () =>
      activeCollection
        ? visible.filter((item) =>
            contentAliases(item).some((id) =>
              activeCollection.itemIds.includes(id),
            ),
          )
        : libraryTab === "saved"
          ? favorites
          : libraryTab === "wishlist"
            ? wishlist
            : libraryTab === "continue"
              ? continueWatching
              : libraryTab === "history"
                ? recent
                : personalMedia,
    [
      activeCollection,
      libraryTab,
      visible,
      favorites,
      wishlist,
      continueWatching,
      recent,
      personalMedia,
    ],
  );
  return (
    <>
      <div className="library-toolbar">
        <div className="library-tabs" role="group" aria-label="Library views">
          {[
            ["saved", "Saved"],
            ["wishlist", "Wishlist"],
            ["continue", "Continue watching"],
            ["history", "History"],
            ["personal", "Personal media"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={libraryTab === value ? "active" : ""}
              aria-pressed={libraryTab === value}
              onClick={() => {
                setLibraryTab(value);
                setLimit(72);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="library-collections">
          <select
            aria-label="Your collections"
            value={activeCollection?.id || ""}
            onChange={(e) => {
              if (e.target.value) {
                setLibraryTab(`collection:${e.target.value}`);
                setLimit(72);
              }
            }}
          >
            <option value="">Collections ({collections.length})</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {
            <button
              onClick={() => setCreateOpen(!createOpen)}
              aria-expanded={createOpen}
            >
              <FolderPlus size={15} />
              New collection
            </button>
          }
        </div>
      </div>
      {createOpen && (
        <form
          className="collection-form"
          onSubmit={(e) => {
            e.preventDefault();
            const id = onCreateCollection(
              String(new FormData(e.currentTarget).get("name")),
            );
            if (id) {
              setLibraryTab(`collection:${id}`);
              setCreateOpen(false);
            }
          }}
        >
          <label>
            Collection name
            <input
              name="name"
              required
              maxLength={80}
              autoFocus
              placeholder="Sunday cinema"
            />
          </label>
          <button className="button primary" type="submit">
            <Plus size={16} />
            Create collection
          </button>
        </form>
      )}
      {activeCollection && (
        <div className="collection-heading">
          <div>
            <h2>{activeCollection.name}</h2>
            <p className="muted">
              {items.length} available {items.length === 1 ? "title" : "titles"}{" "}
              · Add titles from their detail pages.
            </p>
          </div>
          {
            <div className="actions">
              <button
                className="button text"
                onClick={() => setRenameOpen(!renameOpen)}
              >
                <Pencil size={15} />
                Rename
              </button>
              {confirming === "collection" ? (
                <span className="confirm-inline">
                  <button
                    className="button danger small"
                    onClick={() => {
                      setConfirming(null);
                      onDeleteCollection(activeCollection.id);
                      setLibraryTab("saved");
                    }}
                  >
                    Delete “{activeCollection.name}”
                  </button>
                  <button
                    className="button text small"
                    onClick={() => setConfirming(null)}
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  className="button text"
                  onClick={() => setConfirming("collection")}
                >
                  <Trash2 size={15} />
                  Delete collection
                </button>
              )}
            </div>
          }
        </div>
      )}
      {renameOpen && activeCollection && (
        <form
          className="collection-form"
          onSubmit={(e) => {
            e.preventDefault();
            onRenameCollection(
              activeCollection.id,
              String(new FormData(e.currentTarget).get("name")),
            );
            setRenameOpen(false);
          }}
        >
          <label>
            New collection name
            <input
              name="name"
              required
              maxLength={80}
              defaultValue={activeCollection.name}
            />
          </label>
          <button className="button secondary">
            <Check size={16} />
            Save name
          </button>
        </form>
      )}
      {libraryTab === "personal" && !restricted && (
        <div className="library-utilities">
          <button
            className="button text"
            onClick={() => {
              // Server titles go out without the address built from the server.
              const items = personalMedia
                .map((item) =>
                  item.serverId ? { ...item, streams: [] } : item,
                )
                .filter(canPersistContent);
              exportJson("open-tv-library.json", { version: 1, items });
            }}
          >
            <Download size={15} />
            Export personal media
          </button>
          <label className="button text file-input">
            <Upload size={15} />
            Import personal media
            <input
              type="file"
              accept=".json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (file.size > 5000000) {
                  onNotice("Choose a file smaller than 5 MB.");
                  return;
                }
                try {
                  const serialized = await file.text();
                  if (!mounted.current) return;
                  const data = JSON.parse(serialized);
                  const items = validateContent(data.items).map((c) => ({
                    ...c,
                    providerId: "personal-media",
                  }));
                  onItems(
                    {
                      id: "personal-media",
                      name: "Personal media",
                      kind: "library",
                      enabled: true,
                      classification: "general",
                      refreshHours: 0,
                      description: "Your authorized media",
                    },
                    items,
                  );
                  onNotice(
                    `Imported ${items.length} ${items.length === 1 ? "entry" : "entries"}.`,
                  );
                } catch {
                  if (mounted.current)
                    onNotice("That collection could not be imported.");
                }
              }}
            />
          </label>
        </div>
      )}
      {removed && (
        <div className="undo-banner" role="status">
          <span>Removed “{removed.title}” from personal media.</span>
          <button
            className="button text"
            onClick={() => {
              onEdit(removed);
              setRemoved(null);
            }}
          >
            <Undo2 size={16} />
            Undo removal
          </button>
        </div>
      )}
      {libraryTab === "history" && items.length > 0 && (
        <div className="library-bar">
          <span className="muted">{items.length} watched</span>
          {confirming === "history" ? (
            <span className="confirm-inline">
              <button
                className="button danger small"
                onClick={() => {
                  setConfirming(null);
                  onClearHistory();
                }}
              >
                Clear history and progress
              </button>
              <button
                className="button text small"
                onClick={() => setConfirming(null)}
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              className="button text"
              onClick={() => setConfirming("history")}
            >
              <Trash2 size={14} />
              Clear history
            </button>
          )}
        </div>
      )}
      <div className="content-grid">
        {items.slice(0, limit).map((item) => (
          <div className="library-item" key={item.id}>
            {renderCard(item)}
            {libraryTab === "personal" &&
            item.providerId === "personal-media" &&
            !restricted ? (
              <div className="library-item-tools">
                <button
                  className="button text"
                  aria-label={`Edit ${item.title}`}
                  onClick={() => setEditing(item)}
                >
                  <Pencil size={13} />
                  Edit
                </button>
                <button
                  className="icon-button"
                  aria-label={`Remove ${item.title} from personal media`}
                  onClick={() => {
                    onRemove(item.id);
                    setRemoved(item);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : libraryTab === "history" || libraryTab === "continue" ? (
              <button
                className="button text"
                aria-label={`Remove ${item.title} from history`}
                onClick={() => onRemoveHistory(item)}
              >
                <Trash2 size={13} />
                Remove
              </button>
            ) : activeCollection ? (
              <button
                className="button text"
                onClick={() => onCollection(activeCollection.id, item)}
              >
                <Trash2 size={13} />
                Remove from collection
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {!items.length && (
        <div className="empty-state">
          <Library size={34} />
          <h2>
            {activeCollection
              ? "This collection is empty"
              : libraryTab === "history"
                ? "No viewing history"
                : libraryTab === "continue"
                  ? "Nothing to continue"
                  : libraryTab === "wishlist"
                    ? "Your wishlist is empty"
                    : libraryTab === "personal"
                      ? "No personal media"
                      : "Your list is empty"}
          </h2>
          <p>
            {activeCollection
              ? "Add titles from their details page."
              : libraryTab === "history" || libraryTab === "continue"
                ? "Titles you watch will appear here."
                : libraryTab === "wishlist"
                  ? "Add titles you want from their details page. They move to your library when a server has them."
                  : libraryTab === "personal"
                    ? restricted
                      ? "Ask a grown-up to add media from the main profile."
                      : "Add your media in Settings."
                    : "Save titles to find them here."}
          </p>
          <button
            className="button primary"
            onClick={() =>
              navigate(
                libraryTab === "personal" && !restricted
                  ? "settings"
                  : "movies",
              )
            }
          >
            {libraryTab === "personal" && !restricted
              ? "Add media"
              : "Browse movies"}
          </button>
        </div>
      )}
      {items.length > limit && (
        <div className="load-more">
          <button
            className="button secondary"
            onClick={() => setLimit((n) => n + 72)}
          >
            Show more
          </button>
          <span>
            Showing {limit} of {items.length}
          </span>
        </div>
      )}
      {editing && (
        <MediaEditor
          item={editing}
          servers={servers}
          onSave={onEdit}
          onClose={() => setEditing(null)}
          onNotice={onNotice}
        />
      )}
    </>
  );
}
