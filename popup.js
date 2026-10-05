let orderData = null;
let paymentMode = null;

function showStatus(msg, type) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = 'status ' + type;
}

function hideStatus() {
  const el = document.getElementById('status-msg');
  el.className = 'status';
  el.style.display = 'none';
}

function selectPayment(mode) {
  paymentMode = mode;
  document.getElementById('btn-paid').classList.toggle('selected', mode === 'paid');
  document.getElementById('btn-unpaid').classList.toggle('selected', mode === 'unpaid');
  document.getElementById('send-btn').disabled = false;
}

async function scanOrder() {
  hideStatus();
  const btn = document.getElementById('scan-btn');
  btn.textContent = '⏳ Đang đọc...';
  btn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url || !tab.url.includes('popeyes.beeiq.co')) {
      document.getElementById('main-content').style.display = 'none';
      document.getElementById('not-on-popeyes').style.display = 'block';
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapePopeyesData
    });

    const data = results[0].result;

    if (!data || data.error) {
      showStatus('❌ ' + (data?.error || 'Không đọc được thông tin. Hãy mở đơn hàng cụ thể.'), 'error');
      return;
    }

    orderData = data;
    displayOrderInfo(data);
    showStatus('✅ Đọc thông tin thành công!', 'success');

  } catch (err) {
    showStatus('❌ Lỗi: ' + err.message, 'error');
  } finally {
    btn.textContent = '🔍 Đọc lại thông tin';
    btn.disabled = false;
  }
}

function displayOrderInfo(data) {
  document.getElementById('disp-name').textContent = data.name || '—';
  document.getElementById('disp-phone').textContent = data.phone || '—';
  document.getElementById('disp-address').textContent = data.address || '—';
  document.getElementById('disp-price').textContent = data.priceRaw ? data.priceRaw.toLocaleString('vi-VN') : '—';

  // Sync edit inputs
  document.getElementById('edit-name').value = data.name || '';
  document.getElementById('edit-phone').value = data.phone || '';
  document.getElementById('edit-address').value = data.address || '';
  document.getElementById('edit-price').value = data.priceRaw || 0;

  document.getElementById('order-info').classList.add('visible');
  document.getElementById('payment-section').style.display = 'block';
}

async function sendToAhamove() {
  if (!paymentMode) {
    showStatus('⚠️ Vui lòng chọn trạng thái thanh toán', 'info');
    return;
  }

  // Đọc từ edit input nếu đang mở, ngược lại đọc từ display
  const name = document.getElementById('edit-name').value.trim() || document.getElementById('disp-name').textContent;
  const phone = document.getElementById('edit-phone').value.trim() || document.getElementById('disp-phone').textContent;
  const address = document.getElementById('edit-address').value.trim() || document.getElementById('disp-address').textContent;
  const priceRaw = parseInt(document.getElementById('edit-price').value) || orderData?.priceRaw || 0;

  const codValue = paymentMode === 'paid' ? 0 : priceRaw;
  const payload = {
    name,
    phone,
    address,
    cod: codValue,
    paymentMode
  };

  // Save to storage for content script to pick up
  await chrome.storage.local.set({ ahamovePayload: payload, ahamoveReady: true });

  showStatus('🚀 Đang mở Ahamove...', 'info');

  // Luon mo tab moi de dat don moi, khong dung lai tab cu
  await chrome.tabs.create({ url: 'https://app.ahamove.com/v3' });

  window.close();
}

