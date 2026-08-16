const LOG_PREFIX = '[ScrapeBook]';
const STATUS_KEY = 'scrapebookStatus';
const SCRAPED_POSTS_KEY = 'scrapebookPosts';
const MAX_LOGS = 80;

// Frequently adjusted scan settings live here instead of inside the workflow.
const MAX_POSTS_TO_SCRAPE = 10;
const COMMENT_SCROLL_DURATION_MS = 5000;
const COMMENT_SCROLL_STEP_PX = 300;
const COMMENT_SCROLL_INTERVAL_MS = 100;
const FEED_SCROLL_WAIT_MS = 1200;
const POST_SETTLE_WAIT_MS = 500;

// Facebook selectors are kept together so DOM changes have one obvious home.
const COMMENT_BUTTON_SELECTOR = 'div[aria-label="Leave a comment"]';
const POST_DIALOG_SELECTOR = '[role="dialog"]';
const ALL_COMMENTS_TRIGGER_SELECTOR =
  'div.x1i10hfl.xjbqb8w.x1ejq31n.x18oe1m7.x1sy0etr.xstzfhl.x972fbf.x10w94by.x1qhh985.x14e42zd.x9f619.x1ypdohk.xt0psk2.x3ct3a4.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x16tdsg8.x1hl2dhg.xggy1nq.x1fmog5m.xu25z0z.x140muxe.xo1y3bh.x1n2onr6.x87ps6o.x1lku1pv.x1a2a7pz';
const ALL_COMMENTS_BUTTON_SELECTOR =
  'span.x193iq5w.xeuugli.x13faqbe.x1vvkbs.x1xmvt09.x1lliihq.x1s928wv.xhkezso.x1gmr53x.x1cpjm7i.x1fgarty.x1943h6x.xudqn12.x3x7a5m.x6prxxf.xvq8zen.xk50ysn.xzsf02u.x1yc453h';
const COMMENTS_CONTAINER_SELECTOR =
  'div.html-div.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x1gslohp';
const POST_CONTENT_CONTAINER_SELECTOR =
  '.__fb-dark-mode.x1n2onr6.x1vjfegm div[data-ad-rendering-role="story_message"].html-div.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl';
const POST_TEXT_BLOCK_SELECTOR =
  'div.html-div.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl';
const POST_SCROLLABLE_SECTION_SELECTOR =
  'div.xb57i2i.x1q594ok.x5lxg6s.x78zum5.xdt5ytf.x6ikm8r.x1ja2u2z.x1pq812k.x1rohswg.xfk6m8.x1yqm8si.xjx87ck.xx8ngbg.xwo3gff.x1n2onr6.x1oyok0e.x1odjw0f.x1iyjqo2.xy5w88m';

// Results stay in memory until the user explicitly exports them.
const scrapedPosts = [];

const state = {
  running: false,
  phase: 'Ready',
  postIndex: 0,
  nextPostIndex: 0,
  logs: [],
  startedAt: null,
  stopRequested: false
};

function writeStatus() {
  // The popup reads this snapshot while the content script runs in the tab.
  chrome.storage.local.set({
    [STATUS_KEY]: {
      running: state.running,
      phase: state.phase,
      postIndex: state.postIndex,
      nextPostIndex: state.nextPostIndex,
      logs: state.logs,
      startedAt: state.startedAt
    }
  });
}

function persistScrapedPosts() {
  chrome.storage.local.set({ [SCRAPED_POSTS_KEY]: scrapedPosts });
}

async function restoreStoredState() {
  const saved = await chrome.storage.local.get([STATUS_KEY, SCRAPED_POSTS_KEY]);
  const savedStatus = saved[STATUS_KEY] || {};

  if (Array.isArray(saved[SCRAPED_POSTS_KEY])) {
    scrapedPosts.push(...saved[SCRAPED_POSTS_KEY]);
  }

  state.nextPostIndex = savedStatus.nextPostIndex || 0;
  state.postIndex = savedStatus.postIndex || state.nextPostIndex;
  state.logs = Array.isArray(savedStatus.logs) ? savedStatus.logs : [];
  state.startedAt = savedStatus.startedAt || null;
  state.phase = state.nextPostIndex > 0 ? 'Ready to resume' : 'Ready';
}

const stateReady = restoreStoredState().then(() => writeStatus());

async function clearStoredState() {
  if (state.running) return;

  scrapedPosts.length = 0;
  state.postIndex = 0;
  state.nextPostIndex = 0;
  state.logs = [];
  state.startedAt = null;
  state.phase = 'Ready';
  await chrome.storage.local.remove([STATUS_KEY, SCRAPED_POSTS_KEY]);
  writeStatus();
}

function log(message, level = 'info') {
  // Keep the prefix in the console, but leave visible popup messages uncluttered.
  const entry = {
    message,
    level,
    timestamp: new Date().toISOString()
  };

  console.log(`${LOG_PREFIX} ${message}`);
  state.logs = [...state.logs, entry].slice(-MAX_LOGS);
  writeStatus();
}

