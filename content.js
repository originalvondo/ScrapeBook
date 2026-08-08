// Content script for Feed Scroller extension

// Configuration
const SCROLL_DURATION = 5000; // 5 seconds
const COMMENT_SCROLL_DURATION = 5000; // 5 seconds
const SCROLL_INTERVAL = 100; // Scroll every 100ms
const SCROLL_AMOUNT = 300; // Pixels to scroll each time

// Selectors from user requirements
const FEED_SELECTOR = 'div[role="feed"]';
const POST_SELECTOR = 'div.x1n2onr6.xh8yej3.x1ja2u2z.xod5an3';
const COMMENT_SELECTOR = 'div.x78zum5.xdt5ytf';
const POST_DIALOG_SELECTOR = 'div[aria-modal="true"]';
const POST_SCROLLABLE_SECTION_SELECTOR = 'div.xb57i2i.x1q594ok.x5lxg6s.x78zum5.xdt5ytf.x6ikm8r.x1ja2u2z.x1pq812k.x1rohswg.xfk6m8.x1yqm8si.xjx87ck.xx8ngbg.xwo3gff.x1n2onr6.x1oyok0e.x1odjw0f.x1iyjqo2.xy5w88m';
const COMMENTS_CONTAINER_SELECTOR = 'div.html-div.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x1gslohp'; 

// State
let scrollInterval = null;
let isScrolling = false;

// Logging utility - sends logs to popup via chrome.runtime
function log(level, message, data = null) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const logEntry = { level, message, data, timestamp };
  console.log(`[${level.toUpperCase()}] ${message}`, data || '');
  chrome.runtime.sendMessage({ action: 'log', log: logEntry }).catch(() => {});
}

// Convenience log functions
const logInfo = (msg, data) => log('info', msg, data);
const logSuccess = (msg, data) => log('success', msg, data);
const logWarning = (msg, data) => log('warning', msg, data);
const logError = (msg, data) => log('error', msg, data);
const logAction = (msg, data) => log('action', msg, data);

// Scroll down for 5 seconds to load posts
function scrollDownForDuration(duration) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    scrollInterval = setInterval(() => {
      if (Date.now() - startTime >= duration) {
        clearInterval(scrollInterval);
        scrollInterval = null;
        isScrolling = false;
        resolve();
        return;
      }
      
      window.scrollBy(0, SCROLL_AMOUNT);
    }, SCROLL_INTERVAL);
    
    isScrolling = true;
    logAction('Started scrolling feed down', { duration });
  });
}

// Scroll to top of feed container
function scrollToFeedTop() {
  const feed = document.querySelector(FEED_SELECTOR);
  if (feed) {
    feed.scrollIntoView({ behavior: 'smooth', block: 'start' });
    logAction('Scrolling to top of feed');
    return new Promise(resolve => setTimeout(resolve, 500));
  }
  // Fallback: scroll to top of page
  window.scrollTo({ top: 0, behavior: 'smooth' });
  logAction('Scrolling to top of page (fallback)');
  return new Promise(resolve => setTimeout(resolve, 500));
}

// Find the first post and click the "Leave a comment" button
function clickCommentButtonInFirstPost() {
  const feed = document.querySelector(FEED_SELECTOR);
  if (!feed) {
    logError('Feed container not found');
    return;
  }
  
  const posts = feed.querySelectorAll(POST_SELECTOR);
  if (posts.length === 0) {
    logError('No posts found');
    return;
  }
  
  const firstPost = posts[1];
  
  // Find the div with aria-label="Leave a comment" inside the first post
  const commentButton = firstPost.querySelector('div[aria-label="Leave a comment"]');
  
  if (!commentButton) {
    logError('Comment button (aria-label="Leave a comment") not found in first post');
    return;
  }
  
  logAction('Clicking "Leave a comment" button in first post');
  commentButton.click();
}

// Scroll the post scrollable section for 5 seconds to load all comments
function scrollPostScrollableSection() {
  return new Promise((resolve) => {
    // Wait a bit for the post dialog to appear after clicking
    setTimeout(() => {
      const scrollableSection = document.querySelector(POST_SCROLLABLE_SECTION_SELECTOR);
      // if (!scrollableSection) {
      //   logError('Post scrollable section not found');
      //   resolve();
      //   return;
      // }
      
      logAction('Starting to scroll post scrollable section for 5 seconds...');
      const startTime = Date.now();
      
      const scrollInterval = setInterval(() => {
        if (Date.now() - startTime >= COMMENT_SCROLL_DURATION) {
          clearInterval(scrollInterval);
          logSuccess('Finished scrolling post scrollable section');
          
          // Emulate ESC key press to close the dialog
          logAction('Pressing ESC key to close dialog');
          const escEvent = new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            keyCode: 27,
            which: 27,
            bubbles: true
          });
          window.dispatchEvent(escEvent);
          
          resolve();
          return;
        }
        
        // Scroll the scrollable section
        scrollableSection.scrollBy(0, SCROLL_AMOUNT);
      }, SCROLL_INTERVAL);
    }, 1000); // Wait 1 second for post dialog to expand
  });
}

// Main execution function
async function runFeedScroller() {
  if (isScrolling) {
    logWarning('Already scrolling...');
    return;
  }
  
  logInfo('Starting feed scroller...');
  
  // Step 1: Scroll down for 5 seconds
  await scrollDownForDuration(SCROLL_DURATION);
  logSuccess('Finished scrolling down');
  
  // Step 2: Scroll up to top of feed
  await scrollToFeedTop();
  logSuccess('Scrolled to top of feed');
  
  // Step 3: Click "Leave a comment" button in first post
  clickCommentButtonInFirstPost();
  
  // Step 4: Scroll post scrollable section for 5 seconds to load all comments
  await scrollPostScrollableSection();  
  
  logSuccess('Done!');
  
  // Notify popup that we're done
  chrome.runtime.sendMessage({ action: 'complete' });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'start') {
    runFeedScroller();
    sendResponse({ success: true });
  }
  return true;
});

// Also expose function globally for manual testing
window.runFeedScroller = runFeedScroller;

console.log('Feed Scroller content script loaded');