const statusElement = document.querySelector('#status');
const phaseElement = document.querySelector('#phase');
const postCountElement = document.querySelector('#post-count');
const logCountElement = document.querySelector('#log-count');
const logsElement = document.querySelector('#logs');
const startButton = document.querySelector('#start');
const stopButton = document.querySelector('#stop');
const restartButton = document.querySelector('#restart');
const exportJsonButton = document.querySelector('#export-json');
const exportTxtButton = document.querySelector('#export-txt');
const clearStateButton = document.querySelector('#clear-state');

let activeTabId;

// Render all popup state from one storage/message snapshot.
function render(status = {}) {
  const running = Boolean(status.running);
  statusElement.classList.toggle('running', running);
  statusElement.innerHTML = `<i></i>${running ? 'Running' : 'Stopped'}`;
  phaseElement.textContent = status.phase || 'Ready';
  postCountElement.textContent = status.postIndex || 0;
  startButton.textContent = status.nextPostIndex > 0 ? 'Resume scanner' : 'Start scanner';
  startButton.disabled = running;
  stopButton.disabled = !running;
  restartButton.disabled = running;
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

function sendToTab(type) {
  // Scanner commands are sent to the active Facebook tab.
  if (!activeTabId) return;
  chrome.tabs.sendMessage(activeTabId, { type }, () => {
    if (chrome.runtime.lastError) render({ phase: 'Open Facebook to scan' });
  });
}

function downloadExport(type, filename) {
  // The popup owns the browser download; the tab supplies serialized data.
  if (!activeTabId) return;

  chrome.tabs.sendMessage(activeTabId, { type }, (response) => {
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
  });
}

async function loadStatus() {
  // Stored state lets the popup recover the latest status after reopening.
  const stored = await chrome.storage.local.get('scrapebookStatus');
  render(stored.scrapebookStatus);
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  // Prefer live tab state, falling back to the last persisted snapshot.
  activeTabId = tabs[0]?.id;
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { type: 'GET_STATUS' }, (status) => {
      if (chrome.runtime.lastError || !status) loadStatus();
      else render(status);
    });
  } else {
    loadStatus();
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.scrapebookStatus) render(changes.scrapebookStatus.newValue);
});

startButton.addEventListener('click', () => sendToTab('START_SCAN'));
stopButton.addEventListener('click', () => sendToTab('STOP_SCAN'));
restartButton.addEventListener('click', () => sendToTab('RESTART_SCAN'));
exportJsonButton.addEventListener('click', () => downloadExport('EXPORT_JSON', 'scrapebook-data.json'));
exportTxtButton.addEventListener('click', () => downloadExport('EXPORT_TXT', 'scrapebook-data.txt'));
clearStateButton.addEventListener('click', () => {
  chrome.storage.local.remove(['scrapebookStatus', 'scrapebookPosts'], () => {
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { type: 'CLEAR_STORED_STATE' }, () => {
        render({ phase: 'Ready' });
      });
    } else {
      render({ phase: 'Ready' });
    }
  });
});