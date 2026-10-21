import { describe, expect, it } from "vitest";
import site from "../site.config.json";
import { SITE_URL, SITE_ORIGIN, appAsset, siteUrl } from "../src/config/site";
import { releaseUrl } from "../src/config/updates";
describe("site configuration", () => {
  it("is the single source for the public address", () => {
    expect(SITE_URL).toBe(site.url);
    expect(SITE_URL.endsWith("/")).toBe(true);
    expect(SITE_ORIGIN).toBe(new URL(site.url).origin);
    expect(siteUrl("/catalog/update-manifest.json")).toBe(
      new URL("catalog/update-manifest.json", site.url).href,
    );
    expect(siteUrl()).toBe(site.url);
  });
  it("does not use a pages.dev address", () => {
    expect(JSON.stringify(site)).not.toContain("pages.dev");
  });
  it("resolves bundled files against the base path", () => {
    expect(appAsset("/catalog/open-cinema.json")).toBe(
      "/catalog/open-cinema.json",
    );
    expect(appAsset("artwork/x.webp")).toBe("/artwork/x.webp");
  });
});
describe("catalog release URLs", () => {
  const path = "/catalog/releases/open-cinema-abc.json";
  it("sit beside the manifest under any sub-path", () => {
    expect(
      releaseUrl(
        path,
        "https://builtbysai.com/open-tv/catalog/update-manifest.json",
      ),
    ).toBe(
      "https://builtbysai.com/open-tv/catalog/releases/open-cinema-abc.json",
    );
    expect(
      releaseUrl(path, "https://example.com/catalog/update-manifest.json"),
    ).toBe("https://example.com/catalog/releases/open-cinema-abc.json");
  });
});
