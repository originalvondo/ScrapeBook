// Popup script for Feed Scroller extension

const startBtn = document.getElementById('startBtn');
const statusDiv = document.getElementById('status');

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.textContent = 'Running...';
  statusDiv.textContent = 'Starting...';
  statusDiv.className = 'status';
  
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
      statusDiv.textContent = 'Started! Scrolling for 5 seconds...';
      statusDiv.className = 'status success';
    } else {
      throw new Error('Failed to start');
    }
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'status error';
    startBtn.disabled = false;
    startBtn.textContent = 'Start Scrolling';
  }
});

// Listen for completion message from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'complete') {
    startBtn.disabled = false;
    startBtn.textContent = 'Start Scrolling';
    statusDiv.textContent = 'Done! Clicked 2nd div in first post.';
    statusDiv.className = 'status success';
  }
});