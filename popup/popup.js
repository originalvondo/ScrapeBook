const statusElement = document.querySelector('#status');
const phaseElement = document.querySelector('#phase');
const postCountElement = document.querySelector('#post-count');
const logCountElement = document.querySelector('#log-count');
const postsListElement = document.querySelector('#posts-list');
const startButton = document.querySelector('#start');
const stopButton = document.querySelector('#stop');
const exportJsonButton = document.querySelector('#export-json');
const exportTxtButton = document.querySelector('#export-txt');
const clearStateButton = document.querySelector('#clear-state');
const maxPostsElement = document.querySelector('#max-posts');
const retryFailedButton = document.querySelector('#retry-failed');

let activeTabId;

function isFacebookUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'facebook.com' || parsed.hostname.endsWith('.facebook.com');
  } catch {
    return false;
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function ensureTabReady(tabId) {
  if (!tabId) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !isFacebookUrl(tab.url)) return false;

    const isResponding = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (res) => {
        resolve(!chrome.runtime.lastError && res && res.pong);
      });
    });

    if (isResponding) return true;

    if (chrome.scripting) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content.js']
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      return true;
    }
  } catch (error) {
    console.warn('ensureTabReady error:', error);
  }
  return false;
}

function getMaxPostsValue() {
  const parsed = parseInt(maxPostsElement.value, 10);
  return isNaN(parsed) || parsed < 0 ? 20 : parsed;
}

function render(status = {}, posts = []) {
  const running = Boolean(status.running);
  statusElement.classList.toggle('running', running);

  if (running) {
    statusElement.innerHTML = `<i></i>${status.stage === 'scraping_posts' ? 'Scraping Posts' : 'Collecting Links'}`;
  } else {
    statusElement.innerHTML = `<i></i>${status.stage === 'completed' ? 'Completed' : 'Stopped'}`;
  }

  phaseElement.textContent = status.phase || 'Ready';

  const totalPosts = posts.length;
  const scrapedPosts = posts.filter((p) => p.status === 'done').length;
  const queuedPosts = posts.filter((p) => p.status === 'queued').length;
  const failedPosts = posts.filter((p) => p.status === 'error');

  if (totalPosts > 0) {
    postCountElement.textContent = `Links: ${totalPosts} | Done: ${scrapedPosts}`;
  } else {
    postCountElement.textContent = '0';
  }

  maxPostsElement.disabled = running;
  stopButton.disabled = !running;
  clearStateButton.disabled = running;

  if (failedPosts.length > 0) {
    retryFailedButton.style.display = 'block';
    retryFailedButton.textContent = `Retry Failed Posts (${failedPosts.length})`;
    retryFailedButton.disabled = running;
  } else {
    retryFailedButton.style.display = 'none';
  }

  if (running) {
    startButton.textContent = 'Running...';
    startButton.disabled = true;
  } else if (queuedPosts > 0) {
    startButton.textContent = `Scrape Queued Posts (${queuedPosts})`;
    startButton.disabled = false;
  } else {
    startButton.textContent = 'Start Collecting';
    startButton.disabled = false;
  }

  const hasPosts = totalPosts > 0;
  exportJsonButton.disabled = !hasPosts;
  exportTxtButton.disabled = !hasPosts;

  logCountElement.textContent = `${totalPosts} post${totalPosts === 1 ? '' : 's'}`;
  const previousScrollTop = postsListElement.scrollTop;
  postsListElement.replaceChildren();

  if (!totalPosts) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No posts collected yet. Open a Facebook group and click "Start scanner".';
    postsListElement.append(empty);
    return;
  }

  posts.forEach((post, index) => {
    const card = document.createElement('li');
    card.className = `post-card ${post.status || 'queued'}`;

    const header = document.createElement('div');
    header.className = 'post-card-header';

    const numSpan = document.createElement('span');
    numSpan.className = 'post-num';
    numSpan.textContent = `#${index + 1}`;

    const postUrl = post.cleanUrl || post.url || '';
    const link = document.createElement('a');
    link.className = 'post-link';
    link.href = postUrl || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = postUrl || `Post ${index + 1}`;
    link.title = postUrl;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (postUrl) chrome.tabs.create({ url: postUrl });
    });

    const badge = document.createElement('span');
    badge.className = `badge badge-${post.status || 'queued'}`;

    if (post.status === 'done') {
      const count = post.commentsCount !== undefined ? post.commentsCount : (post.comments ? post.comments.length : 0);
      badge.textContent = `Done (${count} comments)`;
    } else if (post.status === 'scraping') {
      badge.textContent = 'Scraping...';
    } else if (post.status === 'error') {
      badge.textContent = 'Failed';
    } else {
      badge.textContent = 'Queued';
    }

    header.append(numSpan, link, badge);
    card.append(header);

    if (post.postContent && post.postContent.trim()) {
      const snippet = document.createElement('div');
      snippet.className = 'post-snippet';
      const clean = post.postContent.trim().replace(/\s+/g, ' ');
      snippet.textContent = clean.length > 95 ? clean.slice(0, 95) + '…' : clean;
      snippet.title = post.postContent;
      card.append(snippet);
    }

    postsListElement.append(card);
  });

  postsListElement.scrollTop = previousScrollTop;
}

