# Catalog and restriction updates

Public data can be updated without reinstalling the app or the TV APK. Only a small
manifest and JSON snapshots are downloaded, never application code or video. Any static
host can serve them; no Worker, database or billing account is needed.

## Activation

Publish the site by merging to `main` (see [deployment](DEPLOYMENT_CHECKS.md)). Until
the manifest and snapshots are published, the APK keeps its bundled catalogs. Run
`npm run verify:deployment` to check the manifest, its CORS headers and the snapshots, and
to reject an HTML fallback served in place of the manifest.

The web viewer checks its own origin. Android's bundled `appassets` viewer checks the
`catalog/update-manifest.json` under the address in `site.config.json`. For another
operator-controlled publisher, configure the public build setting and rebuild:

```properties
VITE_CATALOG_UPDATE_URL=https://your-authorized-site.example/catalog/update-manifest.json
# Use disabled to ship a build without remote updates.
```

Only HTTPS endpoints are accepted, except loopback HTTP for local development.
Credentials, query strings and fragments are forbidden. Cross-origin publishers
must supply the public CORS/cache headers included in `public/_headers`. Never
point this setting at a random CORS proxy or a provider account endpoint.

App code and new provider capabilities still require a new APK.

## Publish a reviewed update

1. Review rights, eligibility, classifications and the intended policy change.
   Edit the public catalog (`npm run catalog:sync` refreshes the reviewed films), or edit
   `src/policy/restrictions.json` for a substantiated restriction/restoration.
2. Run `npm run updates:prepare`. It records a monotonic revision and the catalog
   hashes in `src/updates/release.json`. Unchanged inputs do not bump the revision.
   `catalog:sync` already runs this step.
3. Review/commit the changed inputs and release metadata. Run `npm run check`.
   A build refuses stale metadata instead of silently reusing a revision.
4. Deploy the generated static output. Test the manifest MIME, CORS and cache
   headers, then **Settings → Check catalog updates** on the target device.

The same revision cannot publish different policy/catalog descriptors. After a
deployment rollback, publish reviewed known-good data under a **higher revision**;
clients retain their last accepted policy instead of accepting a lower counter.

Build output includes:

```text
catalog/update-manifest.json
```

The plain `/catalog/*.json` and `/playlists/*.m3u` URLs stay available. Immutable
snapshots are generated into `dist`, not stored in git. Android excludes the extra
release copies and keeps its bundled catalogs.

## Trust and failure behavior

- The publisher is trusted through its configured HTTPS origin. Requests omit
  cookies, authorization, referrers and viewing data; redirects are rejected.
  Normal networking still reveals an IP address and browser request information.
- Version 1 supports exactly the bundled public catalogs (`open-cinema`). It cannot add a
  provider, executable code, adult catalog, arbitrary URL or account connection.
  Breaking schema changes need a separately versioned endpoint and client release.
- The manifest is limited to 1 MB and an eight-second request deadline. Catalogs
  are limited to 15 MB, fixed hash-named paths on the publisher origin, and must
  match both their declared UTF-8 byte count and SHA-256 digest before parsing.
  Public updates exclude restricted/uncertain, foreign-provider and server-linked
  records. A correct hash does not establish licensing or working playback.
- These are integrity hashes, **not independent digital publisher signatures**.
  A compromised publisher can issue a higher revision. Operator/domain security
  and human notice adjudication remain necessary.
- Catalogs download only when their digest changes or a missing cache needs
  recovery. A policy-only update does not redownload unchanged catalogs. One
  replaceable downloaded cache entry per public catalog bounds revision growth.
- Failed/corrupt downloads use the last accepted cached catalog or bundled
  source. Failed updates can be retried on a later manifest check. A cache clear
  never clears the separately saved restriction policy.
- Accepted policy applies before queries, restores, episode results and playback.
  Newly blocked playback or stream alternatives stop and release the player;
  blocked details close.

Automatic manifest checks run at most once per 30 minutes while foreground/general
viewing is active, with exponential failure backoff from one minute to six hours.
Manual checks are limited to once per 15 seconds. Backgrounding pauses checks; native resume restarts checks without starting audio. Already-started
catalog loads retain their existing bounded cancellation/timeout behavior.
Cached updates are isolated by endpoint and compared with the compiled revision.
Deleting or damaging a cache cannot clear an active in-memory restriction.

This is client-side delisting, not revocation of upstream media, original source
files, historical APKs or old git versions. Formal notices still require a
monitored contact and operator action; see [the takedown guide](TAKEDOWN.md).

## Validation

Focused tests cover schema/endpoint limits, monotonic publishing, conflicting and
older revisions, cached policies, backoff/coalescing, storage errors, cancellation,
cross-tab policy changes, UTF-8 integrity, scoped caches and fallback.
Browser workflows use an Android asset origin, a controlled HTTPS publisher and
generated HLS media to check one-time downloads, offline reload, active playback
revocation, cache-clear policy retention, private/native suspend/resume, corruption
recovery. Native navigation maps the root URL back to
bundled `index.html`; cold starts restore the saved general screen. Physical onn
firmware and actual deployed response headers still need device/release checks.
