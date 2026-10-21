import { stableId, type Content } from "../domain/content";
import {
  contentAliases,
  hasFavorite,
  type UserState,
} from "../persistence/user-state";

interface Inputs {
  setUser(update: (old: UserState) => UserState): void;
  setNotice(message: string): void;
}
// Saved and named collections. 18+ titles are kept like any other and hidden while 18+ is.
export function useLibraryActions({ setUser, setNotice }: Inputs) {
  const toggleFavorite = (item: Content) => {
    const aliases = contentAliases(item);
    setUser((old) => ({
      ...old,
      favorites: hasFavorite(old, item)
        ? old.favorites.filter((id) => !aliases.includes(id))
        : [...old.favorites, item.id],
    }));
  };
  const toggleCollection = (collectionId: string, item: Content) => {
    const aliases = contentAliases(item);
    setUser((old) => ({
      ...old,
      collections: old.collections.map((c) =>
        c.id === collectionId
          ? {
              ...c,
              itemIds: c.itemIds.some((id) => aliases.includes(id))
                ? c.itemIds.filter((id) => !aliases.includes(id))
                : [...c.itemIds, item.id],
            }
          : c,
      ),
    }));
  };
  const validCollectionName = (name: string) => {
    const value = name.trim().slice(0, 80);
    if (!value) {
      setNotice("Give the collection a name.");
      return null;
    }
    return value;
  };
  const createCollection = (name: string) => {
    const value = validCollectionName(name);
    if (!value) return null;
    const id = stableId(`collection:${crypto.randomUUID()}`);
    setUser((old) => ({
      ...old,
      collections: [...old.collections, { id, name: value, itemIds: [] }],
    }));
    return id;
  };
  const renameCollection = (id: string, name: string) => {
    const value = validCollectionName(name);
    if (value)
      setUser((old) => ({
        ...old,
        collections: old.collections.map((c) =>
          c.id === id ? { ...c, name: value } : c,
        ),
      }));
  };
  const deleteCollection = (id: string) => {
    setUser((old) => ({
      ...old,
      collections: old.collections.filter((c) => c.id !== id),
    }));
  };
  return {
    toggleFavorite,
    toggleCollection,
    createCollection,
    renameCollection,
    deleteCollection,
  };
}
