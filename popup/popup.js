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

// Render the UI from storage snapshot
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
  const scrapedPosts = posts.filter(p => p.status === 'done').length;
  const queuedPosts = posts.filter(p => p.status === 'queued').length;

  if (totalPosts > 0) {
    postCountElement.textContent = `Links: ${totalPosts} | Done: ${scrapedPosts}`;
  } else {
    postCountElement.textContent = '0';
  }

  if (status.maxPosts !== undefined && document.activeElement !== maxPostsElement) {
    maxPostsElement.value = status.maxPosts;
  }

  maxPostsElement.disabled = running;
  stopButton.disabled = !running;
  clearStateButton.disabled = running;

  // Primary button label & state
  if (running) {
    startButton.textContent = 'Running...';
    startButton.disabled = true;
  } else if (queuedPosts > 0) {
    startButton.textContent = `Scrape Queued Posts (${queuedPosts})`;
    startButton.disabled = false;
  } else {
    startButton.textContent = 'Start scanner';
    startButton.disabled = false;
  }

  // Export buttons are available whenever there is at least 1 post collected
  const hasPosts = totalPosts > 0;
  exportJsonButton.disabled = !hasPosts;
  exportTxtButton.disabled = !hasPosts;

  // Render the post queue / progress cards
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

  // Render cards (newest or in sequential order)
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
  const data = await chrome.storage.local.get(['scrapebookStatus', 'scrapebookPosts', 'scrapebookMaxPosts']);
  const status = data.scrapebookStatus || {};
  const posts = Array.isArray(data.scrapebookPosts) ? data.scrapebookPosts : [];
  if (data.scrapebookMaxPosts !== undefined && document.activeElement !== maxPostsElement) {
    maxPostsElement.value = data.scrapebookMaxPosts;
  }
  render(status, posts);
}

// Start handling: either starts Stage 1 on active tab or starts Stage 2 if queued posts exist
async function handleStart() {
  const data = await chrome.storage.local.get(['scrapebookPosts', 'scrapebookStatus']);
  const posts = Array.isArray(data.scrapebookPosts) ? data.scrapebookPosts : [];
  const queuedCount = posts.filter(p => p.status === 'queued').length;

  const maxPosts = getMaxPostsValue();
  await chrome.storage.local.set({ scrapebookMaxPosts: maxPosts });

  if (queuedCount > 0) {
    // Stage 2: Scrape remaining queued posts in background tabs
    chrome.runtime.sendMessage({ type: 'START_POSTS_SCRAPING' });
    render({ running: true, stage: 'scraping_posts', phase: 'Starting background scraper...' }, posts);
    return;
  }

  if (posts.length > 0 && maxPosts > 0 && posts.length >= maxPosts) {
    render({
      ...data.scrapebookStatus,
      phase: `Collected ${posts.length}/${maxPosts} posts. Increase Max posts or click "Clear saved data".`,
      running: false,
    }, posts);
    return;
  }

  // Stage 1: Collect links on active Facebook group tab
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

// Stop handling: gracefully halts either stage and closes worker tabs
async function handleStop() {
  // 1. Stop background tab scraper
  chrome.runtime.sendMessage({ type: 'STOP_PIPELINE' }).catch(() => {});

  // 2. Stop link collector on active tab
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
    }
  });

  loadAndRender();
}

function exportAsJSON(posts) {
  const sanitized = posts.map((post) => {
    const { cleanUrl, cleanURL, commentsCount, ...rest } = post;
    const sanitizedComments = Array.isArray(rest.comments)
      ? rest.comments.map((c) => {
          if (typeof c === 'string') return { comment: c };
          const { username, ...cRest } = c;
          return cRest;
        })
      : [];

    return {
      ...rest,
      comments: sanitizedComments,
    };
  });

  return JSON.stringify(sanitized, null, 2);
}

function exportAsTXT(posts) {
  return posts.map((post, index) => {
    const commentsText = Array.isArray(post.comments) && post.comments.length
      ? post.comments.map((c, ci) => {
          const text = typeof c === 'string' ? c : (c.comment || '');
          return `${ci + 1}. ${text}`;
        }).join('\n\n')
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
  }).join('\n\n----------------------------------------\n\n');
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

async function handleClearState() {
  await chrome.storage.local.remove(['scrapebookStatus', 'scrapebookPosts']);
  render({ phase: 'Ready' }, []);
}

// Event Listeners
startButton.addEventListener('click', handleStart);
stopButton.addEventListener('click', handleStop);
exportJsonButton.addEventListener('click', () => handleExport('json'));
exportTxtButton.addEventListener('click', () => handleExport('txt'));
clearStateButton.addEventListener('click', handleClearState);

maxPostsElement.addEventListener('change', async () => {
  const val = getMaxPostsValue();
  maxPostsElement.value = val;
  await chrome.storage.local.set({ scrapebookMaxPosts: val });
});

// Reactively re-render whenever storage changes (live updates from background worker or content script)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.scrapebookStatus || changes.scrapebookPosts) {
    loadAndRender();
  }
});

// Initial load
loadAndRender();