# ScrapeBook

ScrapeBook is a lightweight Facebook post browsing and scraping automation tool built as a Manifest V3 browser extension.

## Install locally

1. Open the browser's extensions page.
2. Enable developer mode.
3. Choose **Load unpacked** and select this folder.
4. Open a Facebook feed, then click the ScrapeBook extension icon to open the side panel.

## Current scope

The current version performs a focused extraction loop: find visible feed posts, open each post, switch to All comments, expand replies, scroll comments, extract post and comment data, and continue to the next post. The side panel displays the live phase, processed post count against the configured maximum (`X / Max`), and activity logs persistently while browsing.

Users can customize the **Max posts to scrape** directly from the side panel (set `0` for unlimited). The scraper uses signature-based deduplication and persistent state, enabling users to stop at any time, leave the page, and return later to seamlessly click **Resume scanner** without duplicate entries or index mismatches.

The content script keeps browser actions, state, and logging separate from extraction and export modules so JSON and TXT exports are always available on demand.

Facebook's DOM and labels can change over time. The current implementation uses adaptive selectors and polling with fallback strategies for post triggers and comment filters.