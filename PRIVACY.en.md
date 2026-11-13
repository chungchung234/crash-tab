# Privacy Policy — crash-tab

Last updated: 2026-11-12 · Applies to version 2.0.0 and later · [한국어](PRIVACY.md)

## Summary

This extension **sends no data to any server.** It has no analytics, no advertising identifiers and no
accounts. Everything it stores lives in the browser's extension storage (`chrome.storage`). Some
settings are **synced across your devices through your Google account if Chrome Sync is on** (the
browser does this, not the extension).

## How to verify there is no network traffic

The extension does not use `fetch`, `XMLHttpRequest`, `sendBeacon` or `WebSocket`, and calls no external
address. The full source is public: <https://github.com/chungchung234/crash-tab>.
`manifest.json` has no `host_permissions` and no `content_scripts`. The extension injects code only into
a tab where you click the toolbar icon.

## What is stored

| Storage | Contents | Leaves the device? |
|---|---|---|
| `chrome.storage.sync` | Settings and display options: weapon, loadout, mute, mode, debris, weapon art | **Synced via your Google account if Chrome Sync is on.** The browser does it, not the extension |
| `chrome.storage.local` | Lifetime statistics, replays (up to 10), custom weapons (up to 10), progress and unlocks, help-seen flags | No |
| `chrome.storage.session` | The screenshot taken by the share feature | No. Cleared when the browser closes |

With Chrome Sync off, values written to `sync` stay on this device only.

### Visited-origin record (off by default)

The statistics can include a list of **origins** of sites you used the extension on, for example
`https://example.com`. Per origin it keeps the best score, number of items broken, play count and last
played time, up to 200 origins. It does not store paths, query strings, page titles or page content. The
statistics table on the options page shows this list.

- **Off by default.** Nothing is recorded until you turn it on.
- Toggle: Options page, Advanced, **"Per-site records on this device"** (`collectOriginStats`, Korean UI
  label: "기기 안 출처 기록"). It is **off by default.** The separate "Collect on-device stats" setting
  directly above it covers totals only (elements broken, damage, time played) and **never records which
  site you were on**; per-site records accrue only when the second setting is on.
- Turning it off stops new records. It does **not** erase what is already stored — switching a setting off
  should not mean deleting data. Use the reset below to erase it.
- Turning it off stops new records. Existing records stay until you use **Reset statistics** on the options page.
- Uninstalling the extension removes all of its storage from the browser.

### Screen capture (share feature)

The visible area of the current tab is captured once, only when you press `P` to share. It is never
captured otherwise. The image plus title, site name and score go into `storage.session`, where the share
tab reads them, and disappear when the browser closes. Nothing is uploaded. Saving or copying the image is
your action. The capture contains everything visible at that moment, so do not share from sensitive screens.

### Replays

A replay holds click and hit coordinates, weapon ids, viewport size, the start time, and **which page it was
recorded on** — the origin and path (`https://example.com/a/b`), the page title and the element count. That
last part exists so a bug report can actually be reproduced (SPEC-launch §6).

**Query strings and fragments are not stored**, because session tokens and invite codes live there. Page
content and selectors are not stored either.

It is written to `storage.local` or exported as a file only when you save or export it from the options page.
**If you give the file to someone, all of the above goes with it** — they will see which site and path you
were on and what the page was called. Know that before you export.

## Why each permission is needed

| Permission | Reason |
|---|---|
| `activeTab` | Turns the extension on in the tab where you click the icon, and captures that tab for sharing. Other tabs are not read |
| `scripting` | Injects the extension code into that tab |
| `storage` | Stores the settings, statistics and capture above |

## What is not collected

Analytics or telemetry, advertising identifiers, accounts or sign-in, email or name, page content (text,
form input, cookies). Data is not sold or passed to third parties. There is nowhere to send it.

## Contact

Open a [GitHub issue](https://github.com/chungchung234/crash-tab/issues). For security problems follow
[SECURITY.md](SECURITY.md). When this document changes, the last-updated date is updated and the change is
recorded in [CHANGELOG.md](CHANGELOG.md).
