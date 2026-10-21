# Content reporting and copyright notices

The footer and title details link to **Content reports & copyright** (`/#/legal`).
It remains accessible before age admission. A configured public listing report can
identify a general catalog item/source and reason without prefilling a video URL,
credentials, personal contact details or private viewing. Restricted/personal
references cannot be sent through that public shortcut.

Formal notices use a separate form that checks the required identification,
contact, good-faith/authority statements and signature. It creates a JSON file on
the user's device only when they choose **Download private notice**. It does not
submit the notice. Fields are not autosaved or included in public issue links.
On Android, the system document picker saves the file. The downloaded notice
contains personal information and should be sent privately.

## Operator setup required

Set a **monitored public contact** in `site.config.json` (`"takedownEmail"`), or with the
build variable below, then rebuild:

```properties
VITE_TAKEDOWN_EMAIL=your-monitored-copyright-contact@example.org
VITE_PUBLIC_REPORT_URL=https://your-public-report-form.example.org/
```

The example address is a placeholder, not an Open TV contact. Until the operator
supplies an address, the UI explicitly says private notice submission is not
available. Without a public report endpoint the report page offers the repository's
public issue form and a "Copy report details" button. Configure a monitored public HTTPS
report endpoint and/or contact before a public deployment; nothing is submitted
automatically. A custom endpoint receives only
validated content/source IDs and the selected reason as query parameters.
No mailbox, designated agent or service-provider registration has been invented.

Publishing a DMCA page does not grant immunity. The US Copyright Office describes
different section 512 safe harbors, including information-location tools, and
conditions such as a designated agent, expeditious action and a reasonably
implemented repeat-infringer policy. Counsel should assess the actual service,
jurisdiction and conduct; operating a directory does not establish eligibility.

## Review and enforce a report

1. Receive the report or notice through its appropriate channel. Keep personal
   information, source credentials and private correspondence out of public git.
2. Identify the specific listing, alternatives, source, ownership claim and exact
   Open TV location. Distinguish external hosting from Open TV's own listing.
3. For an approved restriction, edit `src/policy/restrictions.json`: block canonical
   content/alias IDs, a provider ID, and/or `stableId(stream.url)` identifiers.
   The policy never needs credential-bearing URLs or complainant details.
4. Run `npm run updates:prepare`, review/commit the release metadata, and publish
   the new static update files. Preview 0.5 can refresh rules without an APK rebuild;
   older previews still need rebuilding. See [update activation/trust](UPDATES.md).
   The query boundary filters blocked records
   from Home, search, library, recommendations, shuffle and restoration. Playback
   rechecks policy and removes blocked alternatives. Exhausted alternatives cannot
   fall through to an external link. Catalog/library originals are not silently
   erased from user storage.
5. If a publicly distributed file itself requires removal, update that file and
   deployment explicitly; client-side delisting cannot erase an upstream file,
   cached APK, prior git version or third-party host. Record exactly which sources
   were changed and why, without publishing personal notice data.
6. Acknowledge/action notices appropriately; assess counter-notices and any
   restoration with human/legal review. Do not automatically publish counter-notices
   or restore disputed material. Escalate repeated substantiated provider misuse
   for source-level restrictions/removal.

The initial restriction list is empty: this feature removes no sources. There is
no automated notice adjudication, guaranteed response time or legal immunity claim.
Monitoring and legal decisions remain operator responsibilities.

Primary references: [US Copyright Office section 512](https://www.copyright.gov/512/),
[designated agent directory/registration](https://www.copyright.gov/dmca-directory/),
[17 USC 512](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title17-section512&num=0&edition=prelim).