async function loadAndRender() {
  const data = await chrome.storage.local.get(['scrapebookPosts', 'scrapebookStatus', 'scrapebookMaxPosts']);
  const posts = Array.isArray(data.scrapebookPosts) ? data.scrapebookPosts : [];
  const status = data.scrapebookStatus || {};
  if (data.scrapebookMaxPosts !== undefined && document.activeElement !== maxPostsElement) {
    maxPostsElement.value = data.scrapebookMaxPosts;
  }
  render(status, posts);
}

async function handleStart() {
  const maxPosts = getMaxPostsValue();
  await chrome.storage.local.set({ scrapebookMaxPosts: maxPosts });

  const data = await chrome.storage.local.get(['scrapebookPosts', 'scrapebookStatus']);
  const posts = Array.isArray(data.scrapebookPosts) ? data.scrapebookPosts : [];
  const queuedCount = posts.filter((p) => p.status === 'queued').length;

  if (queuedCount > 0) {
    chrome.runtime.sendMessage({ type: 'START_POSTS_SCRAPING' });
    render({ running: true, stage: 'scraping_posts', phase: 'Starting background scraper...' }, posts);
    return;
  }

  if (posts.length > 0 && maxPosts > 0 && posts.length >= maxPosts) {
    render(
      {
        ...data.scrapebookStatus,
        phase: `Collected ${posts.length}/${maxPosts} posts. Increase Max posts or click "Clear saved data".`,
        running: false,
      },
      posts
    );
    return;
  }

  const tab = await getActiveTab();
  activeTabId = tab?.id;
  if (!activeTabId || !tab || !isFacebookUrl(tab.url)) {
    render({ phase: 'Open a Facebook group to scan' }, posts);
    return;
  }

  const payload = { type: 'START_COLLECT_LINKS', maxPosts };

  chrome.tabs.sendMessage(activeTabId, payload, async () => {
    if (chrome.runtime.lastError) {
      const ready = await ensureTabReady(activeTabId);
      if (ready) {
        chrome.tabs.sendMessage(activeTabId, payload, () => {
          if (chrome.runtime.lastError) render({ phase: 'Open Facebook group to scan' }, posts);
        });
      } else {
        render({ phase: 'Open Facebook group to scan' }, posts);
      }
    }
  });
}

