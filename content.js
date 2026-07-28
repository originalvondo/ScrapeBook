// Content script for Feed Scroller extension

// Configuration
const SCROLL_DURATION = 5000; // 5 seconds
const SCROLL_INTERVAL = 100; // Scroll every 100ms
const SCROLL_AMOUNT = 300; // Pixels to scroll each time

// Selectors from user requirements
const FEED_SELECTOR = 'div[role="feed"]';
const POST_SELECTOR = 'div.x1n2onr6.xh8yej3.x1ja2u2z.xod5an3';
const POST_CONTAINER_SELECTOR = 'div.x9f619.x1ja2u2z.x78zum5.x2lah0s.x1n2onr6.x1qughib.x6s0dn4.xozqiw3.x1q0g3np.x11lfxj5.x135b78x.x18d9i69.xexx8yu.x4cne27.xifccgj';

// State
let scrollInterval = null;
let isScrolling = false;

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
  });
}

// Scroll to top of feed container
function scrollToFeedTop() {
  const feed = document.querySelector(FEED_SELECTOR);
  if (feed) {
    feed.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return new Promise(resolve => setTimeout(resolve, 500)); // Wait for smooth scroll
  }
  // Fallback: scroll to top of page
  window.scrollTo({ top: 0, behavior: 'smooth' });
  return new Promise(resolve => setTimeout(resolve, 500));
}

// Find the first post and click the 2nd div in its container
function clickSecondDivInFirstPost() {
  const feed = document.querySelector(FEED_SELECTOR);
  if (!feed) {
    console.log('Feed container not found');
    return;
  }
  
  const posts = feed.querySelectorAll(POST_SELECTOR);
  if (posts.length === 0) {
    console.log('No posts found');
    return;
  }
  
  const firstPost = posts[0];
  const container = firstPost.querySelector(POST_CONTAINER_SELECTOR);
  
  if (!container) {
    console.log('Post container not found in first post');
    return;
  }
  
  const childDivs = container.querySelectorAll(':scope > div');
  if (childDivs.length < 2) {
    console.log('Less than 2 div elements found in container');
    return;
  }
  
  const secondDiv = childDivs[1];
  console.log('Clicking 2nd div in first post container');
  secondDiv.click();
}

// Main execution function
async function runFeedScroller() {
  if (isScrolling) {
    console.log('Already scrolling...');
    return;
  }
  
  console.log('Starting feed scroller...');
  
  // Step 1: Scroll down for 5 seconds
  await scrollDownForDuration(SCROLL_DURATION);
  console.log('Finished scrolling down');
  
  // Step 2: Scroll up to top of feed
  await scrollToFeedTop();
  console.log('Scrolled to top of feed');
  
  // Step 3: Click 2nd div in first post
  clickSecondDivInFirstPost();
  console.log('Done!');
  
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