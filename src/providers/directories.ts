import type { Source } from "../domain/content";
import { AppError } from "../domain/errors";
import { ArchiveProvider } from "./archive";
import type { ContentProvider } from "./contracts";
import { RadioBrowserProvider } from "./radio";
import { SomaFmProvider } from "./somafm";
import { NasaProvider } from "./nasa";
// A directory source is a public API queried when it loads, such as the Internet
// Archive or Radio Browser, rather than a playlist file.
export function directoryProvider(source: Source): ContentProvider {
  const config = source.directory;
  if (config?.provider === "archive")
    return new ArchiveProvider({
      id: source.id,
      name: source.name,
      collection: config.collection,
      mediatype: config.mediatype,
      subject: config.subject,
    });
  if (config?.provider === "radio")
    return new RadioBrowserProvider({
      id: source.id,
      name: source.name,
      tag: config.tag,
      country: config.country,
    });
  if (config?.provider === "somafm")
    return new SomaFmProvider(source.id, source.name);
  if (config?.provider === "nasa")
    return new NasaProvider({
      id: source.id,
      name: source.name,
      query: config.query,
    });
  throw new AppError("format", "This source type is not supported.");
}