function setPhase(phase) {
  state.phase = phase;
  writeStatus();
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function isStopRequested() {
  return state.stopRequested;
}

function extractPostContent() {
  // The post body is read before the dialog closes, while its DOM is available.
  const container = document.querySelector(POST_CONTENT_CONTAINER_SELECTOR);
  if (!container) return '';

  return container.innerText.trim();
}

function cleanComment(comment) {
  // Facebook appends actions and metadata to each direct comment block.
  const replyIndex = comment.lastIndexOf('Reply');
  const commentBeforeActions = replyIndex === -1 ? comment : comment.slice(0, replyIndex);
  const timePattern = /^\s*[\d০-৯]+(?:\s*[smhdw]|\s*(?:মিনিট|ঘণ্টা|ঘন্টা|দিন|সপ্তাহ|মাস|বছর))\s*$/iu;
  const lines = commentBeforeActions.split('\n');
  const giphyIndex = lines.findIndex((line) => line.trim().toLowerCase() === 'giphy');
  const visibleLines = giphyIndex === -1 ? lines : lines.slice(0, giphyIndex);

  return visibleLines
    .map((line) => line.trim())
    .filter((line) => line && line !== '·' && line !== '.' && line.toLowerCase() !== 'follow' && !timePattern.test(line))
    .join('\n')
    .trim();
}

function extractComments() {
  // Direct children represent comments; nested descendants may represent replies.
  const container = document.querySelector(COMMENTS_CONTAINER_SELECTOR);
  if (!container) return {};

  const comments = {};
  [...container.querySelectorAll(':scope > div')]
    .map((comment) => cleanComment(comment.innerText.trim()))
    .filter(Boolean)
    .forEach((comment) => {
      const [username, ...commentLines] = comment.split('\n');
      comments[username] = commentLines.join('\n').trim();
    });

  return comments;
}

function logExtractedPost(post) {
  // One compact success event replaces several noisy extraction messages.
  const contentStatus = post.postContent ? 'content found' : 'content missing';
  log(`Post ${post.postNumber} extracted - ${contentStatus} - ${Object.keys(post.comments).length} comments`, 'success');
}

function exportAsJSON(posts) {
  // Serialization is separate from downloading so export formats can evolve.
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
    ...(Object.keys(post.comments).length
      ? [Object.entries(post.comments)
        .map(([username, comment], index) => `${index + 1}. ${username}\n${comment}`)
        .join('\n\n')]
      : ['(No comments found)'])
  ].join('\n')).join('\n\n----------------------------------------\n\n');
}

function waitForElement(selector, timeout = 5000) {
  // Polling avoids racing Facebook's asynchronous dialog rendering.
  const startTime = Date.now();

  return new Promise((resolve) => {
    const interval = window.setInterval(() => {
      const element = document.querySelector(selector);
      if (element || Date.now() - startTime >= timeout) {
        window.clearInterval(interval);
        resolve(element);
      }
    }, COMMENT_SCROLL_INTERVAL_MS);
  });
}

function waitForElementToDisappear(selector, timeout = 5000) {
  // A post is not considered complete until its dialog is gone.
  const startTime = Date.now();

  return new Promise((resolve) => {
    const interval = window.setInterval(() => {
      if (!document.querySelector(selector) || Date.now() - startTime >= timeout) {
        window.clearInterval(interval);
        resolve(!document.querySelector(selector));
      }
    }, 100);
  });
}

function getFeedPosts() {
  // Only visible feed cards participate in the sequential scan.
  return [...document.querySelectorAll('div.x1n2onr6.xh8yej3.x1ja2u2z.xod5an3')]
    .filter((article) => article.offsetParent !== null);
}

async function openPost(article) {
  // Opening through the comment control keeps the scan in the current feed.
  article.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await wait(400);

  const commentButton = article.querySelector(COMMENT_BUTTON_SELECTOR);
  if (!commentButton) {
    log('Comment button not found', 'warning');
    return false;
  }

  commentButton.click();
  setPhase('Opening post');
  const dialog = await waitForElement(POST_DIALOG_SELECTOR);
  if (!dialog) {
    log('Post dialog did not appear', 'error');
    return false;
  }

  return true;
}

async function clickAllComments() {
  // Click the trigger div that reveals the "All comments" button
  await wait(300);
  const trigger = document.querySelector(ALL_COMMENTS_TRIGGER_SELECTOR);
  if (!trigger) {
    log('All comments trigger not found', 'warning');
    return false;
  }

  trigger.click();
  await wait(300);

  // Find and click the "All comments" span by class and text content
  const allCommentsSpans = document.querySelectorAll(ALL_COMMENTS_BUTTON_SELECTOR);
  let allCommentsButton = null;

  for (const span of allCommentsSpans) {
    if (span.textContent.trim().toLowerCase() === 'all comments') {
      allCommentsButton = span;
      break;
    }
  }

  if (!allCommentsButton) {
    log('All comments button not found', 'warning');
    return false;
  }

  await wait(300);
  allCommentsButton.click();
  log('Clicked All comments');
  await wait(300);

  return true;
}

