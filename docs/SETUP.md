# Setting up a device

Everything stays on the device. Four ways to bring things in, and what each carries:

| Way                                 | Carries                                                               | Use it for                                 |
| ----------------------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| **Phone by QR** (welcome, Settings) | Playlists, servers, music instances, TMDB key, an account, a profile  | Setting up a TV without typing             |
| **Backup file** (Settings → Backup) | Your playlists, servers, music instances and profile                  | Moving your own setup between devices      |
| **Extension file or address**       | Lists and catalogs, 18+ lists, music instances, servers, key, profile | Distributing a whole setup, including data |
| **By hand** in Settings             | Anything                                                              | One-off changes                            |

## First run

The welcome offers the phone code, an extension file or address, and entering things by
hand. It is shown once, on a device with nothing set up, and is skipped for Kids profiles.
After it, a slim reminder in Settings lists what is still missing.

## What an extension adds to a backup

A backup restores _your_ choices. An extension can also carry the lists themselves
(including 18+ lists, which stay hidden until 18+ content is turned on) and keeps them
current when loaded from an address. Both can be used together: import the extension for the
lists, restore a backup for your favorites and history.

Order of precedence when the same thing arrives twice: built-in sources win over extension
sources of the same id; an entry already on the device is not duplicated; a later import of
the same extension updates its sources in place.

Check a file with `npm run extension:check -- file.json`.

See [extensions](EXTENSIONS.md), [phone transfer](TRANSFER.md) and [music](MUSIC.md).
