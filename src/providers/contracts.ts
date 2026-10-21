import type { Content, Source } from "../domain/content";
export interface ContentProvider {
  source: Source;
  load(signal?: AbortSignal): Promise<Content[]>;
}
// Account adapters can resolve a series without downloading every episode at startup.
export interface EpisodicProvider extends ContentProvider {
  loadEpisodes(series: Content, signal?: AbortSignal): Promise<Content[]>;
  dispose(): void;
}
export interface PlaylistParser {
  parse(text: string, source: Source): Content[];
}
export interface MetadataProvider {
  lookup(
    title: string,
    type: Content["type"],
    signal?: AbortSignal,
  ): Promise<Partial<Content> | null>;
}
export interface GuideProgram {
  channelId: string;
  title: string;
  start: number;
  end: number;
  description?: string;
}
