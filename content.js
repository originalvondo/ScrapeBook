(() => {
  if (window.__scrapebookContentScriptLoaded) return;
  window.__scrapebookContentScriptLoaded = true;

  const LOG_PREFIX = '[ScrapeBook]';
  const STATUS_KEY = 'scrapebookStatus';
  const SCRAPED_POSTS_KEY = 'scrapebookPosts';
  const MAX_LOGS = 1000;

  // --- Selectors ---
  const FEED_POST_SELECTOR = 'div.x1n2onr6.xh8yej3.x1ja2u2z.xod5an3';

  const POST_LINK_STRUCTURAL_SELECTOR =
    'span > div > span > span > span > a[role="link"], span > div > span:nth-child(1) > span > span > a';

  const POST_LINK_SELECTOR =
    'a.x1i10hfl.xjbqb8w.x1ejq31n.x18oe1m7.x1sy0etr.xstzfhl.x972fbf.x10w94by.x1qhh985.x14e42zd.x9f619.x1ypdohk.xt0psk2.x3ct3a4.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x16tdsg8.x1hl2dhg.xggy1nq.x1a2a7pz.xkrqix3.x1sur9pj.xi81zsa.x1s688f[role="link"]';

  const COMMENT_BUTTON_SELECTOR = 'div[aria-label="Leave a comment"]';
  const POST_DIALOG_SELECTOR = '[role="dialog"]';

  const REPLIES_BUTTON_SELECTOR =
    'div.x1i10hfl.xjbqb8w.xjqpnuy.xc5r6h4.xqeqjp1.x1phubyo.x13fuv20.x18b5jzi.x1q0q8m5.x1t7ytsu.x972fbf.x10w94by.x1qhh985.x14e42zd.x9f619.x1ypdohk.xdl72j9.x3ct3a4.xdj266r.x14z9mp.xat24cr.x1lziwak.x2lwn1j.xeuugli.xexx8yu.x18d9i69.x1c1uobl.x1n2onr6.x16tdsg8.x1hl2dhg.xggy1nq.x1ja2u2z.x1t137rt.x1fmog5m.xu25z0z.x140muxe.xo1y3bh.x3nfvp2.x87ps6o.x1lku1pv.x1a2a7pz.x6s0dn4.xi81zsa.x1q0g3np.x1iyjqo2.xs83m0k.x1icxu4v[role="button"]';

  const COMMENTS_CONTAINER_SELECTOR =
    'div.html-div.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x1gslohp';

  const POST_CONTENT_CONTAINER_SELECTOR =
    'div[data-ad-rendering-role="story_message"], div[data-ad-preview="message"], .userContent';

  const POST_TEXT_BLOCK_SELECTOR =
    'div.html-div.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl';

  const POST_SCROLLABLE_SECTION_SELECTOR =
    'div.xb57i2i.x1q594ok.x5lxg6s.x78zum5.xdt5ytf.x6ikm8r.x1ja2u2z.x1pq812k.x1rohswg.xfk6m8.x1yqm8si.xjx87ck.xx8ngbg.xwo3gff.x1n2onr6.x1oyok0e.x1odjw0f.x1iyjqo2.xy5w88m';

  const COMMENT_DIV_SELECTOR = 'div.x1nn3v0j.x1120s5i.x135b78x.x11lfxj5';
  const COMMENT_FALLBACK_SELECTOR = 'div[aria-label*="comment by" i], div[role="article"]';

  const seenUrls = new Set();
  let collectorRunning = false;
  let collectorStopRequested = false;

  function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function isElementVisible(el) {
    if (!el) return false;
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility();
    }
    const rect = el.getBoundingClientRect();
    return (rect.width > 0 || rect.height > 0) && window.getComputedStyle(el).display !== 'none';
  }

  function robustClick(el) {
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'auto', block: 'nearest' }); } catch (_) {}
    try { el.click(); } catch (_) {}
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      } catch (_) {}
    }
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

  function getFeedPosts() {
    let posts = [...document.querySelectorAll(FEED_POST_SELECTOR)]
      .filter(el => isElementVisible(el));
    if (!posts.length) {
      posts = [...document.querySelectorAll('div[role="feed"] > div, [role="feed"] [role="article"]')]
        .filter(el => isElementVisible(el));
    }
    return posts;
  }

  // Generic extractor combining structural path, class selector, and URL patterns
  function extractAllPostLinks() {
    const found = [];

    const tryAdd = (el) => {
      if (!el || !el.href) return;
      const href = el.href;
      if (isPostUrl(href) && !found.includes(href)) {
        found.push(href);
      }
    };

    // 1. Structural selector from user's inspected DOM path:
    // ... > span > div > span:nth-child(1) > span > span > a
    const structuralMatches = document.querySelectorAll(POST_LINK_STRUCTURAL_SELECTOR);
    for (const a of structuralMatches) tryAdd(a);

    // 2. Classname and role attribute selector
    try {
      const classMatches = document.querySelectorAll(POST_LINK_SELECTOR);
      for (const a of classMatches) tryAdd(a);
    } catch (_) {}

    // 3. Search inside each feed post container
    const posts = getFeedPosts();
    for (const post of posts) {
      const link = post.querySelector(
        'span > div > span > span > span > a, span > div > span:nth-child(1) > span > span > a, a[role="link"][href*="/posts/"], a[role="link"][href*="/permalink/"], a[href*="/posts/"], a[href*="/permalink/"]'
      );
      tryAdd(link);
    }

    // 4. Any anchor matching group post URLs
    const directLinks = document.querySelectorAll(
      'a[role="link"][href*="/posts/"], a[role="link"][href*="/permalink/"], a[role="link"][href*="story_fbid="], a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="]'
    );
    for (const a of directLinks) tryAdd(a);

    return found;
  }

  // ==========================================
  // STAGE 1: Fast Group Feed Link Collector
  // ==========================================
  async function runLinkCollector(requestedMaxPosts = 100) {
    if (collectorRunning) return;
    collectorRunning = true;
    collectorStopRequested = false;

    // Hydrate existing posts from storage
    const storageData = await chrome.storage.local.get([STATUS_KEY, SCRAPED_POSTS_KEY]);
    const existingPosts = Array.isArray(storageData[SCRAPED_POSTS_KEY]) ? storageData[SCRAPED_POSTS_KEY] : [];
    seenUrls.clear();
    for (const p of existingPosts) {
      const url = p.cleanUrl || getCleanUrl(p.url || p);
      if (url) seenUrls.add(url);
    }

    const postsList = [...existingPosts];
    const maxPosts = requestedMaxPosts > 0 ? requestedMaxPosts : 10000;

    await chrome.storage.local.set({
      [STATUS_KEY]: {
        running: true,
        stage: 'collecting_links',
        phase: `Collecting post links (${postsList.length}/${maxPosts === 10000 ? '∞' : maxPosts})...`,
        postIndex: postsList.length,
        scrapedIndex: postsList.filter(p => p.status === 'done').length,
        maxPosts: requestedMaxPosts,
      }
    });

    let consecutiveEmptyScrolls = 0;
    const SCROLL_STEP = Math.max(1400, Math.round(window.innerHeight * 1.5));
    const FAST_WAIT = 250;

    while (!collectorStopRequested) {
      if (maxPosts > 0 && postsList.length >= maxPosts) {
        break;
      }

      // Collect links from visible posts
      const visibleLinks = extractAllPostLinks();
      const newItems = [];

      for (const href of visibleLinks) {
        if (collectorStopRequested) break;
        if (maxPosts > 0 && (postsList.length + newItems.length) >= maxPosts) break;

        const clean = getCleanUrl(href);
        if (!seenUrls.has(clean)) {
          seenUrls.add(clean);
          newItems.push({
            id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            postNumber: postsList.length + newItems.length + 1,
            url: clean,
            status: 'queued',
            commentsCount: 0,
            postContent: '',
            comments: [],
          });
        }
      }

      if (newItems.length > 0) {
        postsList.push(...newItems);
        consecutiveEmptyScrolls = 0;

        await chrome.storage.local.set({
          [SCRAPED_POSTS_KEY]: postsList,
          [STATUS_KEY]: {
            running: true,
            stage: 'collecting_links',
            phase: `Collecting post links (${postsList.length}/${maxPosts === 10000 ? '∞' : maxPosts})...`,
            postIndex: postsList.length,
            scrapedIndex: postsList.filter(p => p.status === 'done').length,
            maxPosts: requestedMaxPosts,
          }
        });
      } else {
        consecutiveEmptyScrolls++;
        if (consecutiveEmptyScrolls >= 25) {
          // Reached end of feed
          break;
        }
      }

      if (maxPosts > 0 && postsList.length >= maxPosts) {
        break;
      }

      // Scroll the feed down
      window.scrollBy({ top: SCROLL_STEP, behavior: 'auto' });
      await wait(newItems.length > 0 ? FAST_WAIT : FAST_WAIT + 150);
    }

    collectorRunning = false;
    const completed = !collectorStopRequested && postsList.length > 0;

    await chrome.storage.local.set({
      [SCRAPED_POSTS_KEY]: postsList,
      [STATUS_KEY]: {
        running: completed, // if completed collecting, keep running for stage 2
        stage: completed ? 'ready_for_scrape' : 'stopped',
        phase: completed ? `Link collection done (${postsList.length} links). Starting post scraper...` : 'Stopped',
        postIndex: postsList.length,
        scrapedIndex: postsList.filter(p => p.status === 'done').length,
        maxPosts: requestedMaxPosts,
      }
    });

    // Notify background service worker to begin scraping the posts queue
    if (completed) {
      chrome.runtime.sendMessage({ type: 'START_POSTS_SCRAPING' }).catch(() => {});
    }
  }

  function stopLinkCollector() {
    collectorStopRequested = true;
    collectorRunning = false;
  }

  // ====================================================
  // STAGE 2: Standalone Post Scraper (Runs on Post Tab)
  // ====================================================

  function countComments() {
    let divs = document.querySelectorAll(COMMENT_DIV_SELECTOR);
    if (!divs.length) divs = document.querySelectorAll(COMMENT_FALLBACK_SELECTOR);
    return divs.length;
  }

  function clickViewMoreComments() {
    const buttons = document.querySelectorAll('div[role="button"], span, div.x1i10hfl');
    let clicked = false;
    for (const btn of buttons) {
      if (!isElementVisible(btn)) continue;
      const text = (btn.textContent || '').trim().toLowerCase();
      if (
        text.includes('view more comments') ||
        text.includes('view previous comments') ||
        (text.includes('view ') && text.includes('more comments')) ||
        text.includes('আরও মন্তব্য') ||
        text.includes('পূর্ববর্তী মন্তব্য') ||
        text.includes('ver más comentarios') ||
        text.includes('afficher plus de commentaires') ||
        text.includes('weitere kommentare')
      ) {
        robustClick(btn.closest('[role="button"], div[tabindex="0"], div.x1i10hfl') || btn);
        clicked = true;
      }
    }
    return clicked;
  }

  async function scrollUntilNoNewComments() {
    let lastCount = countComments();
    let stagnant = 0;

    for (let cycle = 0; cycle < 30; cycle++) {
      clickViewMoreComments();
      window.scrollBy({ top: 700, behavior: 'auto' });
      await wait(300);

      const newCount = countComments();
      const atBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 200;

      if (newCount > lastCount) {
        stagnant = 0;
        lastCount = newCount;
      } else if (atBottom) {
        stagnant++;
        if (stagnant >= 3) break;
      }
    }
  }

  async function expandAllReplies() {
    for (let pass = 0; pass < 8; pass++) {
      let clicked = 0;
      const repliesButtons = document.querySelectorAll(REPLIES_BUTTON_SELECTOR);
      for (const btn of repliesButtons) {
        if (isElementVisible(btn)) {
          robustClick(btn);
          clicked++;
        }
      }

      const textBtns = document.querySelectorAll('div[role="button"], span, div.x1i10hfl');
      for (const btn of textBtns) {
        if (!isElementVisible(btn)) continue;
        const text = (btn.textContent || '').trim().toLowerCase();
        if (
          /\b\d+\s*(?:replies|reply|উত্তর|respuestas|réponses|antworten)\b/i.test(text) ||
          text.includes('view reply') ||
          text.includes('view replies') ||
          text.includes('টি উত্তর')
        ) {
          robustClick(btn.closest('[role="button"], div[tabindex="0"], div.x1i10hfl') || btn);
          clicked++;
        }
      }

      if (clicked === 0) break;
      await wait(600);
      window.scrollBy({ top: 300, behavior: 'auto' });
      await wait(250);
    }
  }

  function getTargetPostId() {
    const url = window.location.href;
    const match = url.match(/\/posts\/(\d+)/) || url.match(/\/permalink\/(\d+)/) || url.match(/story_fbid=(\d+)/);
    return match ? match[1] : null;
  }

  function getTargetPostElement() {
    const postId = getTargetPostId();

    // 1. Explicitly locate the article containing the link with this post ID
    if (postId) {
      const matchingLinks = document.querySelectorAll(`a[href*="${postId}"]`);
      for (const link of matchingLinks) {
        const article = link.closest('div[role="article"], div[data-pagelet*="FeedUnit"], div.x1n2onr6.xh8yej3');
        if (article) return article;
      }
    }

    // 2. Primary post article inside role="main"
    const roleMain = document.querySelector('div[role="main"]');
    if (roleMain) {
      const firstArticle = roleMain.querySelector('div[role="article"]');
      if (firstArticle) return firstArticle;
      return roleMain;
    }

    // 3. Fallback to first article in document
    const firstArticle = document.querySelector('div[role="article"]');
    if (firstArticle) return firstArticle;

    return document.body;
  }

  async function expandPostContent(targetPost) {
    const root = targetPost || document;
    const candidates = root.querySelectorAll(
      'div[role="button"], span[role="button"], div[tabindex="0"], div.x1i10hfl, span.x1i10hfl'
    );
    for (const btn of candidates) {
      if (btn.closest(COMMENT_DIV_SELECTOR) || btn.closest(COMMENT_FALLBACK_SELECTOR)) continue;
      if (btn.closest('[aria-label*="comment" i]') || btn.closest('[aria-label*="reply" i]') || btn.closest('[aria-label*="মন্তব্য" i]')) continue;
      if (btn.closest('ul')) continue;

      const text = (btn.textContent || '').trim().toLowerCase();
      if (
        text === 'see more' ||
        text === 'আরও দেখুন' ||
        text === 'ver más' ||
        text === 'afficher la suite' ||
        text === 'mehr anzeigen' ||
        text.includes('see more') ||
        text.includes('আরও দেখুন')
      ) {
        robustClick(btn);
        await wait(350);
      }
    }
  }

  function cleanPostContent(raw) {
    if (!raw) return '';
    return raw
      .replace(/\s*(?:\.{3}|…)?\s*(?:See more|আরও দেখুন|Ver más|Afficher la suite|Mehr anzeigen)\s*$/iu, '')
      .trim();
  }

  async function extractPostContent() {
    const targetPost = getTargetPostElement();
    if (!targetPost) return '';

    await expandPostContent(targetPost);

    // 1. Explicit story message attributes scoped strictly to targetPost
    const explicitSelectors = [
      'div[data-ad-rendering-role="story_message"]',
      'div[data-ad-preview="message"]',
      'div[data-ad-comet-preview="message"]',
      'div[data-testid="post_message"]',
      '.userContent',
    ];

    for (const sel of explicitSelectors) {
      try {
        const el = targetPost.querySelector(sel);
        if (el && el.innerText && el.innerText.trim()) {
          const cleaned = cleanPostContent(el.innerText);
          if (cleaned) return cleaned;
        }
      } catch (_) {}
    }

    // 2. Structural extraction: locate message blocks before actionRow inside targetPost
    try {
      const actionRow = targetPost.querySelector(
        'div[aria-label="Leave a comment"], div[aria-label="Comment"], div[aria-label="মন্তব্য করুন"], div[role="toolbar"], div[aria-label*="reaction" i], div[aria-label*="Like" i], div[aria-label*="পছন্দ" i], form[role="presentation"]'
      );

      const candidates = targetPost.querySelectorAll('div[dir="auto"], span[dir="auto"]');
      const validTexts = [];

      for (const el of candidates) {
        // Must not be within comments
        if (el.closest(COMMENT_DIV_SELECTOR) || el.closest(COMMENT_FALLBACK_SELECTOR)) continue;
        if (el.closest('[aria-label*="comment" i]') || el.closest('[aria-label*="reply" i]') || el.closest('[aria-label*="মন্তব্য" i]')) continue;
        if (el.closest('ul')) continue;

        // Must appear before the interaction/actions row in DOM
        if (actionRow && (actionRow.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) {
          continue;
        }

        // Must not be an author link, header, button, or group/shared label
        if (el.closest('a[role="link"], button, [role="button"], h1, h2, h3, h4')) continue;
        if (el.closest('[aria-label*="Shared with" i], [aria-label*="actions for this post" i]')) continue;

        const text = cleanPostContent((el.innerText || '').trim());
        if (!text || text.length < 2) continue;

        // Deduplicate overlapping parent/child blocks
        if (validTexts.some(existing => existing.includes(text) || text.includes(existing))) {
          const idx = validTexts.findIndex(existing => existing.includes(text) || text.includes(existing));
          if (idx !== -1 && text.length > validTexts[idx].length) {
            validTexts[idx] = text;
          }
          continue;
        }

        validTexts.push(text);
      }

      if (validTexts.length > 0) {
        return validTexts.join('\n\n');
      }
    } catch (_) {}

    return '';
  }

  const REPLY_ACTION_WORDS = [
    'reply', 'উত্তর দিন', 'responder', 'répondre', 'antworten', 'rispondi', 'ответить'
  ];

  function cleanComment(raw) {
    if (!raw) return '';
    let text = raw;

    let minIdx = -1;
    for (const word of REPLY_ACTION_WORDS) {
      const idx = text.toLowerCase().lastIndexOf(word);
      if (idx !== -1 && (minIdx === -1 || idx > minIdx)) {
        minIdx = idx;
      }
    }
    if (minIdx !== -1) {
      text = text.slice(0, minIdx);
    }

    const timePattern = /^\s*[\d০-৯]+(?:\s*[smhdw]|\s*(?:মিনিট|ঘণ্টা|ঘন্টা|দিন|সপ্তাহ|মাস|বছর))\s*$/iu;
    const lines = text.split('\n');
    const giphyIdx = lines.findIndex(l => l.trim().toLowerCase() === 'giphy');
    const visible = giphyIdx === -1 ? lines : lines.slice(0, giphyIdx);

    return visible
      .map(l => l.trim())
      .filter(l => (
        l &&
        l !== '·' &&
        l !== '.' &&
        l.toLowerCase() !== 'follow' &&
        l.toLowerCase() !== 'top fan' &&
        l.toLowerCase() !== 'শীর্ষ ফ্যান' &&
        !timePattern.test(l)
      ))
      .join('\n')
      .trim();
  }

  function extractComments() {
    const targetPost = getTargetPostElement();
    const scope = targetPost || document;

    const comments = [];
    let divs = [...scope.querySelectorAll(COMMENT_DIV_SELECTOR)];
    if (!divs.length) {
      divs = [...scope.querySelectorAll(COMMENT_FALLBACK_SELECTOR)];
    }

    // Fallback: if comments are located in a sibling section under role="main"
    if (!divs.length && targetPost !== document.body) {
      const roleMain = document.querySelector('div[role="main"]');
      if (roleMain) {
        divs = [...roleMain.querySelectorAll(COMMENT_DIV_SELECTOR)];
        if (!divs.length) divs = [...roleMain.querySelectorAll(COMMENT_FALLBACK_SELECTOR)];
      }
    }

    for (const div of divs) {
      try {
        const raw = (div.innerText || '').trim();
        const cleaned = cleanComment(raw);
        if (!cleaned) continue;
        const [firstLine, ...rest] = cleaned.split('\n');
        const body = rest.join('\n').trim();
        comments.push({ comment: body || cleaned });
      } catch (_) {}
    }
    return comments;
  }

  async function scrapeStandalonePost() {
    try {
      // 1. Ensure at top of page and wait for React hydration
      window.scrollTo({ top: 0, behavior: 'auto' });
      await wait(1500);

      // 2. Extract post content immediately while mounted at top of page
      let postContent = await extractPostContent();

      // 3. Scroll down to load comments from default filter
      await scrollUntilNoNewComments();

      // 4. Expand reply threads
      await expandAllReplies();

      // 5. Extract comments
      const comments = extractComments();

      // 6. Fallback: if postContent was empty, scroll back to top and retry
      if (!postContent) {
        window.scrollTo({ top: 0, behavior: 'auto' });
        await wait(800);
        postContent = await extractPostContent();
      }

      return {
        success: true,
        postContent,
        comments,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message || String(err),
      };
    }
  }

  // ==========================================
  // Message Listener
  // ==========================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ pong: true });
      return false;
    }

    if (message.type === 'START_SCAN' || message.type === 'START_COLLECT_LINKS') {
      runLinkCollector(message.maxPosts);
      sendResponse({ success: true });
      return false;
    }

    if (message.type === 'STOP_SCAN' || message.type === 'STOP_COLLECT_LINKS') {
      stopLinkCollector();
      sendResponse({ success: true });
      return false;
    }

    if (message.type === 'SCRAPE_STANDALONE_POST') {
      scrapeStandalonePost()
        .then((res) => {
          sendResponse(res);
        })
        .catch((err) => {
          sendResponse({ success: false, error: err.message || String(err) });
        });
      return true; // asynchronous response
    }

    return false;
  });

  console.log(`${LOG_PREFIX} Content script loaded`);
})();
