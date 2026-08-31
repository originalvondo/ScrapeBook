(() => {
  if (window.__scrapebookContentScriptLoaded) return;
  window.__scrapebookContentScriptLoaded = true;

  const LOG_PREFIX = '[ScrapeBook]';
  const STATUS_KEY = 'scrapebookStatus';
  const SCRAPED_POSTS_KEY = 'scrapebookPosts';
  const MAX_LOGS = 80;

  const FEED_POST_SELECTOR = 'div.x1n2onr6.xh8yej3.x1ja2u2z.xod5an3';

  const COMMENT_BUTTON_SELECTOR = 'div[aria-label="Leave a comment"]';

  const POST_DIALOG_SELECTOR = '[role="dialog"]';

  const ALL_COMMENTS_TRIGGER_SELECTOR =
    'div.x1i10hfl.xjbqb8w.x1ejq31n.x18oe1m7.x1sy0etr.xstzfhl.x972fbf.x10w94by.x1qhh985.x14e42zd.x9f619.x1ypdohk.xt0psk2.x3ct3a4.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x16tdsg8.x1hl2dhg.xggy1nq.x1fmog5m.xu25z0z.x140muxe.xo1y3bh.x1n2onr6.x87ps6o.x1lku1pv.x1a2a7pz';

  const ALL_COMMENTS_BUTTON_SELECTOR =
    'div.x1i10hfl.xjbqb8w.x1ejq31n.x18oe1m7.x1sy0etr.xstzfhl.x972fbf.x10w94by.x1qhh985.x14e42zd.x3ct3a4.x1hl2dhg.xggy1nq.x1fmog5m.xu25z0z.x140muxe.xo1y3bh.x87ps6o.x1lku1pv.x1a2a7pz.xjyslct.x9f619.x1ypdohk.x78zum5.x1q0g3np.x2lah0s.x1i6fsjq.xfvfia3.x8e7100.x1a16bkn.x10wwi4t.x1x7e7qh.xgm7xcn.x1ynn3ck.x1n2onr6.x16tdsg8.x1ja2u2z.x6s0dn4[role="menuitem"]';

  const REPLIES_BUTTON_SELECTOR =
    'div.x1i10hfl.xjbqb8w.xjqpnuy.xc5r6h4.xqeqjp1.x1phubyo.x13fuv20.x18b5jzi.x1q0q8m5.x1t7ytsu.x972fbf.x10w94by.x1qhh985.x14e42zd.x9f619.x1ypdohk.xdl72j9.x3ct3a4.xdj266r.x14z9mp.xat24cr.x1lziwak.x2lwn1j.xeuugli.xexx8yu.x18d9i69.x1c1uobl.x1n2onr6.x16tdsg8.x1hl2dhg.xggy1nq.x1ja2u2z.x1t137rt.x1fmog5m.xu25z0z.x140muxe.xo1y3bh.x3nfvp2.x87ps6o.x1lku1pv.x1a2a7pz.x6s0dn4.xi81zsa.x1q0g3np.x1iyjqo2.xs83m0k.x1icxu4v[role="button"]';

  const COMMENTS_CONTAINER_SELECTOR =
    'div.html-div.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x1gslohp';

  const POST_CONTENT_CONTAINER_SELECTOR =
    '.__fb-dark-mode.x1n2onr6.x1vjfegm div[data-ad-rendering-role="story_message"].html-div.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl';

  const POST_TEXT_BLOCK_SELECTOR =
    'div.html-div.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl';

  const POST_SCROLLABLE_SECTION_SELECTOR =
    'div.xb57i2i.x1q594ok.x5lxg6s.x78zum5.xdt5ytf.x6ikm8r.x1ja2u2z.x1pq812k.x1rohswg.xfk6m8.x1yqm8si.xjx87ck.xx8ngbg.xwo3gff.x1n2onr6.x1oyok0e.x1odjw0f.x1iyjqo2.xy5w88m';

  const COMMENT_DIV_SELECTOR = 'div.x1nn3v0j.x1120s5i.x135b78x.x11lfxj5';
  const COMMENT_FALLBACK_SELECTOR = 'div[aria-label*="comment by" i], div[role="article"]';

  // multi-lang "all comments" labels
  const ALL_COMMENTS_TEXTS = [
    'all comments', 'সকল মন্তব্য', 'সব মন্তব্য',
    'todos los comentarios', 'tous les commentaires',
    'alle kommentare', 'सभी टिप्पणियाँ',
  ];

  // possible labels on the comment filter dropdown button
  const FILTER_TRIGGER_TEXTS = [
    'most relevant', 'top comments', 'all comments', 'newest',
    'সবচেয়ে প্রাসঙ্গিক', 'সকল মন্তব্য', 'más relevantes',
    'plus pertinents', 'alle kommentare',
  ];

  const scrapedPosts = [];
  const scrapedSignatures = new Set();

  const state = {
    running: false,
    phase: 'Ready',
    postIndex: 0,
    nextPostIndex: 0,
    maxPosts: 100,
    logs: [],
    startedAt: null,
    stopRequested: false,
  };

  function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function log(message, level = 'info') {
    const entry = { message, level, timestamp: new Date().toISOString() };
    console.log(`${LOG_PREFIX} [${level.toUpperCase()}] ${message}`);
    state.logs = [...state.logs, entry].slice(-MAX_LOGS);
    writeStatus();
  }

  function writeStatus() {
    chrome.storage.local.set({
      [STATUS_KEY]: {
        running: state.running,
        phase: state.phase,
        postIndex: state.postIndex,
        nextPostIndex: state.nextPostIndex,
        maxPosts: state.maxPosts,
        logs: state.logs,
        startedAt: state.startedAt,
      },
    });
  }

  function setPhase(phase) {
    state.phase = phase;
    writeStatus();
  }

  function persistScrapedPosts() {
    chrome.storage.local.set({ [SCRAPED_POSTS_KEY]: scrapedPosts });
  }

  // .click() alone doesn't always work on FB, so we fire the full pointer/mouse sequence too
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

  function generatePostSignature(article, postContent = '') {
    if (!article && !postContent) return '';
    if (article) {
      const linkEl = article.querySelector(
        'a[href*="/permalink/"], a[href*="/posts/"], a[href*="story_fbid="], a[href*="/groups/"][href*="permalink"]'
      );
      if (linkEl && linkEl.href) {
        try { const url = new URL(linkEl.href); return `${url.origin}${url.pathname}`; }
        catch { return linkEl.href; }
      }
    }
    const authorEl = article ? article.querySelector('h2, h3, h4, strong, a[role="link"]') : null;
    const author = authorEl ? authorEl.textContent.trim().slice(0, 40) : '';
    const text = (postContent || (article ? article.innerText : '') || '').slice(0, 140).replace(/\s+/g, ' ').trim();
    if (author || text) return `${author}::${text}`;
    return '';
  }

  async function restoreStoredState() {
    const saved = await chrome.storage.local.get([STATUS_KEY, SCRAPED_POSTS_KEY, 'scrapebookMaxPosts']);
    const savedStatus = saved[STATUS_KEY] || {};
    if (Array.isArray(saved[SCRAPED_POSTS_KEY])) {
      scrapedPosts.length = 0;
      scrapedPosts.push(...saved[SCRAPED_POSTS_KEY]);
      scrapedSignatures.clear();
      for (const p of scrapedPosts) {
        if (p.signature) scrapedSignatures.add(p.signature);
        const fb = generatePostSignature(null, p.postContent);
        if (fb) scrapedSignatures.add(fb);
      }
    }
    state.maxPosts = saved.scrapebookMaxPosts !== undefined ? saved.scrapebookMaxPosts : (savedStatus.maxPosts || 100);
    state.nextPostIndex = scrapedPosts.length;
    state.postIndex = scrapedPosts.length;
    state.logs = Array.isArray(savedStatus.logs) ? savedStatus.logs : [];
    state.startedAt = savedStatus.startedAt || null;
    state.phase = state.nextPostIndex > 0 ? 'Ready to resume' : 'Ready';
  }

  const stateReady = restoreStoredState().then(() => writeStatus());

  async function clearStoredState() {
    if (state.running) return;
    scrapedPosts.length = 0;
    scrapedSignatures.clear();
    state.postIndex = 0;
    state.nextPostIndex = 0;
    state.logs = [];
    state.startedAt = null;
    state.phase = 'Ready';
    await chrome.storage.local.remove([STATUS_KEY, SCRAPED_POSTS_KEY]);
    writeStatus();
  }

  function exportAsJSON(posts) {
    return JSON.stringify(posts, null, 2);
  }

  function exportAsTXT(posts) {
    return posts.map((post) => [
      `Post ${post.postNumber}`,
      '',
      'Post content:',
      post.postContent || '(No post content found)',
      '',
      'Comments:',
      ...(post.comments.length
        ? [post.comments
          .map((data, index) => {
            let output = `${index + 1}. ${data.username}\n${data.comment}`;
            if (data.replies && data.replies.length > 0) {
              output += '\nReplies:';
              data.replies.forEach((reply, ri) => {
                const [ru, ...rl] = reply.split('\n');
                output += `\n--- #${ri + 1} : ${ru}`;
                output += `\n------ ${rl.join('\n').trim()}`;
              });
            }
            return output;
          })
          .join('\n\n')]
        : ['(No comments found)']),
    ].join('\n')).join('\n\n----------------------------------------\n\n');
  }

  function getFeedPosts() {
    return [...document.querySelectorAll(FEED_POST_SELECTOR)]
      .filter(el => el.offsetParent !== null);
  }

  function findCommentButton(article) {
    if (!article) return null;

    // try the exact selector first
    const specific = article.querySelector(COMMENT_BUTTON_SELECTOR);
    if (specific && specific.offsetParent !== null) return specific;

    // aria-label fallback (handles multiple languages)
    const ariaMatches = article.querySelectorAll(
      'div[aria-label*="comment" i], div[aria-label*="Comment" i], div[aria-label*="মন্তব্য" i], div[aria-label*="comentario" i], div[aria-label*="commentaire" i]'
    );
    for (const btn of ariaMatches) {
      if (btn.offsetParent !== null) return btn;
    }

    // last resort: look for "12 comments" style text
    const links = article.querySelectorAll('a[role="link"], span, div[role="button"]');
    for (const el of links) {
      if (el.offsetParent === null) continue;
      const text = (el.textContent || '').trim().toLowerCase();
      if (/\d+\s*(?:comments|comment|মন্তব্য|comentarios|commentaires)/i.test(text)) {
        return el.closest('[role="button"], a') || el;
      }
    }

    return null;
  }

  async function openPost(article) {
    // bring it on screen first
    article.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await wait(500);

    const btn = findCommentButton(article);
    if (!btn) {
      log('No comment button found on this post', 'warning');
      return false;
    }

    log('Clicking comment button to open post');
    robustClick(btn);

    // wait for the dialog to show up
    for (let t = 0; t < 60; t++) {
      if (document.querySelector(POST_DIALOG_SELECTOR)) {
        log('Dialog opened', 'success');
        return true;
      }
      await wait(100);
    }

    // didn't work, try again
    log('Dialog did not appear, retrying click', 'warning');
    robustClick(btn);
    for (let t = 0; t < 40; t++) {
      if (document.querySelector(POST_DIALOG_SELECTOR)) {
        log('Dialog opened on retry', 'success');
        return true;
      }
      await wait(100);
    }

    log('Failed to open post dialog', 'error');
    return false;
  }

  function getScrollableSection() {
    // try the exact selector
    const specific = document.querySelector(POST_SCROLLABLE_SECTION_SELECTOR);
    if (specific && specific.offsetParent !== null) return specific;

    // otherwise look for any scrollable div in the dialog
    const dialog = document.querySelector(POST_DIALOG_SELECTOR);
    if (!dialog) return null;

    const divs = dialog.querySelectorAll('div');
    for (const d of divs) {
      try {
        const s = window.getComputedStyle(d);
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && d.scrollHeight > d.clientHeight && d.clientHeight > 100) {
          return d;
        }
      } catch (_) {}
    }

    return dialog;
  }

  // looks for the comment filter dropdown button ("Most relevant", "Newest", etc.)
  function findFilterTrigger() {
    const dialog = document.querySelector(POST_DIALOG_SELECTOR);
    const root = dialog || document;

    // exact selector
    const specific = root.querySelector(ALL_COMMENTS_TRIGGER_SELECTOR);
    if (specific && specific.offsetParent !== null) return specific;

    // elements with aria-haspopup="menu" are almost always the filter dropdown
    const haspopup = root.querySelectorAll('div[aria-haspopup="menu"], span[aria-haspopup="menu"]');
    for (const el of haspopup) {
      if (el.offsetParent === null) continue;
      const text = (el.textContent || '').trim().toLowerCase();
      // filter buttons have short labels, skip anything with long text (it's probably a container)
      if (text.length <= 60 && FILTER_TRIGGER_TEXTS.some(t => text.includes(t))) {
        return el;
      }
    }

    // widen the search to button-like elements, but still skip big containers
    const candidates = root.querySelectorAll(
      'div[role="button"], div[tabindex="0"], span[role="button"]'
    );
    for (const el of candidates) {
      if (el.offsetParent === null) continue;
      if (el.closest('[role="menu"]')) continue;
      const text = (el.textContent || '').trim().toLowerCase();
      // skip elements with too much text — they're containers, not buttons
      if (text.length > 60) continue;
      if (FILTER_TRIGGER_TEXTS.some(t => text.includes(t))) {
        return el;
      }
    }

    // broadest fallback: any clickable-ish element with an exact text match
    const broad = root.querySelectorAll('div.x1i10hfl, span');
    for (const el of broad) {
      if (el.offsetParent === null) continue;
      if (el.closest('[role="menu"]')) continue;
      const text = (el.textContent || '').trim().toLowerCase();
      if (text.length > 40) continue;
      if (FILTER_TRIGGER_TEXTS.some(t => text === t)) {
        return el.closest('[role="button"], div[aria-haspopup="menu"], div[tabindex="0"], div.x1i10hfl') || el;
      }
    }

    return null;
  }

  // after the filter dropdown opens, find and return the "All comments" menu item
  function findAllCommentsMenuItem() {
    // try exact selector
    const items = document.querySelectorAll(ALL_COMMENTS_BUTTON_SELECTOR);
    for (const item of items) {
      if (item.offsetParent === null) continue;
      const text = (item.innerText || '').trim().toLowerCase();
      if (ALL_COMMENTS_TEXTS.some(t => text.startsWith(t))) {
        return item;
      }
    }

    // fallback: any visible menuitem that says "all comments"
    const allMenuItems = document.querySelectorAll('[role="menuitem"]');
    for (const item of allMenuItems) {
      if (item.offsetParent === null) continue;
      const text = (item.innerText || '').trim().toLowerCase();
      if (ALL_COMMENTS_TEXTS.some(t => text.startsWith(t))) {
        return item;
      }
    }

    return null;
  }

  async function tryClickAllComments() {
    log('Checking if "All comments" filter exists...');

    // poll for up to 5s waiting for the filter trigger to appear
    const TRIGGER_TIMEOUT = 5000;
    const TRIGGER_POLL_INTERVAL = 200;
    let trigger = null;
    const triggerStart = Date.now();

    while (Date.now() - triggerStart < TRIGGER_TIMEOUT) {
      trigger = findFilterTrigger();
      if (trigger) {
        log(`Filter trigger found after ${Date.now() - triggerStart}ms`);
        break;
      }
      await wait(TRIGGER_POLL_INTERVAL);
    }

    if (!trigger) {
      // still not visible — try scrolling the dialog down a bit to reveal it
      log('Filter trigger not visible after timeout, scrolling dialog down a bit to find it');
      const scrollable = getScrollableSection();
      if (scrollable) {
        for (let i = 0; i < 5; i++) {
          scrollable.scrollBy({ top: 300, behavior: 'smooth' });
          await wait(400);
          trigger = findFilterTrigger();
          if (trigger) {
            log('Found filter trigger after scrolling');
            break;
          }
        }
      }
    }

    if (!trigger) {
      log('No comment filter trigger found — skipping "All comments" step', 'warning');
      return;
    }

    // already set to "All comments"? nothing to do
    const triggerText = (trigger.textContent || '').trim().toLowerCase();
    if (ALL_COMMENTS_TEXTS.some(t => triggerText.includes(t))) {
      log('"All comments" is already active');
      return;
    }

    log('Clicking filter trigger to open dropdown');
    robustClick(trigger);
    await wait(500);

    let menuItem = null;
    for (let t = 0; t < 30; t++) {
      menuItem = findAllCommentsMenuItem();
      if (menuItem) break;
      await wait(100);
    }

    if (!menuItem) {
      log('"All comments" menuitem not found — dismissing menu', 'warning');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await wait(300);
      return;
    }

    log('Found "All comments" menuitem, clicking it');
    robustClick(menuItem);
    await wait(1000);
    log('Switched to "All comments"', 'success');
  }

  function countComments() {
    const container = document.querySelector(COMMENTS_CONTAINER_SELECTOR)
      || document.querySelector(POST_DIALOG_SELECTOR)
      || document;
    let divs = container.querySelectorAll(COMMENT_DIV_SELECTOR);
    if (!divs.length) divs = container.querySelectorAll(COMMENT_FALLBACK_SELECTOR);
    return divs.length;
  }

  // clicks any "View more comments" / "View previous comments" buttons it can find
  function clickViewMoreComments() {
    const dialog = document.querySelector(POST_DIALOG_SELECTOR) || document;
    const buttons = dialog.querySelectorAll('div[role="button"], span, div.x1i10hfl');
    let clicked = false;
    for (const btn of buttons) {
      if (btn.offsetParent === null) continue;
      const text = (btn.textContent || '').trim().toLowerCase();
      if (
        text.includes('view more comments') ||
        text.includes('view previous comments') ||
        (text.includes('view ') && text.includes('more comments')) ||
        text.includes('আরও মন্তব্য') ||
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
    log('Scrolling to load all comments...');
    setPhase('Loading comments');

    const scrollable = getScrollableSection();
    if (!scrollable) {
      log('No scrollable section found', 'warning');
      return;
    }

    let lastCount = countComments();
    let stagnant = 0;

    for (let cycle = 0; cycle < 80; cycle++) {
      if (state.stopRequested) break;

      // try loading more comments if the button is there
      clickViewMoreComments();

      // keep scrolling
      scrollable.scrollBy({ top: 500, behavior: 'auto' });
      await wait(300);

      const newCount = countComments();
      const atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 50;

      if (newCount > lastCount) {
        stagnant = 0;
        lastCount = newCount;
        log(`Comments loaded so far: ${newCount}`);
      } else if (atBottom) {
        stagnant++;
        if (stagnant >= 3) {
          log(`No new comments loading, total: ${newCount}`, 'success');
          break;
        }
      }
    }
  }

  async function expandAllReplies() {
    log('Expanding reply threads...');
    const dialog = document.querySelector(POST_DIALOG_SELECTOR) || document;

    for (let pass = 0; pass < 10; pass++) {
      if (state.stopRequested) break;

      let clicked = 0;

      // exact selector for reply buttons
      const repliesButtons = dialog.querySelectorAll(REPLIES_BUTTON_SELECTOR);
      for (const btn of repliesButtons) {
        if (btn.offsetParent !== null) {
          robustClick(btn);
          clicked++;
        }
      }

      // text-based fallback
      const textBtns = dialog.querySelectorAll('div[role="button"], span, div.x1i10hfl');
      for (const btn of textBtns) {
        if (btn.offsetParent === null) continue;
        const text = (btn.textContent || '').trim().toLowerCase();
        if (
          /\b\d+\s*(?:replies|reply|উত্তর|respuestas|réponses|antworten)\b/i.test(text) ||
          text.includes('view reply') ||
          text.includes('view replies') ||
          (text.includes('view ') && text.includes('replies'))
        ) {
          robustClick(btn.closest('[role="button"], div[tabindex="0"], div.x1i10hfl') || btn);
          clicked++;
        }
      }

      if (clicked === 0) {
        log('No more reply buttons found');
        break;
      }

      log(`Clicked ${clicked} reply buttons, waiting for them to load...`);
      await wait(800);

      // scroll down so freshly loaded replies come into view
      const scrollable = getScrollableSection();
      if (scrollable) scrollable.scrollBy({ top: 300, behavior: 'auto' });
      await wait(300);
    }
  }

  function extractPostContent() {
    const container = document.querySelector(POST_CONTENT_CONTAINER_SELECTOR);
    if (!container) return '';
    return container.innerText.trim();
  }

  function cleanComment(raw) {
    const replyIdx = raw.lastIndexOf('Reply');
    const beforeActions = replyIdx === -1 ? raw : raw.slice(0, replyIdx);
    const timePattern = /^\s*[\d০-৯]+(?:\s*[smhdw]|\s*(?:মিনিট|ঘণ্টা|ঘন্টা|দিন|সপ্তাহ|মাস|বছর))\s*$/iu;
    const lines = beforeActions.split('\n');
    const giphyIdx = lines.findIndex(l => l.trim().toLowerCase() === 'giphy');
    const visible = giphyIdx === -1 ? lines : lines.slice(0, giphyIdx);
    return visible
      .map(l => l.trim())
      .filter(l => l && l !== '·' && l !== '.' && l.toLowerCase() !== 'follow' && !timePattern.test(l))
      .join('\n')
      .trim();
  }

  function extractComments() {
    const container =
      document.querySelector(COMMENTS_CONTAINER_SELECTOR) ||
      document.querySelector(POST_DIALOG_SELECTOR) ||
      document;
    if (!container) return [];

    const comments = [];
    let divs = container.querySelectorAll(COMMENT_DIV_SELECTOR);
    if (!divs.length) divs = container.querySelectorAll(COMMENT_FALLBACK_SELECTOR);

    for (const div of divs) {
      try {
        const raw = (div.innerText || '').trim();
        const cleaned = cleanComment(raw);
        if (!cleaned) continue;
        const [username, ...rest] = cleaned.split('\n');
        const body = rest.join('\n').trim();
        comments.push({ username: username || 'User', comment: body || cleaned, replies: [] });
      } catch (_) {}
    }
    return comments;
  }

  async function closeDialog() {
    if (!document.querySelector(POST_DIALOG_SELECTOR)) return;

    log('Closing dialog (pressing Escape)');
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true,
    }));
    await wait(500);

    // did it close?
    if (!document.querySelector(POST_DIALOG_SELECTOR)) {
      log('Dialog closed', 'success');
      return;
    }

    // nope — try the close button instead
    log('Dialog still open, clicking close button', 'warning');
    const dialog = document.querySelector(POST_DIALOG_SELECTOR);
    if (dialog) {
      const closeBtn = dialog.querySelector(
        'div[aria-label="Close"], div[aria-label="close"], div[aria-label="বন্ধ করুন"], div[role="button"][aria-label*="lose"], div.x1i10hfl[aria-label*="lose"]'
      );
      if (closeBtn) robustClick(closeBtn);
      await wait(500);
    }

    // one last Escape
    if (document.querySelector(POST_DIALOG_SELECTOR)) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await wait(300);
    }

    if (!document.querySelector(POST_DIALOG_SELECTOR)) {
      log('Dialog closed', 'success');
    } else {
      log('Dialog might still be open', 'error');
    }
  }

  async function runLoop() {
    // start at 1 to skip the first blank/header post
    let currentFeedIndex = 1;
    let consecutiveEmptyScrolls = 0;

    while (!state.stopRequested) {
      if (state.maxPosts > 0 && scrapedPosts.length >= state.maxPosts) {
        log(`Reached target of ${state.maxPosts} posts`, 'success');
        break;
      }

      const posts = getFeedPosts();
      log(`Feed has ${posts.length} visible posts, looking at index ${currentFeedIndex}`);

      if (currentFeedIndex >= posts.length) {
        // need more posts — scroll the feed
        log('Need more posts, scrolling feed...');
        setPhase('Scrolling feed for more posts');
        window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
        await wait(1500);

        const newPosts = getFeedPosts();
        if (newPosts.length <= currentFeedIndex) {
          consecutiveEmptyScrolls++;
          log(`Still not enough posts after scroll (attempt ${consecutiveEmptyScrolls})`, 'warning');
          if (consecutiveEmptyScrolls >= 12) {
            log('No more posts loading after repeated scrolling — stopping', 'warning');
            break;
          }
          continue;
        }
        consecutiveEmptyScrolls = 0;
        continue;
      }

      consecutiveEmptyScrolls = 0;
      const article = posts[currentFeedIndex];

      // skip if we already scraped this one
      const sig = generatePostSignature(article);
      if (sig && scrapedSignatures.has(sig)) {
        log(`Post at index ${currentFeedIndex} already scraped, skipping`);
        currentFeedIndex++;
        continue;
      }

      const postNumber = scrapedPosts.length + 1;
      state.postIndex = postNumber;
      setPhase(`Processing post ${postNumber}`);

      log(`Processing post ${postNumber} (feed index ${currentFeedIndex})`);

      const opened = await openPost(article);

      if (!opened) {
        log(`Could not open post ${postNumber}, moving on`, 'warning');
        currentFeedIndex++;
        continue;
      }

      await tryClickAllComments();

      await scrollUntilNoNewComments();

      await expandAllReplies();

      setPhase('Extracting data');
      const postContent = extractPostContent();
      const comments = extractComments();
      const finalSig = generatePostSignature(article, postContent) || sig;

      const scraped = { postNumber, signature: finalSig, postContent, comments };
      scrapedPosts.push(scraped);
      if (sig) scrapedSignatures.add(sig);
      if (finalSig) scrapedSignatures.add(finalSig);
      persistScrapedPosts();

      log(`Post ${postNumber}: ${postContent ? 'content found' : 'no content'}, ${comments.length} comments`, 'success');

      await closeDialog();
      await wait(300);

      state.nextPostIndex = scrapedPosts.length;
      writeStatus();
      currentFeedIndex++;

      // scroll the next post into view
      const updatedPosts = getFeedPosts();
      if (currentFeedIndex < updatedPosts.length) {
        log('Scrolling next post into view');
        updatedPosts[currentFeedIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
        await wait(600);
      }
    }

    state.running = false;
    state.stopRequested = false;
    const completed = state.maxPosts > 0 && scrapedPosts.length >= state.maxPosts;
    setPhase(completed ? 'Completed' : 'Stopped');
    writeStatus();
    log(completed ? `Done — ${scrapedPosts.length} posts scraped` : `Stopped — ${scrapedPosts.length} posts scraped`,
      completed ? 'success' : 'warning');
  }

  async function start(restart = false, requestedMaxPosts = undefined) {
    if (state.running) { log('Already running', 'warning'); return; }
    await stateReady;

    const saved = await chrome.storage.local.get([STATUS_KEY, SCRAPED_POSTS_KEY, 'scrapebookMaxPosts']);
    if (requestedMaxPosts !== undefined) state.maxPosts = requestedMaxPosts;
    else if (saved.scrapebookMaxPosts !== undefined) state.maxPosts = saved.scrapebookMaxPosts;

    if (restart) {
      scrapedPosts.length = 0;
      scrapedSignatures.clear();
      state.nextPostIndex = 0;
      state.postIndex = 0;
      await chrome.storage.local.remove(SCRAPED_POSTS_KEY);
    } else {
      if (!scrapedPosts.length && Array.isArray(saved[SCRAPED_POSTS_KEY])) {
        scrapedPosts.length = 0;
        scrapedPosts.push(...saved[SCRAPED_POSTS_KEY]);
        scrapedSignatures.clear();
        for (const p of scrapedPosts) {
          if (p.signature) scrapedSignatures.add(p.signature);
          const fb = generatePostSignature(null, p.postContent);
          if (fb) scrapedSignatures.add(fb);
        }
      }
      state.nextPostIndex = scrapedPosts.length;
      state.postIndex = scrapedPosts.length;
    }

    state.running = true;
    state.stopRequested = false;
    state.logs = [];
    state.startedAt = new Date().toISOString();
    setPhase('Starting');
    log(`Scanner started (target: ${state.maxPosts > 0 ? state.maxPosts + ' posts' : 'unlimited'})`);
    writeStatus();

    runLoop().catch(err => {
      state.running = false;
      state.stopRequested = false;
      setPhase('Error');
      log(`Error: ${err.message || err}`, 'error');
      writeStatus();
    });
  }

  function stop() {
    if (!state.running) return;
    state.stopRequested = true;
    setPhase('Finishing current post');
    log('Stop requested', 'warning');
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_SCAN') start(false, message.maxPosts);
    if (message.type === 'RESTART_SCAN') start(true, message.maxPosts);
    if (message.type === 'STOP_SCAN') stop();
    if (message.type === 'CLEAR_STORED_STATE') clearStoredState();
    if (message.type === 'GET_SCRAPED_POSTS') sendResponse({ posts: scrapedPosts });
    if (message.type === 'EXPORT_JSON') sendResponse({ content: exportAsJSON(scrapedPosts), mimeType: 'application/json' });
    if (message.type === 'EXPORT_TXT') sendResponse({ content: exportAsTXT(scrapedPosts), mimeType: 'text/plain' });
    if (message.type === 'GET_STATUS') {
      sendResponse({
        running: state.running, phase: state.phase, postIndex: state.postIndex,
        nextPostIndex: state.nextPostIndex, maxPosts: state.maxPosts, logs: state.logs,
        startedAt: state.startedAt,
      });
    }
    return true;
  });

  console.log(`${LOG_PREFIX} Content script loaded`);
})();
