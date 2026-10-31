import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __RELAY_URL__: JSON.stringify(""),
    __TMDB_BASE__: JSON.stringify("https://api.themoviedb.org/3"),
    __TMDB_IMAGE_BASE__: JSON.stringify("https://image.tmdb.org/t/p"),
    __SITE_URL__: JSON.stringify("https://tv.example.com/"),
    __APP_VERSION__: JSON.stringify("test"),
    __BUILD_ID__: JSON.stringify("test"),
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
