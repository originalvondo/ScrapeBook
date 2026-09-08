(() => {
  if (window.__scrapebookContentScriptLoaded) return;
  window.__scrapebookContentScriptLoaded = true;

  const STATUS_KEY = 'scrapebookStatus';
  const SCRAPED_POSTS_KEY = 'scrapebookPosts';

  const POST_LINK_STRUCTURAL_SELECTOR =
    'span > div > span > span > span > a[role="link"], span > div > span:nth-child(1) > span > span > a';

  const POST_LINK_SELECTOR =
    'a.x1i10hfl.xjbqb8w.x1ejq31n.x18oe1m7.x1sy0etr.xstzfhl.x972fbf.x10w94by.x1qhh985.x14e42zd.x9f619.x1ypdohk.xt0psk2.x3ct3a4.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x16tdsg8.x1hl2dhg.xggy1nq.x1a2a7pz.xkrqix3.x1sur9pj.xi81zsa.x1s688f[role="link"]';

  const POST_DIALOG_SELECTOR = '[role="dialog"]';

  const POST_SCROLLABLE_SECTION_SELECTOR =
    'div.xb57i2i.x1q594ok.x5lxg6s.x78zum5.xdt5ytf.x6ikm8r.x1ja2u2z.x1pq812k.x1rohswg.xfk6m8.x1yqm8si.xjx87ck.xx8ngbg.xwo3gff.x1n2onr6.x1oyok0e.x1odjw0f.x1iyjqo2.xy5w88m';

  const REPLIES_BUTTON_SELECTOR =
    '.x1i10hfl.xjbqb8w.xjqpnuy.xc5r6h4.xqeqjp1.x1phubyo.x13fuv20.x18b5jzi.x1q0q8m5.x1t7ytsu.x972fbf.x10w94by.x1qhh985.x14e42zd.x9f619.x1ypdohk.xdl72j9.x3ct3a4.xdj266r.x14z9mp.xat24cr.x1lziwak.x2lwn1j.xeuugli.xexx8yu.x18d9i69.x1c1uobl.x1n2onr6.x16tdsg8.x1hl2dhg.xggy1nq.x1ja2u2z.x1t137rt.x1fmog5m.xu25z0z.x140muxe.xo1y3bh.x3nfvp2.x87ps6o.x1lku1pv.x1a2a7pz.x6s0dn4.xi81zsa.x1q0g3np.x1iyjqo2.xs83m0k.x1icxu4v';

  const COMMENT_DIV_SELECTOR = 'div.x1nn3v0j.x1120s5i.x135b78x.x11lfxj5';

  const seenUrls = new Set();
  let collectorRunning = false;
  let collectorStopRequested = false;

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function robustClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'auto', block: 'center' });
    } catch (_) {}
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    try {
      if (typeof el.click === 'function') el.click();
    } catch (_) {}
  }

  function getCleanUrl(raw) {
    if (!raw) return '';
    try {
      const u = new URL(raw);
      if (u.searchParams.has('story_fbid')) {
        const fbid = u.searchParams.get('story_fbid');
        const id = u.searchParams.get('id');
        return `${u.origin}${u.pathname}?story_fbid=${fbid}${id ? `&id=${id}` : ''}`;
      }
      return `${u.origin}${u.pathname}`.replace(/\/+$/, '/');
    } catch {
      return (raw.split('?')[0] || raw).trim();
    }
  }

  function isPostUrl(href) {
    if (!href) return false;
    return (
      href.includes('/posts/') ||
      href.includes('/permalink/') ||
      href.includes('story_fbid=') ||
      href.includes('/permalink.php')
    );
  }

  function extractAllPostLinks() {
    const found = [];
    const seen = new Set();

    const tryAdd = (a) => {
      if (!a?.href || !isPostUrl(a.href) || seen.has(a.href)) return;
      seen.add(a.href);
      found.push(a.href);
    };

    for (const a of document.querySelectorAll(POST_LINK_STRUCTURAL_SELECTOR)) tryAdd(a);
    try {
      for (const a of document.querySelectorAll(POST_LINK_SELECTOR)) tryAdd(a);
    } catch (_) {}
    for (const a of document.querySelectorAll(
      'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="]'
    )) tryAdd(a);

    return found;
  }

  async function runLinkCollector(requestedMaxPosts) {
    if (collectorRunning) return;
    collectorRunning = true;
    collectorStopRequested = false;

    const storageData = await chrome.storage.local.get([STATUS_KEY, SCRAPED_POSTS_KEY, 'scrapebookMaxPosts']);
    const existingPosts = Array.isArray(storageData[SCRAPED_POSTS_KEY]) ? storageData[SCRAPED_POSTS_KEY] : [];
    seenUrls.clear();
    for (const p of existingPosts) {
      const url = getCleanUrl(p.url || '');
      if (url) seenUrls.add(url);
    }

    const postsList = [...existingPosts];

    let targetLimit = 0;
    if (typeof requestedMaxPosts === 'number' && requestedMaxPosts >= 0) {
      targetLimit = requestedMaxPosts;
    } else if (typeof storageData.scrapebookMaxPosts === 'number' && storageData.scrapebookMaxPosts >= 0) {
      targetLimit = storageData.scrapebookMaxPosts;
    }

    const maxPosts = targetLimit > 0 ? targetLimit : Infinity;

    await chrome.storage.local.set({
      [STATUS_KEY]: {
        running: true,
        stage: 'collecting_links',
        phase: `Collecting post links (${postsList.length}/${maxPosts})...`,
        postIndex: postsList.length,
        scrapedIndex: postsList.filter(p => p.status === 'done').length,
        maxPosts: targetLimit,
      },
    });

    let emptyScrolls = 0;
    const maxEmptyScrolls = 60;

    while (!collectorStopRequested) {
      if (maxPosts !== Infinity && postsList.length >= maxPosts) break;

      const links = extractAllPostLinks();
      const newItems = [];

      for (const href of links) {
        if (collectorStopRequested || (maxPosts !== Infinity && postsList.length + newItems.length >= maxPosts)) break;
        const clean = getCleanUrl(href);
        if (!seenUrls.has(clean)) {
          seenUrls.add(clean);
          newItems.push({
            id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            postNumber: postsList.length + newItems.length + 1,
            url: clean,
            status: 'queued',
            postContent: '',
            comments: [],
          });
        }
      }

      if (newItems.length > 0) {
        postsList.push(...newItems);
        emptyScrolls = 0;
        await chrome.storage.local.set({
          [SCRAPED_POSTS_KEY]: postsList,
          [STATUS_KEY]: {
            running: true,
            stage: 'collecting_links',
            phase: `Collecting post links (${postsList.length}/${maxPosts})...`,
            postIndex: postsList.length,
            scrapedIndex: postsList.filter(p => p.status === 'done').length,
            maxPosts: targetLimit,
          },
        });
      } else {
        emptyScrolls++;
        if (emptyScrolls >= maxEmptyScrolls) break;
      }

      if (emptyScrolls > 5) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        await wait(emptyScrolls > 15 ? 1200 : 700);
      } else {
        window.scrollBy({ top: Math.max(1200, Math.round(window.innerHeight * 1.3)), behavior: 'auto' });
        await wait(newItems.length > 0 ? 300 : 450);
      }
    }

    collectorRunning = false;
    const completed = !collectorStopRequested && postsList.length > 0;

    await chrome.storage.local.set({
      [SCRAPED_POSTS_KEY]: postsList,
      [STATUS_KEY]: {
        running: completed,
        stage: completed ? 'ready_for_scrape' : 'stopped',
        phase: completed
          ? `Link collection done (${postsList.length} links). Starting post scraper...`
          : 'Stopped',
        postIndex: postsList.length,
        scrapedIndex: postsList.filter(p => p.status === 'done').length,
        maxPosts: targetLimit,
      },
    });

    if (completed) {
      chrome.runtime.sendMessage({ type: 'START_POSTS_SCRAPING' }).catch(() => {});
    }
  }

  function stopLinkCollector() {
    collectorStopRequested = true;
    collectorRunning = false;
  }

  async function waitForDialog(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const dialog = document.querySelector(POST_DIALOG_SELECTOR);
      if (dialog) return dialog;
      await wait(300);
    }
    return null;
  }

  async function scrollUntilNoNewComments(dialog) {
    const scrollable = dialog.querySelector(POST_SCROLLABLE_SECTION_SELECTOR);
    if (!scrollable) return;

    let lastCount = dialog.querySelectorAll(COMMENT_DIV_SELECTOR).length;
    let stagnant = 0;

    for (let cycle = 0; cycle < 80; cycle++) {
      if (collectorStopRequested) break;

      scrollable.scrollBy({ top: 500, behavior: 'auto' });
      await wait(500);

      const newCount = dialog.querySelectorAll(COMMENT_DIV_SELECTOR).length;
      const atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 60;

      if (newCount > lastCount) {
        stagnant = 0;
        lastCount = newCount;
      } else if (atBottom) {
        stagnant++;
        if (stagnant >= 4) break;
      }
    }
  }

  async function clickAllReplies(dialog) {
    const scrollable = dialog.querySelector(POST_SCROLLABLE_SECTION_SELECTOR);
    if (scrollable) {
      scrollable.scrollTo({ top: 0, behavior: 'auto' });
      await wait(300);
    }

    const clickedSet = new WeakSet();

    for (let pass = 0; pass < 15; pass++) {
      if (collectorStopRequested) break;
      let clicked = 0;

      const buttons = dialog.querySelectorAll(REPLIES_BUTTON_SELECTOR);
      for (const btn of buttons) {
        if (collectorStopRequested) break;
        if (clickedSet.has(btn)) continue;

        const text = (btn.textContent || '').trim().toLowerCase();
        // Skip collapse/hide buttons so we never accidentally hide replies
        if (text.includes('hide') || text.includes('লুকান') || text.includes('লুকিয়ে')) {
          continue;
        }

        clickedSet.add(btn);
        robustClick(btn);
        clicked++;
        await wait(250);
      }

      if (clicked === 0) break;
      await wait(1200);

      if (scrollable) scrollable.scrollBy({ top: 400, behavior: 'auto' });
      await wait(300);
    }
  }

  async function expandSeeMore(dialog) {
    for (const btn of dialog.querySelectorAll('div[role="button"], span[role="button"]')) {
      const text = (btn.textContent || '').trim().toLowerCase();
      if (text === 'see more' || text === 'আরও দেখুন') {
        robustClick(btn);
        await wait(200);
      }
    }
  }

  function extractPostContent(dialog) {
    const el = dialog.querySelector('div[data-ad-rendering-role="story_message"]');
    if (el?.innerText) {
      return el.innerText.trim()
        .replace(/\s*(?:\.{3}|…)?\s*(?:See more|আরও দেখুন)\s*$/iu, '');
    }
    return '';
  }

  const COMMENT_META_LINES = new Set([
    '·', '•', '.', '-',
    'like', 'লাইক',
    'reply', 'উত্তর দিন',
    'share', 'শেয়ার করুন', 'শেয়ার করুন',
    'follow', 'অনুসরণ করুন',
    'top fan', 'শীর্ষ ফ্যান',
    'author', 'লেখক',
    'admin', 'অ্যাডমিন', 'এডমিন',
    'moderator', 'মডারেটর',
    'group expert', 'গ্রুপ বিশেষজ্ঞ',
    'edited', 'সম্পাদিত',
    'just now', 'এখনই', 'মুহূর্ত আগে'
  ]);

  const RELATIVE_TIME_REGEX =
    /^[\s·•]*[\d০-৯]+\s*(?:[smhdwy]|sec|secs|min|mins|hr|hrs|day|days|wk|wks|week|weeks|mo|mos|month|months|yr|yrs|year|years|সেকেন্ড|মিনিট|মি\.|ঘণ্টা|ঘন্টা|ঘ\.|দিন|সপ্তাহ|মাস|বছর)(?:\s*(?:ago|আগে))?(?:\s*[·•]\s*(?:edited|সম্পাদিত))?[\s·•]*$/iu;
  const EDITED_TIME_REGEX = /^[\s·•]*(?:edited|সম্পাদিত)\s*[·•]\s*[\d০-৯]+/iu;

  function isCommentMetaLine(line) {
    const l = (line || '').trim();
    if (!l) return true;
    if (COMMENT_META_LINES.has(l.toLowerCase())) return true;
    if (RELATIVE_TIME_REGEX.test(l)) return true;
    if (EDITED_TIME_REGEX.test(l)) return true;
    return false;
  }

  function cleanCommentBody(str) {
    if (!str) return '';
    const lines = str.split('\n');
    while (lines.length && isCommentMetaLine(lines[0])) {
      lines.shift();
    }
    while (lines.length && isCommentMetaLine(lines[lines.length - 1])) {
      lines.pop();
    }
    return lines.join('\n').trim();
  }

  function extractComments(dialog) {
    const divs = dialog.querySelectorAll(COMMENT_DIV_SELECTOR);
    const comments = [];
    const seen = new Set();

    for (const div of divs) {
      const raw = (div.innerText || '').trim();
      if (!raw) continue;

      let text = raw;
      for (const marker of ['\nReply', '\nউত্তর দিন', 'Reply', 'উত্তর দিন']) {
        const idx = text.lastIndexOf(marker);
        if (idx !== -1) {
          text = text.slice(0, idx);
          break;
        }
      }

      const lines = text
        .split('\n')
        .map(l => l.trim())
        .filter(l => !isCommentMetaLine(l));

      if (lines.length <= 1) continue;
      const rawBody = lines.slice(1).join('\n').trim();
      const body = cleanCommentBody(rawBody);

      if (body && !seen.has(body)) {
        seen.add(body);
        comments.push({ comment: body });
      }
    }
    return comments;
  }

  async function scrapeStandalonePost() {
    try {
      const dialog = await waitForDialog(15000);
      if (!dialog) return { success: false, error: 'Post dialog did not appear' };

      await wait(600);
      await expandSeeMore(dialog);

      await scrollUntilNoNewComments(dialog);
      await clickAllReplies(dialog);
      await expandSeeMore(dialog);

      const postContent = extractPostContent(dialog);
      const comments = extractComments(dialog);

      return { success: true, postContent, comments };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ pong: true });
      return false;
    }

    if (message.type === 'START_COLLECT_LINKS') {
      runLinkCollector(message.maxPosts);
      sendResponse({ success: true });
      return false;
    }

    if (message.type === 'STOP_COLLECT_LINKS') {
      stopLinkCollector();
      sendResponse({ success: true });
      return false;
    }

    if (message.type === 'SCRAPE_STANDALONE_POST') {
      scrapeStandalonePost()
        .then(res => sendResponse(res))
        .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
      return true;
    }

    return false;
  });
})();
