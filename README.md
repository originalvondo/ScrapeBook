# ScrapeBook

ScrapeBook is a lightweight Facebook post browsing and scraping automation tool built as a Manifest V3 browser extension.

## Install locally

1. Open the browser's extensions page.
2. Enable developer mode.
3. Choose **Load unpacked** and select this folder.
4. Open a Facebook feed, then click the ScrapeBook extension icon to open the side panel.

## Current scope

The current version performs one focused loop: find visible feed posts, open each post, scroll its comment dialog, close it, and continue to the next post. The side panel displays the live phase, processed post count, and activity logs persistently while browsing.

The content script keeps browser actions, state, and logging separate from future extraction and export modules so post data collection, comment extraction, reply expansion, and JSON/TXT export can be added without redesigning the panel.

Facebook's DOM and labels can change over time. The current implementation intentionally uses conservative role, link, and aria-label selectors and skips posts that do not expose an openable trigger.