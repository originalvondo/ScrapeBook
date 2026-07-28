// Popup script for Feed Scroller extension

const startBtn = document.getElementById('startBtn');
const statusDiv = document.getElementById('status');
const logContainer = document.getElementById('logContainer');
const clearLogsBtn = document.getElementById('clearLogs');

// Log levels
const LOG_LEVELS = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  ACTION: 'action'
};

// Add a log entry to the popup
function addLog(level, message, data = null) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  
  const time = new Date().toLocaleTimeString();
  const timeEl = document.createElement('span');
  timeEl.className = 'log-time';
  timeEl.textContent = time;
  
  const levelEl = document.createElement('span');
  levelEl.className = `log-level ${level}`;
  levelEl.textContent = level;
  
  const messageEl = document.createElement('span');
  messageEl.className = 'log-message';
  messageEl.textContent = message;
  
  entry.appendChild(timeEl);
  entry.appendChild(levelEl);
  entry.appendChild(messageEl);
  
  if (data) {
    const dataEl = document.createElement('span');
    dataEl.className = 'log-data';
    dataEl.textContent = JSON.stringify(data);
    entry.appendChild(dataEl);
  }
  
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Clear all logs
clearLogsBtn.addEventListener('click', () => {
  logContainer.innerHTML = '';
});

// Listen for log messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'log') {
    addLog(request.level, request.message, request.data);
  } else if (request.action === 'complete') {
    startBtn.disabled = false;
    startBtn.textContent = 'Start Scrolling';
    statusDiv.textContent = 'Done! Scrolling complete and dialog closed.';
    statusDiv.className = 'status success';
    addLog(LOG_LEVELS.SUCCESS, 'Feed scroller completed successfully');
  }
  return true;
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.textContent = 'Running...';
  statusDiv.textContent = 'Starting...';
  statusDiv.className = 'status';
  addLog(LOG_LEVELS.INFO, 'Starting feed scroller');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.id) {
      throw new Error('Could not get active tab');
    }
    
    // Inject content script if not already injected
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    }).catch(() => {}); // Ignore if already injected
    
    // Send message to content script
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'start' });
    
    if (response && response.success) {
      statusDiv.textContent = 'Started! Scrolling feed for 5 seconds...';
      statusDiv.className = 'status success';
      addLog(LOG_LEVELS.SUCCESS, 'Feed scroller started successfully');
    } else {
      throw new Error('Failed to start');
    }
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'status error';
    addLog(LOG_LEVELS.ERROR, `Error: ${error.message}`);
    startBtn.disabled = false;
    startBtn.textContent = 'Start Scrolling';
  }
});