// The function that runs IN the Popeyes page context
function scrapePopeyesData() {
  try {
    // Helper to get text by searching labels in the page
    function findValueByLabel(labelText) {
      const allTds = document.querySelectorAll('td, th, div, span, p, label');
      for (const el of allTds) {
        if (el.childElementCount === 0 && el.textContent.trim() === labelText) {
          // Try next sibling or parent's next sibling
          let next = el.nextElementSibling;
          if (next) return next.textContent.trim();
          const parent = el.parentElement;
          if (parent) {
            next = parent.nextElementSibling;
            if (next) return next.textContent.trim();
          }
        }
      }
      return null;
    }

    // Try to find order details table rows
    function findRowValue(label) {
      // Look for rows with label in first cell, value in second
      const rows = document.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td, th');
        if (cells.length >= 2) {
          const labelCell = cells[0].textContent.trim();
          if (labelCell.includes(label)) {
            return cells[1].textContent.trim();
          }
        }
      }

      // Also check divs with label/value pattern
      const divs = document.querySelectorAll('div');
      for (const div of divs) {
        const text = div.textContent.trim();
        if (text === label) {
          // Look for sibling or nearby value
          const next = div.nextElementSibling;
          if (next) return next.textContent.trim();
        }
      }
      return null;
    }

    // Strategy: scan all visible text for recognizable patterns
    const pageText = document.body.innerText;

    // Find price - look for ₫ or đ patterns
    let price = null;
    let priceFormatted = null;
    let priceRaw = 0;

    // Look for "Trị giá" label
    const triGiaMatch = pageText.match(/Trị giá[\s\S]{0,20}?([\d.,]+(?:\s*₫|\s*đ|\s*VND)?)/i);
    if (triGiaMatch) {
      priceFormatted = triGiaMatch[1].trim();
      priceRaw = parseInt(priceFormatted.replace(/[^\d]/g, '')) || 0;
    }

    // Try DOM-based approach for price
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.childElementCount === 0) {
        const text = el.textContent.trim();
        if (text === 'Trị giá' || text === 'Trị Giá') {
          // Search nearby
          const parent = el.closest('tr, div.row, div');
          if (parent) {
            const valueEls = parent.querySelectorAll('td, span, div');
            for (const v of valueEls) {
              if (v !== el && v.childElementCount === 0) {
                const vt = v.textContent.trim();
                if (vt.match(/[\d.,]+/) && (vt.includes('₫') || vt.includes('đ') || vt.match(/^\d[\d.,]+$/))) {
                  priceFormatted = vt;
                  priceRaw = parseInt(vt.replace(/[^\d]/g, '')) || 0;
                  break;
                }
              }
            }
          }
        }
      }
    }

    // Find recipient name - look for "Tên người nhận"
    let name = null;
    for (const el of allElements) {
      if (el.childElementCount === 0) {
        const text = el.textContent.trim();
        if (text === 'Tên người nhận' || text === 'Tên người nhận:') {
          const parent = el.closest('tr, div');
          if (parent) {
            const sibs = parent.querySelectorAll('td, span, div');
            for (const s of sibs) {
              if (s !== el && s.childElementCount === 0 && s.textContent.trim().length > 1) {
                name = s.textContent.trim();
                break;
              }
            }
          }
          if (!name) {
            const next = el.nextElementSibling;
            if (next) name = next.textContent.trim();
          }
        }
      }
    }

    // Find phone - look for "Số điện thoại người nhận"
    let phone = null;
    for (const el of allElements) {
      if (el.childElementCount === 0) {
        const text = el.textContent.trim();
        if (text.includes('Số điện thoại') || text === 'Số điện thoại người nhận') {
          const parent = el.closest('tr, div');
          if (parent) {
            const sibs = parent.querySelectorAll('td, span, div');
            for (const s of sibs) {
              if (s !== el && s.childElementCount === 0) {
                const sv = s.textContent.trim();
                if (sv.match(/^[0-9+\-\s]{9,15}$/)) {
                  phone = sv.replace(/\s/g, '');
                  break;
                }
              }
            }
          }
        }
      }
    }

    // Find address - look for "Địa chỉ người nhận"
    let address = null;
    for (const el of allElements) {
      if (el.childElementCount === 0) {
        const text = el.textContent.trim();
        if (text === 'Địa chỉ người nhận' || text === 'Địa chỉ người nhận:') {
          const parent = el.closest('tr, div');
          if (parent) {
            const sibs = parent.querySelectorAll('td, span, div, p');
            for (const s of sibs) {
              if (s !== el && s.childElementCount === 0 && s.textContent.trim().length > 5) {
                address = s.textContent.trim();
                break;
              }
            }
          }
          if (!address) {
            let next = el.nextElementSibling || el.parentElement?.nextElementSibling;
            while (next) {
              const t = next.textContent.trim();
              if (t.length > 5) { address = t; break; }
              next = next.nextElementSibling;
            }
          }
        }
      }
    }

    // Fallback: use regex on page text for phone
    if (!phone) {
      const phoneMatch = pageText.match(/(?:Số điện thoại|SĐT|Phone)[^\d]*(0\d{9,10}|\+84\d{9,10})/i);
      if (phoneMatch) phone = phoneMatch[1];
    }

    // Fallback for name from page text
    if (!name) {
      const nameMatch = pageText.match(/Tên người nhận[:\s]+([^\n]+)/i);
      if (nameMatch) name = nameMatch[1].trim();
    }

    // Fallback for address
    if (!address) {
      const addrMatch = pageText.match(/Địa chỉ người nhận[:\s]+([^\n]+)/i);
      if (addrMatch) address = addrMatch[1].trim();
    }

    if (!name && !phone && !address) {
      return { error: 'Không tìm thấy thông tin đơn hàng. Hãy mở chi tiết đơn hàng cụ thể.' };
    }

    // Lam sach ten: bo " - ONLINE ORDERING", " - CC", v.v.
    if (name) {
      name = name
        .replace(/\s*-\s*ONLINE ORDERING\s*/gi, '')
        .replace(/\s*-\s*ONLINE\s*/gi, '')
        .replace(/\s*-\s*CC\b.*/gi, '')
        .trim();
    }

    // Lam sach dia chi:
    // Dang 1: "Vietnam (dia chi thuc)" -> lay trong ngoac
    // Dang 2: "Dia chi thuc (ghi chu)" -> lay ngoai ngoac, bo phan trong ngoac
    if (address) {
      const match = address.match(/^[^(]*\((.+)\)\s*$/);
      if (match) {
        const outside = address.replace(/\s*\([^)]*\)\s*$/, '').trim();
        const inside = match[1].trim();
        if (!outside || outside.toLowerCase() === 'vietnam') {
          address = inside;
        } else {
          address = outside;
        }
      }
      // Bo "Khu pho X", "KP.X", "To X", "KP X" vi Ahamove khong tim duoc
      address = address
        .replace(/,?\s*Khu [Pp]h[ốo]\s*\d+/g, '')
        .replace(/,?\s*KP\.?\s*\d+/g, '')
        .replace(/,?\s*T[ổo]\s*\d+/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/^,\s*/, '')
        .trim();
    }

    return {
      name: name || '',
      phone: phone || '',
      address: address || '',
      priceFormatted: priceFormatted || '0đ',
      priceRaw: priceRaw || 0
    };
  } catch (e) {
    return { error: e.message };
  }
}