async function scrollComments() {
  // Scroll only Facebook's verified dialog section, never the feed itself.
  await wait(500);
  const scrollableSection = document.querySelector(POST_SCROLLABLE_SECTION_SELECTOR);
  if (!scrollableSection) {
    log('Post scrollable section not found', 'error');
    return false;
  }

  setPhase('Scrolling comments');

  await new Promise((resolve) => {
    const startTime = Date.now();
    const interval = window.setInterval(() => {
      if (Date.now() - startTime >= COMMENT_SCROLL_DURATION_MS) {
        window.clearInterval(interval);
        resolve();
        return;
      }

      scrollableSection.scrollBy({ top: COMMENT_SCROLL_STEP_PX, behavior: 'auto' });
    }, COMMENT_SCROLL_INTERVAL_MS);
  });

  return true;
}

async function closePost() {
  // Escape closes the active dialog without navigating away from the feed.
  if (!document.querySelector(POST_DIALOG_SELECTOR)) return;

  setPhase('Closing post');
  const escEvent = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    keyCode: 27,
    which: 27,
    bubbles: true
  });
  window.dispatchEvent(escEvent);

  const closed = await waitForElementToDisappear(POST_DIALOG_SELECTOR, 5000);
  if (!closed) {
    log('Post dialog did not close', 'error');
    return;
  }

}

async function runLoop() {
  // Each iteration completes one post before moving to the next visible card.
  let processed = state.nextPostIndex;

  while (!isStopRequested() && processed < MAX_POSTS_TO_SCRAPE) {
    const posts = getFeedPosts();
    const article = posts[processed];

    if (!article) {
      setPhase('Waiting for posts');
      window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
      await wait(FEED_SCROLL_WAIT_MS);
      if (getFeedPosts().length <= processed) break;
      continue;
    }

    state.postIndex = processed + 1;
    setPhase('Opening post');
    log(`Processing post ${state.postIndex}`);
    const opened = await openPost(article);
    if (opened) {
      await clickAllComments();
      const scrolled = await scrollComments();
      if (scrolled) {
        const postNumber = state.postIndex;
        const scrapedPost = {
          postNumber,
          postContent: extractPostContent(),
          comments: extractComments()
        };

        scrapedPosts.push(scrapedPost);
        persistScrapedPosts();
        logExtractedPost(scrapedPost);
      }
    }
    await closePost();
    processed += 1;
    state.nextPostIndex = processed;
    writeStatus();
    await wait(POST_SETTLE_WAIT_MS);
  }

  state.running = false;
  state.stopRequested = false;
  setPhase('Stopped');
  log('Scanner stopped', 'warning');
}

async function start(restart = false) {
  // A new run starts with a clean result set and fresh scanner state.
  if (state.running) return;

  await stateReady;

  const saved = await chrome.storage.local.get([STATUS_KEY, SCRAPED_POSTS_KEY]);
  if (restart) {
    scrapedPosts.length = 0;
    state.nextPostIndex = 0;
    await chrome.storage.local.remove(SCRAPED_POSTS_KEY);
  } else if (!scrapedPosts.length && Array.isArray(saved[SCRAPED_POSTS_KEY])) {
    scrapedPosts.push(...saved[SCRAPED_POSTS_KEY]);
    state.nextPostIndex = saved[STATUS_KEY]?.nextPostIndex || 0;
  }

  state.running = true;
  state.stopRequested = false;
  state.postIndex = state.nextPostIndex;
  state.logs = [];
  state.startedAt = new Date().toISOString();
  setPhase('Starting');
  log('Scanner started');
  runLoop().catch((error) => {
    state.running = false;
    state.stopRequested = false;
    setPhase('Error');
    log(error.message || 'Unexpected scanner error', 'error');
  });
}

function stop() {
  // The loop checks this flag between asynchronous steps and exits safely.
  if (!state.running) return;
  state.stopRequested = true;
  setPhase('Finishing current post');
  log('Stop requested; finishing current post', 'warning');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Popup commands are intentionally small; the scanner remains tab-local.
  if (message.type === 'START_SCAN') start(false);
  if (message.type === 'RESTART_SCAN') start(true);
  if (message.type === 'STOP_SCAN') stop();
  if (message.type === 'CLEAR_STORED_STATE') clearStoredState();
  if (message.type === 'GET_SCRAPED_POSTS') {
    sendResponse({ posts: scrapedPosts });
  }
  if (message.type === 'EXPORT_JSON') {
    sendResponse({ content: exportAsJSON(scrapedPosts), mimeType: 'application/json' });
  }
  if (message.type === 'EXPORT_TXT') {
    sendResponse({ content: exportAsTXT(scrapedPosts), mimeType: 'text/plain' });
  }
  if (message.type === 'GET_STATUS') {
    sendResponse({
      running: state.running,
      phase: state.phase,
      postIndex: state.postIndex,
      nextPostIndex: state.nextPostIndex,
      logs: state.logs,
      startedAt: state.startedAt
    });
  }
  return true;
});
