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

// Automatically inject content script into all existing Facebook tabs on install / reload
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
