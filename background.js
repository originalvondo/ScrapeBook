// Open the side panel when the user clicks the extension toolbar action icon
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Side panel behavior error:', error));
}

// Fallback in case setPanelBehavior is not supported in the active environment
chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel && chrome.sidePanel.open) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      console.error('Failed to open side panel:', error);
    }
  }
});

// Automatically inject content script into open Facebook tabs on install / reload
async function injectContentScriptIntoOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['*://*.facebook.com/*', '*://facebook.com/*'] });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/content.js']
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('Error injecting content script on install:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  injectContentScriptIntoOpenTabs();
});

// ============================================================
// STAGE 2: Background Tab Post Scraping Orchestrator
// ============================================================

let currentWorkerTabId = null;
let isScrapingQueue = false;
let stopRequested = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabReady(tabId, timeoutMs = 25000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (stopRequested) return false;

    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab) return false;

      // Check if content script is already responsive
      const ready = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { type: 'PING' }, (res) => {
          resolve(!chrome.runtime.lastError && res && res.pong);
        });
      });

      if (ready) return true;

      // If page reached 'complete' status but script not yet responding, try injecting
      if (tab.status === 'complete') {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content/content.js'],
          });
        } catch (_) {}
      }
    } catch (_) {
      return false;
    }

    await wait(400);
  }

  return false;
}

async function scrapeSinglePostInTab(url) {
  let tabId = null;
  try {
    // 1. Open background tab without taking focus from user
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    currentWorkerTabId = tabId;

    // 2. Wait for page load and content script readiness
    const ready = await waitForTabReady(tabId, 25000);
    if (!ready) {
      if (stopRequested) return { success: false, error: 'Stopped by user' };
      return { success: false, error: 'Page load or content script timed out' };
    }

    await wait(800);

    // 3. Scrape post and comments
    const result = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_STANDALONE_POST' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          resolve({ success: false, error: chrome.runtime.lastError?.message || 'No response from post page' });
        } else {
          resolve(res);
        }
      });
    });

    return result;
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  } finally {
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (_) {}
      if (currentWorkerTabId === tabId) currentWorkerTabId = null;
    }
  }
}

async function processScrapeQueue() {
  if (isScrapingQueue) return;
  isScrapingQueue = true;
  stopRequested = false;

  try {
    // Reset any posts stuck in 'scraping' back to 'queued' from prior interrupted run
    const initData = await chrome.storage.local.get(['scrapebookPosts']);
    let posts = Array.isArray(initData.scrapebookPosts) ? initData.scrapebookPosts : [];
    let updatedInit = false;
    for (const p of posts) {
      if (p.status === 'scraping') {
        p.status = 'queued';
        updatedInit = true;
      }
    }
    if (updatedInit) {
      await chrome.storage.local.set({ scrapebookPosts: posts });
    }

    while (!stopRequested) {
      const data = await chrome.storage.local.get(['scrapebookPosts', 'scrapebookStatus']);
      posts = Array.isArray(data.scrapebookPosts) ? data.scrapebookPosts : [];
      const status = data.scrapebookStatus || {};

      // Find first queued post
      const nextIndex = posts.findIndex(p => p.status === 'queued');
      if (nextIndex === -1) {
        // All posts scraped!
        break;
      }

      const post = posts[nextIndex];
      const scrapedSoFar = posts.filter(p => p.status === 'done').length;

      // Update post status to 'scraping'
      posts[nextIndex].status = 'scraping';
      await chrome.storage.local.set({
        scrapebookPosts: posts,
        scrapebookStatus: {
          ...status,
          running: true,
          stage: 'scraping_posts',
          phase: `Scraping post ${scrapedSoFar + 1} of ${posts.length}...`,
          scrapedIndex: scrapedSoFar,
        }
      });

      // Scrape in background tab
      const result = await scrapeSinglePostInTab(post.url);

      if (stopRequested) break;

      // Re-read posts in case state changed while scraping
      const freshData = await chrome.storage.local.get(['scrapebookPosts', 'scrapebookStatus']);
      const freshPosts = Array.isArray(freshData.scrapebookPosts) ? freshData.scrapebookPosts : posts;
      const freshStatus = freshData.scrapebookStatus || {};

      if (result && result.success) {
        freshPosts[nextIndex].status = 'done';
        freshPosts[nextIndex].postContent = result.postContent || '';
        freshPosts[nextIndex].comments = Array.isArray(result.comments) ? result.comments : [];
        freshPosts[nextIndex].commentsCount = freshPosts[nextIndex].comments.length;
      } else {
        freshPosts[nextIndex].status = 'error';
        freshPosts[nextIndex].error = result?.error || 'Failed to scrape post';
      }

      const updatedScraped = freshPosts.filter(p => p.status === 'done').length;
      await chrome.storage.local.set({
        scrapebookPosts: freshPosts,
        scrapebookStatus: {
          ...freshStatus,
          running: !stopRequested,
          stage: stopRequested ? 'stopped' : 'scraping_posts',
          phase: `Scraped ${updatedScraped} of ${freshPosts.length}`,
          scrapedIndex: updatedScraped,
        }
      });

      if (stopRequested) break;

      // Rate limit safety pause
      await wait(1200);
    }
  } catch (err) {
    console.error('Queue error:', err);
  } finally {
    isScrapingQueue = false;
    const finalData = await chrome.storage.local.get(['scrapebookPosts', 'scrapebookStatus']);
    const finalPosts = Array.isArray(finalData.scrapebookPosts) ? finalData.scrapebookPosts : [];
    const finalStatus = finalData.scrapebookStatus || {};
    const anyQueued = finalPosts.some(p => p.status === 'queued');

    await chrome.storage.local.set({
      scrapebookStatus: {
        ...finalStatus,
        running: false,
        stage: anyQueued && stopRequested ? 'stopped' : 'completed',
        phase: anyQueued && stopRequested ? 'Stopped' : 'Completed',
      }
    });

    if (currentWorkerTabId) {
      try { await chrome.tabs.remove(currentWorkerTabId); } catch (_) {}
      currentWorkerTabId = null;
    }
  }
}

function stopPipeline() {
  stopRequested = true;
  isScrapingQueue = false;
  if (currentWorkerTabId) {
    chrome.tabs.remove(currentWorkerTabId).catch(() => {});
    currentWorkerTabId = null;
  }
}

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_POSTS_SCRAPING') {
    processScrapeQueue();
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'STOP_PIPELINE') {
    stopPipeline();
    sendResponse({ success: true });
    return false;
  }

  return false;
});
