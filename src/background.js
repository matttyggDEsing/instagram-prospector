// IG Growth Prospector - Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  console.log('IG Growth Prospector instalado correctamente.');
});

// Relay messages entre popup y content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ tab: tabs[0] });
    });
    return true;
  }
});