async function handleStop() {
  chrome.runtime.sendMessage({ type: 'STOP_PIPELINE' }).catch(() => {});

  const tab = await getActiveTab();
  if (tab?.id && isFacebookUrl(tab.url)) {
    chrome.tabs.sendMessage(tab.id, { type: 'STOP_COLLECT_LINKS' }).catch(() => {});
  }

  const data = await chrome.storage.local.get(['scrapebookPosts', 'scrapebookStatus']);
  const posts = Array.isArray(data.scrapebookPosts) ? data.scrapebookPosts : [];
  const status = data.scrapebookStatus || {};

  await chrome.storage.local.set({
    scrapebookStatus: {
      ...status,
      running: false,
      phase: 'Stopped by user',
      stage: 'stopped',
    },
  });

  loadAndRender();
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

function cleanCommentText(text) {
  if (typeof text !== 'string') return '';
  const lines = text.split('\n');
  while (lines.length && isCommentMetaLine(lines[0])) {
    lines.shift();
  }
  while (lines.length && isCommentMetaLine(lines[lines.length - 1])) {
    lines.pop();
  }
  return lines.join('\n').trim();
}

function exportAsJSON(posts) {
  const sanitized = posts.map((post) => {
    const sanitizedComments = Array.isArray(post.comments)
      ? post.comments
          .map((c) => {
            if (typeof c === 'string') {
              const cleaned = cleanCommentText(c);
              return cleaned ? { comment: cleaned } : null;
            }
            const { username, ...cRest } = c;
            if (cRest.comment) {
              cRest.comment = cleanCommentText(cRest.comment);
              if (!cRest.comment) return null;
            }
            return cRest;
          })
          .filter(Boolean)
      : [];

    return {
      id: post.id,
      postNumber: post.postNumber,
      url: post.url,
      status: post.status,
      postContent: post.postContent || '',
      ...(post.error ? { error: post.error } : {}),
      comments: sanitizedComments,
    };
  });

  return JSON.stringify(sanitized, null, 2);
}

function exportAsTXT(posts) {
  return posts
    .map((post, index) => {
      const filteredComments = Array.isArray(post.comments)
        ? post.comments
            .map((c) => {
              const text = typeof c === 'string' ? c : c.comment || '';
              return cleanCommentText(text);
            })
            .filter(Boolean)
        : [];

      const commentsText =
        filteredComments.length
          ? filteredComments
              .map((text, ci) => `${ci + 1}. ${text}`)
              .join('\n\n')
          : '(No comments scraped)';

      return [
        `Post #${index + 1}: ${post.url}`,
        `Status: ${post.status || 'unknown'}`,
        '',
        'Post content:',
        post.postContent || '(No post content found)',
        '',
        'Comments:',
        commentsText,
      ].join('\n');
    })
    .join('\n\n----------------------------------------\n\n');
}

async function triggerDownload(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function handleExport(type) {
  const data = await chrome.storage.local.get('scrapebookPosts');
  const posts = Array.isArray(data.scrapebookPosts) ? data.scrapebookPosts : [];
  if (!posts.length) return;

  if (type === 'json') {
    const jsonStr = exportAsJSON(posts);
    triggerDownload(jsonStr, 'application/json', 'scrapebook-data.json');
  } else {
    const txtStr = exportAsTXT(posts);
    triggerDownload(txtStr, 'text/plain', 'scrapebook-data.txt');
  }
}

async function handleRetryFailed() {
  const data = await chrome.storage.local.get(['scrapebookPosts', 'scrapebookStatus']);
  const posts = Array.isArray(data.scrapebookPosts) ? data.scrapebookPosts : [];

  let count = 0;
  for (const p of posts) {
    if (p.status === 'error') {
      p.status = 'queued';
      p.error = null;
      count++;
    }
  }

  if (count === 0) return;

  await chrome.storage.local.set({
    scrapebookPosts: posts,
    scrapebookStatus: {
      ...(data.scrapebookStatus || {}),
      running: true,
      stage: 'scraping_posts',
      phase: `Retrying ${count} failed post${count === 1 ? '' : 's'}...`,
    },
  });

  chrome.runtime.sendMessage({ type: 'START_POSTS_SCRAPING' });
  render({ running: true, stage: 'scraping_posts', phase: `Retrying ${count} failed post${count === 1 ? '' : 's'}...` }, posts);
}

async function handleClearState() {
  await chrome.storage.local.remove(['scrapebookStatus', 'scrapebookPosts']);
  render({ phase: 'Ready' }, []);
}

startButton.addEventListener('click', handleStart);
stopButton.addEventListener('click', handleStop);
retryFailedButton.addEventListener('click', handleRetryFailed);
exportJsonButton.addEventListener('click', () => handleExport('json'));
exportTxtButton.addEventListener('click', () => handleExport('txt'));
clearStateButton.addEventListener('click', handleClearState);

const saveMaxPosts = async () => {
  const val = getMaxPostsValue();
  await chrome.storage.local.set({ scrapebookMaxPosts: val });
};

maxPostsElement.addEventListener('input', saveMaxPosts);
maxPostsElement.addEventListener('change', saveMaxPosts);

chrome.storage.onChanged.addListener((changes) => {
  if (changes.scrapebookStatus || changes.scrapebookPosts) {
    loadAndRender();
  }
});

loadAndRender();