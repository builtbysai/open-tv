# Deploy and verify the site

The site is published at the address in [`site.config.json`](../site.config.json)
(currently <https://tv.builtbysai.com/>). It is a static build served from the root of
that domain by Cloudflare, which applies `public/_headers` (the content security policy,
`nosniff`, long-lived asset caching).

## Change the site name or address

Edit `site.config.json`:

```json
{ "name": "Open TV", "url": "https://tv.builtbysai.com/" }
```

That one file drives the web app manifest, page titles, the wordmark, the TV app's
update endpoint, the phone setup link and `verify:deployment`. `VITE_SITE_URL`
overrides the address at build time. A root address needs nothing else; an address with a
path (such as `https://example.com/tv/`) needs `npm run build:site`, which sets the base
path.

## Publish

```sh
npm ci
npm run check
```

Cloudflare Pages settings: build command `npm run build`, output directory `dist`,
production branch `main`. Every push to `main` then deploys, and every other branch gets a
preview address. Merge to publish.

To serve from a sub-path instead, set the address in `site.config.json` and run
`npm run build:site`, which writes the build with that base path to `dist-site`.

The distribution is the full viewer. For a public deployment that must not expose
restricted viewing, build with `VITE_PRIVATE_VIEWING=disabled`; this removes the 18+
switch, so 18+ lists in an extension cannot be connected. See the [age-assurance checklist](AGE_ASSURANCE.md).

## Verify

```sh
npm run verify:deployment            # checks the address in site.config.json
npm run verify:deployment -- https://example.com/tv/
```

The read-only script checks the compiled viewer, its content security policy, the hashed
script, a valid versioned update manifest with public CORS, the small snapshot's SHA-256
and size, and that the bundled playlists resolve. It prints JSON and exits nonzero
on a failed check, including an HTML page standing in for the manifest.

## Hosting notes

- Cloudflare applies `public/_headers`. Hosts that cannot send headers (GitHub Pages) use
  the same content security policy from the meta tag embedded at build time; only
  `frame-ancestors`, `nosniff` and the long cache headers are lost there.
- Hash routing needs no server rewrites.
- The Google TV app has the address baked in. Rebuild and reinstall it after changing
  `site.config.json`; until then it keeps reading updates from the old address.

This is a deployment smoke check, not proof of stream rights, all codecs, legal readiness
or a physical onn installation. See [Google TV](GOOGLE_TV.md).
