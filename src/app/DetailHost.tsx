import type { ComponentProps } from "react";
import { Detail } from "../components/Detail";
import { isAudio, type Content, type Source } from "../domain/content";
import { seedFromContent } from "../domain/embed-library";
import {
  hasFavorite,
  progressFor,
  type UserState,
} from "../persistence/user-state";

type DetailProps = ComponentProps<typeof Detail>;
const wishKey = (item: Content) =>
  `${item.type === "series" ? "series" : "movie"}:${item.tmdbId}`;

// Opens a title's details and wires them to the viewer's state: what is saved, what can
// be queued or wished for, which episodes to list and where they come from.
export function DetailHost({
  selected,
  permitted,
  user,
  sources,
  visible,
  visibleByAlias,
  similar,
  resume,
  watch,
  resolveUrl,
  loadLibraryEpisodes,
  allowedEpisodes,
  card,
  onQueue,
  onWishlist,
  onReport,
  onClose,
  onPlay,
  onFavorite,
  onCollection,
  onSelect,
  onSearchSources,
  onPlayOnTv,
  tvName,
  tvs,
}: {
  selected: Content;
  permitted: Content;
  user: UserState;
  sources: Pick<Source, "id" | "name" | "kind">[];
  visible: Content[];
  visibleByAlias: Map<string, Content>;
  similar: Content[];
  resume?: Content;
  watch: DetailProps["watch"];
  resolveUrl: DetailProps["resolveUrl"];
  loadLibraryEpisodes: DetailProps["onLoadEpisodes"];
  allowedEpisodes: DetailProps["onLoadEpisodes"];
  card: DetailProps["renderCard"];
  onQueue(item: Content): void;
  onWishlist(item: Content): void;
  onReport(item: Content): void;
  onClose(): void;
  onPlay(item: Content): void;
  onPlayOnTv?(item: Content, tvId?: string): void;
  tvName?: string;
  tvs?: { id: string; name: string }[];
  onFavorite(item: Content): void;
  onCollection: NonNullable<DetailProps["onCollection"]>;
  onSelect(item: Content): Promise<void> | void;
  onSearchSources(text: string): void;
}) {
  const isSeries = selected.type === "series";
  const seriesId = isSeries ? selected.id : selected.seriesId;
  return (
    <Detail
      onPlayOnTv={onPlayOnTv}
      tvName={tvName}
      tvs={tvs}
      item={permitted}
      sourceName={sources.find((s) => s.id === selected.providerId)?.name}
      favorite={hasFavorite(user, selected)}
      resolveUrl={resolveUrl}
      watch={watch}
      wished={user.wishlist.some(
        (w) =>
          `${w.kind === "series" ? "series" : "movie"}:${w.tmdbId}` ===
          wishKey(selected),
      )}
      onQueue={
        isAudio(selected) && selected.availability === "playable"
          ? () => onQueue(selected)
          : undefined
      }
      onWishlist={
        !seedFromContent(selected) ? undefined : () => onWishlist(selected)
      }
      onReport={() => onReport(selected)}
      onClose={onClose}
      onPlay={onPlay}
      onFavorite={onFavorite}
      collections={user.collections}
      onCollection={onCollection}
      parent={
        selected.seriesId ? visibleByAlias.get(selected.seriesId) : undefined
      }
      progress={(item) => progressFor(user, item)}
      onLoadEpisodes={
        isSeries && selected.providerId === "embed-library"
          ? loadLibraryEpisodes
          : isSeries &&
              sources.some(
                (s) => s.id === selected.providerId && s.kind === "xtream",
              )
            ? allowedEpisodes
            : undefined
      }
      related={
        seriesId
          ? visible
              .filter((c) => c.seriesId === seriesId)
              .sort(
                (a, b) =>
                  (a.season ?? 1) - (b.season ?? 1) ||
                  (a.episode || 1) - (b.episode || 1),
              )
          : []
      }
      resume={resume}
      similar={similar}
      renderCard={card}
      onSearchSources={onSearchSources}
      onSelect={(c) => void onSelect(c)}
    />
  );
}
