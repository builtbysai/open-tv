# Age admission and restricted-content privacy

18+ content is hidden by default. There is no entry screen; the site works normally
and anything adult or flagged by the content rules stays out of every list, search and
recommendation.

To show it, open Settings → Privacy and choose Show 18+ content. The first time on a
device you confirm you are 18 or older and permitted to view adult material where you
are; the confirmation is remembered on that device (and can be removed in the same
place). After that, showing 18+ content is one click, and the choice is remembered on the device
until you press Hide. An optional device PIN can protect the switch.

Showing 18+ only adds 18+ sources and titles. The catalog, guide, servers, library and
saved state are the same in both states: search totals only grow when it is on, and
hiding it re-hides the 18+ layer and changes nothing else. History, favorites and
progress are saved as usual; 18+ entries in them are hidden while 18+ is. An 18+ title
that is open or playing closes when 18+ is hidden. 18+ titles are never looked up on
TMDB, and are kept off the system media controls, picture-in-picture and casting.

Only the confirmation timestamp is stored. No date of birth, identity document, face
image or age-estimation data is collected. The reporting page needs no confirmation.

## Configuration

```properties
# local allows the Privacy switch. disabled builds without the 18+ switch or any 18+ lists.
VITE_PRIVATE_VIEWING=local
```

With `disabled`, 18+ viewing is unavailable and 18+ lists in an extension cannot be
connected. Moving a public deployment to general-only also means retiring older deployments
and APKs: rebuilding does not invalidate third-party copies.

## A declaration is not verified age

Ofcom explicitly rejects self-declaration as highly effective age assurance.
Local PINs and a static app can be modified by a device owner. They are useful
shared-device boundaries, not proof of age or universal legal compliance.
The default preview is not a regulated adult-service production release.

For a public restricted-content release where stronger assurance is required:

- Choose a legally appropriate verification/estimation provider or credential
  issuer after reviewing jurisdiction, accuracy, accessibility, privacy and costs.
- Verify signed, short-lived issuer evidence at a server/gateway, including issuer,
  audience, expiry, nonce/replay protection and the required age threshold. A query
  flag, client callback, unsigned JSON or localStorage flag is not evidence.
- Protect restricted catalogs, artwork and media behind that gateway. A gate in
  front of an otherwise public adult playlist does not protect the playlist.
- Keep ID images and birth dates out of Open TV; retain only the necessary
  assertion and minimal audit/expiry state under a reviewed retention policy.
- Revoke/expire access across refresh, background, accounts and profiles; verify
  every restricted query/play path. Keep a general-only fallback.

No third-party verification vendor, billing account or fake verifier was added.
Until that infrastructure and legal review exist, use the general-only build for
deployments that require stronger assurance rather than presenting declarations
as verified age.

Android additionally uses a secure window for private mode, clears app-owned
system media metadata, hides private content on background, and restores the view
only after the viewer has locked. Native behavior still needs the physical onn
checklist; system/firmware screenshots and transport behavior vary.

Primary references: [Ofcom age-assurance guidance](https://www.ofcom.org.uk/online-safety/protecting-children/age-assurance),
[highly effective age-assurance FAQ](https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/enforcement/highly-effective-age-assurance--frequently-asked-questions-faq.pdf),
[Android secure windows](https://developer.android.com/security/fraud-prevention/activities).
