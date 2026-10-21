import { writeFile, rename } from "node:fs/promises";
import { stableId, type Content } from "../src/domain/content";
import { fetchJson } from "./network";
// Reviewed works only: upstream discovery results must never automatically imply rights.
const films = [
  {
    title: "Big Buck Bunny",
    archive: "BigBuckBunny_328",
    file: "BigBuckBunny_512kb.mp4",
    slug: "big-buck-bunny",
    image: "bbb",
    year: 2008,
    duration: 596,
    description:
      "A rabbit takes on three forest animals after they ruin his peaceful afternoon.",
    genres: ["Animation", "Comedy"],
  },
  {
    title: "Sintel",
    archive: "Sintel",
    file: "sintel-2048-stereo_512kb.mp4",
    slug: "sintel",
    image: "sintel",
    year: 2010,
    duration: 888,
    description: "A young traveler searches for the dragon she once rescued.",
    genres: ["Animation", "Fantasy"],
  },
  {
    title: "Elephants Dream",
    archive: "ElephantsDream",
    file: "ed_1024_512kb.mp4",
    slug: "elephants-dream",
    image: "elephants",
    year: 2006,
    duration: 654,
    description:
      "Two men explore a mechanical world and disagree about what they see.",
    genres: ["Animation", "Science fiction"],
  },
  {
    title: "Tears of Steel",
    archive: "Tears-of-Steel",
    file: "",
    slug: "tears-of-steel",
    image: "tears",
    year: 2012,
    duration: 734,
    description: "A team in a future Amsterdam tries to stop a robot uprising.",
    genres: ["Science fiction", "Independent"],
  },
];
const items: Content[] = [];
for (const film of films) {
  const metadata = await fetchJson<{
    metadata: { licenseurl?: string };
    files: { name: string; format?: string }[];
  }>(`https://archive.org/metadata/${film.archive}`);
  const license = metadata.metadata.licenseurl || "";
  if (
    !/^https?:\/\/creativecommons.org\/licenses\/by\/3.0(?:\/|$)/.test(license)
  )
    throw new Error(
      `Reviewed license missing for ${film.title}. Previous cinema catalog retained.`,
    );
  const file =
    film.file ||
    metadata.files.find((f) => /\.mp4$/i.test(f.name) && /512kb/i.test(f.name))
      ?.name ||
    metadata.files.find((f) => /\.mp4$/i.test(f.name))?.name;
  const url = file
    ? `https://archive.org/download/${film.archive}/${encodeURIComponent(file)}`
    : undefined;
  let reachable = false;
  if (url) {
    try {
      const r = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(15000),
      });
      reachable = r.ok && /video\//.test(r.headers.get("content-type") || "");
    } catch {
      /* Clearly distinguish unavailable playable media. */
    }
  }
  items.push({
    id: stableId(`blender:${film.slug}`),
    providerId: "open-cinema",
    title: film.title,
    type: "movie",
    description: film.description,
    artwork: `/artwork/${film.image}.webp`,
    backdrop: `/artwork/${film.image}.webp`,
    year: film.year,
    duration: film.duration,
    genres: film.genres,
    languages: film.slug === "big-buck-bunny" ? ["No dialogue"] : ["English"],
    countries: ["Netherlands"],
    classification: "general",
    availability: reachable ? "playable" : "external",
    streams:
      reachable && url
        ? [
            {
              url,
              format: "video",
              health: "reachable",
              checkedAt: new Date().toISOString(),
            },
          ]
        : [],
    externalUrl: `https://studio.blender.org/films/${film.slug}/`,
    rights: {
      status: "open-license",
      license: "CC BY 3.0",
      attribution: `${film.title} © Blender Foundation · CC BY 3.0. Artwork resized; film unchanged.`,
      url: `https://studio.blender.org/films/${film.slug}/`,
    },
  });
}
await writeFile(
  "public/catalog/open-cinema.json.tmp",
  JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), items }),
);
await rename(
  "public/catalog/open-cinema.json.tmp",
  "public/catalog/open-cinema.json",
);
console.log(
  `Cinema: ${items.filter((i) => i.availability === "playable").length} verified reachable films, ${items.filter((i) => i.availability === "external").length} external watch options. No old sources modified.`,
);
