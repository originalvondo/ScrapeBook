const statusElement = document.querySelector('#status');
const phaseElement = document.querySelector('#phase');
const postCountElement = document.querySelector('#post-count');
const logCountElement = document.querySelector('#log-count');
const logsElement = document.querySelector('#logs');
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

    // Check if the content script is already responding
    const isResponding = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'GET_STATUS' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });

    if (isResponding) return true;

    // Inject content script dynamically if not responding
    if (chrome.scripting) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content.js']
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      return true;
    }
  } catch (error) {
    console.warn('ensureTabReady error:', error);
  }
  return false;
}

// Render all panel state from one storage/message snapshot.
function render(status = {}) {
  const running = Boolean(status.running);
  statusElement.classList.toggle('running', running);
  statusElement.innerHTML = `<i></i>${running ? 'Running' : 'Stopped'}`;
  phaseElement.textContent = status.phase || 'Ready';

  const count = status.postIndex || 0;
  const configuredMax = status.maxPosts !== undefined ? status.maxPosts : parseInt(maxPostsElement.value, 10);
  if (configuredMax > 0) {
    postCountElement.textContent = `${count} / ${configuredMax}`;
  } else {
    postCountElement.textContent = `${count}`;
  }

  if (status.maxPosts !== undefined && document.activeElement !== maxPostsElement) {
    maxPostsElement.value = status.maxPosts;
  }

  maxPostsElement.disabled = running;
  startButton.textContent = status.nextPostIndex > 0 ? 'Resume scanner' : 'Start scanner';
  startButton.disabled = running;
  stopButton.disabled = !running;
  clearStateButton.disabled = running;

  const logs = status.logs || [];
  logCountElement.textContent = `${logs.length} event${logs.length === 1 ? '' : 's'}`;
  logsElement.replaceChildren();
  if (!logs.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No activity yet';
    logsElement.append(empty);
    return;
  }

  logs.slice().reverse().forEach((entry) => {
    const item = document.createElement('li');
    item.className = `log-item ${entry.level || 'info'}`;
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    item.innerHTML = `<time>${time}</time><span></span>`;
    item.querySelector('span').textContent = entry.message;
    logsElement.append(item);
  });
}

function getMaxPostsValue() {
  const parsed = parseInt(maxPostsElement.value, 10);
  return isNaN(parsed) || parsed < 0 ? 100 : parsed;
}

async function sendToTab(type) {
  // Scanner commands are sent to the active Facebook tab.
  const tab = await getActiveTab();
  activeTabId = tab?.id;
  if (!activeTabId || !tab || !isFacebookUrl(tab.url)) {
    render({ phase: 'Open Facebook to scan' });
    return;
  }

  const maxPosts = getMaxPostsValue();
  await chrome.storage.local.set({ scrapebookMaxPosts: maxPosts });

  const payload = { type, maxPosts };

  chrome.tabs.sendMessage(activeTabId, payload, async () => {
    if (chrome.runtime.lastError) {
      const ready = await ensureTabReady(activeTabId);
      if (ready) {
        chrome.tabs.sendMessage(activeTabId, payload, () => {
          if (chrome.runtime.lastError) render({ phase: 'Open Facebook to scan' });
        });
      } else {
        render({ phase: 'Open Facebook to scan' });
      }
    }
  });
}

async function downloadExport(type, filename) {
  // The panel owns the browser download; the tab supplies serialized data.
  const tab = await getActiveTab();
  activeTabId = tab?.id;
  if (!activeTabId || !tab || !isFacebookUrl(tab.url)) {
    render({ phase: 'Open Facebook to export' });
    return;
  }

  const handleResponse = (response) => {
    if (chrome.runtime.lastError || !response) {
      render({ phase: 'Open Facebook to export' });
      return;
    }

    const blob = new Blob([response.content], { type: response.mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  chrome.tabs.sendMessage(activeTabId, { type }, async (response) => {
    if (chrome.runtime.lastError || !response) {
      const ready = await ensureTabReady(activeTabId);
      if (ready) {
        chrome.tabs.sendMessage(activeTabId, { type }, handleResponse);
      } else {
        render({ phase: 'Open Facebook to export' });
      }
    } else {
      handleResponse(response);
    }
  });
}

async function loadStatus() {
  // Stored state lets the panel recover the latest status after reopening.
  const stored = await chrome.storage.local.get(['scrapebookStatus', 'scrapebookMaxPosts']);
  if (stored.scrapebookMaxPosts !== undefined && document.activeElement !== maxPostsElement) {
    maxPostsElement.value = stored.scrapebookMaxPosts;
  }
  render(stored.scrapebookStatus);
}

async function syncActiveTabStatus() {
  const tab = await getActiveTab();
  activeTabId = tab?.id;
  if (activeTabId && tab && isFacebookUrl(tab.url)) {
    chrome.tabs.sendMessage(activeTabId, { type: 'GET_STATUS' }, async (status) => {
      if (chrome.runtime.lastError || !status) {
        const ready = await ensureTabReady(activeTabId);
        if (ready) {
          chrome.tabs.sendMessage(activeTabId, { type: 'GET_STATUS' }, (newStatus) => {
            if (chrome.runtime.lastError || !newStatus) loadStatus();
            else render(newStatus);
          });
        } else {
          loadStatus();
        }
      } else {
        render(status);
      }
    });
  } else {
    loadStatus();
  }
}

maxPostsElement.addEventListener('change', async () => {
  const val = getMaxPostsValue();
  maxPostsElement.value = val;
  await chrome.storage.local.set({ scrapebookMaxPosts: val });
  const stored = await chrome.storage.local.get('scrapebookStatus');
  render(stored.scrapebookStatus);
});

// Initial status load and active tab status check
loadStatus().then(() => syncActiveTabStatus());

// Keep status synchronized when switching tabs or when the active tab finishes updating
chrome.tabs.onActivated.addListener(() => {
  syncActiveTabStatus();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    syncActiveTabStatus();
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.scrapebookStatus) render(changes.scrapebookStatus.newValue);
});

startButton.addEventListener('click', () => sendToTab('START_SCAN'));
stopButton.addEventListener('click', () => sendToTab('STOP_SCAN'));
exportJsonButton.addEventListener('click', () => downloadExport('EXPORT_JSON', 'scrapebook-data.json'));
exportTxtButton.addEventListener('click', () => downloadExport('EXPORT_TXT', 'scrapebook-data.txt'));
clearStateButton.addEventListener('click', async () => {
  const tab = await getActiveTab();
  activeTabId = tab?.id;
  chrome.storage.local.remove(['scrapebookStatus', 'scrapebookPosts'], async () => {
    if (activeTabId && tab && isFacebookUrl(tab.url)) {
      chrome.tabs.sendMessage(activeTabId, { type: 'CLEAR_STORED_STATE' }, async () => {
        if (chrome.runtime.lastError) {
          const ready = await ensureTabReady(activeTabId);
          if (ready) {
            chrome.tabs.sendMessage(activeTabId, { type: 'CLEAR_STORED_STATE' }, () => {
              render({ phase: 'Ready' });
            });
            return;
          }
        }
        render({ phase: 'Ready' });
      });
    } else {
      render({ phase: 'Ready' });
    }
  });
});