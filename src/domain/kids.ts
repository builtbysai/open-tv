import type { Content } from "./content";
// A Kids profile is a focused view, not parental control: it shows titles tagged for
// children and hides 18+ content, Settings and sources.
const kidsGenre =
  /\b(kids?|children|family|animation|animated|cartoons?|educational?)\b/i;
export const isKidsGenres = (genres: string[]) =>
  genres.some((genre) => kidsGenre.test(genre));
export const isKidsSafe = (item: Pick<Content, "genres" | "classification">) =>
  item.classification === "general" && isKidsGenres(item.genres);
// A Kids profile cannot open Settings, so its empty screens point to the main profile.
export const ASK_MAIN_PROFILE =
  "Ask a grown-up to add sources from the main profile.";
