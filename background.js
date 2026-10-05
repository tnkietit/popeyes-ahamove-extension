// Background service worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('Popeyes → Ahamove extension installed');
});

// Listen for tab updates to trigger autofill on Ahamove
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('app.ahamove.com')) {
    const stored = await chrome.storage.local.get(['ahamovePayload', 'ahamoveReady']);
    if (stored.ahamoveReady && stored.ahamovePayload) {
      // Small delay to let the page fully render
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tabId, {
            action: 'startAutofill',
            payload: stored.ahamovePayload
          });
          // Xoa flag ngay sau khi gui
          await chrome.storage.local.set({ ahamoveReady: false });
        } catch (e) {
          console.log('Content script not ready yet, retrying...', e);
          // Retry after another delay
          setTimeout(async () => {
            try {
              await chrome.tabs.sendMessage(tabId, {
                action: 'startAutofill',
                payload: stored.ahamovePayload
              });
              await chrome.storage.local.set({ ahamoveReady: false });
            } catch (e2) {
              console.error('Failed to send message:', e2);
            }
          }, 3000);
        }
      }, 2500);
    }
  }
});