function toggleEdit(field) {
  const editEl = document.getElementById('edit-' + field);
  const dispEl = document.getElementById('disp-' + field);
  const isHidden = editEl.style.display === 'none';

  if (isHidden) {
    // Mo edit: sync gia tri hien tai vao input
    if (field === 'price') {
      editEl.value = orderData?.priceRaw || parseInt(dispEl.textContent.replace(/\D/g,'')) || 0;
    } else {
      editEl.value = dispEl.textContent === '—' ? '' : dispEl.textContent;
    }
    editEl.style.display = '';
    editEl.focus();
    editEl.select?.();
  } else {
    editEl.style.display = 'none';
  }
}

function syncField(field) {
  const editEl = document.getElementById('edit-' + field);
  const dispEl = document.getElementById('disp-' + field);
  const val = editEl.value.trim();

  if (field === 'price') {
    const num = parseInt(editEl.value) || 0;
    dispEl.textContent = num ? num.toLocaleString('vi-VN') : '—';
    if (orderData) orderData.priceRaw = num;
  } else {
    dispEl.textContent = val || '—';
    if (orderData) orderData[field] = val;
  }
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !tab.url.includes('popeyes.beeiq.co')) {
    document.getElementById('main-content').style.display = 'none';
    document.getElementById('not-on-popeyes').style.display = 'block';
    return;
  }

  document.getElementById('scan-btn').addEventListener('click', scanOrder);
  document.getElementById('btn-paid').addEventListener('click', () => selectPayment('paid'));
  document.getElementById('btn-unpaid').addEventListener('click', () => selectPayment('unpaid'));
  document.getElementById('send-btn').addEventListener('click', sendToAhamove);

  // Edit buttons
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleEdit(btn.dataset.field));
  });
  document.querySelectorAll('.field-edit').forEach(el => {
    el.addEventListener('input', () => syncField(el.dataset.sync));
  });

  // Check if we have cached data
  const stored = await chrome.storage.local.get('lastOrderData');
  if (stored.lastOrderData) {
    orderData = stored.lastOrderData;
    displayOrderInfo(orderData);
  }
});
