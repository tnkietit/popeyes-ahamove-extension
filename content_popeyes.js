// Content script for Popeyes page (popeyes.beeiq.co)
// This script runs on the Popeyes page and can be used for additional scraping if needed

console.log('[Popeyes Extension] Content script loaded on Popeyes page');

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scrape') {
    const data = scrapeOrder();
    sendResponse(data);
  }
  return true;
});

function scrapeOrder() {
  try {
    const allElements = [...document.querySelectorAll('*')];
    
    function findValueNear(labelText) {
      for (const el of allElements) {
        if (el.childElementCount === 0) {
          const text = el.textContent.trim();
          if (text === labelText || text.startsWith(labelText)) {
            // Try next sibling
            let next = el.nextElementSibling;
            if (next && next.childElementCount === 0) return next.textContent.trim();
            
            // Try parent row
            const row = el.closest('tr');
            if (row) {
              const cells = row.querySelectorAll('td');
              if (cells.length > 1) return cells[cells.length - 1].textContent.trim();
            }
            
            // Try parent div siblings
            const parent = el.parentElement;
            if (parent) {
              next = parent.nextElementSibling;
              if (next) return next.textContent.trim();
            }
          }
        }
      }
      return null;
    }

    const name = findValueNear('Tên người nhận');
    const phone = findValueNear('Số điện thoại người nhận') || findValueNear('Số điện thoại');
    const address = findValueNear('Địa chỉ người nhận') || findValueNear('Địa chỉ');
    const price = findValueNear('Trị giá');

    return { name, phone, address, price };
  } catch (e) {
    return { error: e.message };
  }
}
