import type { Content } from "./content";
export interface BrowseView {
  genre: string;
  language: string;
  country: string;
  limit: number;
  guide: boolean;
}
export interface LibraryView {
  tab: string;
  limit: number;
}
export interface MediaDraft {
  title: string;
  description: string;
  type: Content["type"];
  classification: "general" | "adult";
  series: string;
  season: number;
  episode: number;
  serverId?: string;
  providerItemId?: string;
  genres?: string;
  languages?: string;
  countries?: string;
  year?: number;
  runtimeMinutes?: number;
}
export interface FormDrafts {
  media?: MediaDraft;
  playlist?: { name: string; classification: "general" | "adult" };
}
export const emptyBrowse = (): BrowseView => ({
  genre: "",
  language: "",
  country: "",
  limit: 72,
  guide: false,
});
export function libraryTab(value: unknown): string {
  return typeof value === "string" &&
    (["saved", "wishlist", "continue", "history", "personal"].includes(value) ||
      /^collection:ot-[a-z0-9]+$/.test(value))
    ? value
    : "saved";
}
export function gridLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(72, Math.min(1440, Math.round(value / 72) * 72))
    : 72;
}
