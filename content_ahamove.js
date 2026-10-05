// Content script for Ahamove (app.ahamove.com)
console.log('[Popeyes Extension] Ahamove content script loaded');

let autofillPayload = null;
let autofillDone = false; // chi chay 1 lan duy nhat

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'startAutofill' && msg.payload && !autofillDone) {
    autofillDone = true;
    autofillPayload = msg.payload;
    startAutofillProcess(autofillPayload);
    sendResponse({ ok: true });
  }
  return true;
});

window.addEventListener('load', async () => {
  const stored = await chrome.storage.local.get(['ahamovePayload', 'ahamoveReady']);
  if (stored.ahamoveReady && stored.ahamovePayload && !autofillDone) {
    autofillDone = true;
    // Xoa flag ngay de khong chay lai neu refresh
    await chrome.storage.local.set({ ahamoveReady: false });
    autofillPayload = stored.ahamovePayload;
    setTimeout(() => startAutofillProcess(autofillPayload), 3000);
  }
});

// ==================== HELPERS ====================

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => console.log('[Popeyes Extension]', msg);

function getByXPath(xpath) {
  return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

// Tìm input dựa trên thẻ Label hoặc Span chứa chữ tương ứng ở gần nó
function findInputByLabelText(labelText) {
  const selectors = ['label', 'span', 'p', 'div'];
  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll(selector));
    for (const el of elements) {
      if (el.textContent.trim().toLowerCase().includes(labelText.toLowerCase())) {
        const parent = el.closest('div');
        if (parent) {
          const input = parent.querySelector('input, textarea');
          if (input) return input;
        }
      }
    }
  }
  return null;
}

// Dien Mantine input bang execCommand (cach duy nhat hoat dong voi Mantine UI)
async function fillMantine(input, value) {
  input.click();
  await sleep(80);
  input.focus();
  await sleep(80);
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, value);
  await sleep(50);
}

// Fill input thuong (non-Mantine) - dung native setter
function fillInput(input, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  input.focus();
  nativeSetter.call(input, value);
  ['input', 'change'].forEach(evt => input.dispatchEvent(new Event(evt, { bubbles: true })));
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  input.blur();
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}

// Fill dia chi - khong blur de autocomplete hien
function fillAddressInput(input, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  input.click();
  input.focus();
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event('focus', { bubbles: true }));
  input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
}

function showNotification(msg, type) {
  type = type || 'info';
  const existing = document.getElementById('popeyes-ext-notif');
  if (existing) existing.remove();
  const colors = { info: '#1565c0', success: '#2e7d32', error: '#c62828' };
  const el = document.createElement('div');
  el.id = 'popeyes-ext-notif';
  el.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;background:' + (colors[type]||colors.info) + ';color:white;padding:14px 20px;border-radius:10px;font-size:14px;font-family:-apple-system,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:320px;line-height:1.5';
  el.innerHTML = '🍗 <strong>Popeyes Extension</strong><br>' + msg;
  document.body.appendChild(el);
  if (type === 'success') setTimeout(function(){ el.remove(); }, 5000);
}

// ==================== MAIN ====================

async function startAutofillProcess(payload) {
  log('Starting: ' + JSON.stringify(payload));
  showNotification('Dang tu dong dien thong tin...', 'info');
  try {
    await sleep(1000);
    await step1_fillAddress(payload.address);
    await step2_selectFirstDropdown(payload.address);
    await step3_ensureFormOpen();
    await step4_fillRecipientInfo(payload);
    await step5_clickSave();
    await step6_fillWeight();
    await step6b_khaiGia();
    await step7_selectFoodCategory();
    showNotification('Hoan tat!', 'success');
  } catch (err) {
    log('Error: ' + err.message);
    showNotification('Loi: ' + err.message, 'error');
  }
}

// STEP 1: Dien dia chi chinh
async function step1_fillAddress(address) {
  log('Step 1: ' + address);
  let inp = null;
  const start = Date.now();
  while (Date.now() - start < 15000 && !inp) {
    inp = Array.from(document.querySelectorAll('input')).find(el => 
      (el.placeholder || '').includes('giao') || (el.placeholder || '').includes('đến đâu')
    );
    if (!inp) await sleep(400);
  }
  if (!inp) throw new Error('Khong tim thay o dia chi');
  fillAddressInput(inp, address);
  await sleep(2500);
  log('Step 1 done');
}

// STEP 2: Chon dropdown dau tien
async function step2_selectFirstDropdown(address) {
  log('Step 2: Selecting dropdown for: ' + address);
  await sleep(800);

  const excludeTexts = [
    'tôi là người nhận', 'toi la nguoi nhan',
    'thêm điểm giao', 'them diem giao',
    'hoán đổi', 'hoan doi', 'ẩn bản đồ',
    'đổi dịch vụ', 'không tìm thấy', 'hiển thị thêm',
  ];

  function getAddressItems() {
    // Lay cac the button dai dien cho ket qua goi y trong dropdown
    const candidates = document.querySelectorAll('button');
    const items = [];
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width > 50 && r.height > 10 && r.top > 100) {
        const text = el.textContent.trim().toLowerCase();
        if (excludeTexts.some(ex => text.includes(ex))) continue;
        if (text.length < 5) continue;
        
        // Kiem tra xem button co phai la goi y dia chi trong dropdown khong
        const isSuggestion = el.className.includes('active:bg-neutral-5') || 
                             el.querySelector('div[class*="text-neutral-90"]') ||
                             el.closest('div.z-50');
                             
        if (isSuggestion) {
          items.push(el);
        }
      }
    }
    return items;
  }

  // Lay input dia chi
  const addrInp = Array.from(document.querySelectorAll('input')).find(inp => 
    (inp.placeholder || '').includes('giao') || (inp.placeholder || '').includes('đến đâu')
  );

  async function typeAddress(addr) {
    if (!addrInp) return;
    addrInp.click();
    addrInp.focus();
    await sleep(100);
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(addrInp, addr);
    addrInp.dispatchEvent(new Event('focus', { bubbles: true }));
    addrInp.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: addr }));
    addrInp.dispatchEvent(new Event('change', { bubbles: true }));
    addrInp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    await sleep(1500); // doi dropdown hien
  }

  // Dung dia chi tu payload, khong doc tu input
  let parts = address.split(',').map(p => p.trim()).filter(Boolean);

  let clicked = false;

  // Thu toi da 5 lan: lan dau full, roi rut dan tung phan cuoi
  for (let attempt = 0; attempt < parts.length && !clicked; attempt++) {
    if (attempt > 0) {
      // Rut ngan: bo phan cuoi
      parts = parts.slice(0, -1);
      const shortened = parts.join(', ');
      if (!shortened || shortened.length < 5) break;
      log('Retrying with shortened address: ' + shortened);
      await typeAddress(shortened);
    }

    // Doi ket qua xuat hien (toi da 3s)
    const waitStart = Date.now();
    while (Date.now() - waitStart < 3000 && !clicked) {
      const items = getAddressItems();
      if (items.length > 0) {
        items[0].click();
        clicked = true;
        log('Clicked: ' + items[0].textContent.trim().slice(0, 50));
      }
      if (!clicked) await sleep(300);
    }
  }

  if (!clicked) {
    log('WARNING: No dropdown selected after all retries, continuing...');
  }

  await sleep(1000);
  log('Step 2 done');
}

// STEP 3: Dam bao form mo
async function step3_ensureFormOpen() {
  log('Step 3: Checking form');
  await sleep(400);
  function isFormOpen() {
    return !!findInputByLabelText('Tên người nhận');
  }
  if (isFormOpen()) { log('Form open'); return; }
  // Thu click "Them chi tiet dia diem"
  const start = Date.now();
  while (Date.now() - start < 5000) {
    for (const el of document.querySelectorAll('p,span,div,a,button')) {
      const text = el.textContent.trim();
      if (text.includes('chi tiết địa điểm')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { el.click(); await sleep(600); return; }
      }
      // Tuyet doi khong click "Toi la nguoi nhan"
      if (text.includes('là người nhận') || text.includes('la nguoi nhan')) continue;
    }
    await sleep(400);
  }
  log('Step 3 done');
}

// STEP 4: Dien thong tin nguoi nhan
async function step4_fillRecipientInfo(payload) {
  log('Step 4: Filling info');

  // Doi cac o input xuat hien trong form (Tên người nhận, Số điện thoại)
  let nameInp = null;
  let phoneInp = null;
  let noteInp = null;

  const start = Date.now();
  while (Date.now() - start < 12000) {
    nameInp = findInputByLabelText('Tên người nhận');
    phoneInp = findInputByLabelText('Số điện thoại');
    noteInp = findInputByLabelText('Ghi chú địa chỉ');
    if (nameInp && phoneInp) break;
    await sleep(500);
  }

  if (!nameInp || !phoneInp) {
    throw new Error('Khong tim thay o nhap Ten nguoi nhan hoac So dien thoai');
  }

  // Dien Ghi chu dia chi
  if (noteInp) {
    await fillMantine(noteInp, payload.address);
    log('Filled Ghi chu dia chi: ' + payload.address);
    await sleep(200);
  }

  // Dien Ten nguoi nhan
  await fillMantine(nameInp, payload.name);
  log('Filled name: ' + payload.name);
  await sleep(200);

  // Dien So dien thoai
  await fillMantine(phoneInp, payload.phone);
  log('Filled phone: ' + payload.phone);
  await sleep(200);

  // item_value va cod: cung gia tri
  const val = payload.cod === 0 ? '0' : String(payload.cod);

  const itemInput = document.querySelector('input[name="item_value"]');
  if (itemInput) {
    await fillMantine(itemInput, val);
    log('Filled item_value: ' + val);
    await sleep(200);
  }

  const codInput = document.querySelector('input[name="cod"]');
  if (codInput) {
    await fillMantine(codInput, val);
    log('Filled cod: ' + val);
    await sleep(200);
  }
  log('Step 4 done');
}

// STEP 5: Bam Luu
async function step5_clickSave() {
  log('Step 5: Clicking Luu');
  await sleep(400);
  const start = Date.now();
  while (Date.now() - start < 6000) {
    for (const btn of document.querySelectorAll('button')) {
      const r = btn.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0 && r.top > 0 && r.top < window.innerHeight;
      if (visible && btn.textContent.trim().toLowerCase() === 'lưu') {
        btn.click(); log('Clicked Luu');
        await sleep(1200);
        return;
      }
    }
    await sleep(300);
  }
  log('Warning: Luu not found');
}

// STEP 6: Nhap khoi luong = 5
async function step6_fillWeight() {
  log('Step 6: Weight');
  // Doi form nguoi nhan dong - truong "Ten nguoi nhan" bien mat khoi DOM
  const start0 = Date.now();
  while (Date.now() - start0 < 5000) {
    const nameInp = findInputByLabelText('Tên người nhận');
    if (!nameInp) break;
    await sleep(300);
  }
  await sleep(300);

  let weightInput = null;
  const start = Date.now();
  while (Date.now() - start < 5000 && !weightInput) {
    weightInput = document.getElementById('weight-section');
    if (!weightInput) {
      for (const inp of document.querySelectorAll('input')) {
        const ph = inp.placeholder || '';
        const r = inp.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (ph.includes('khối') || ph.includes('weight') || inp.id === 'weight-section')) {
          weightInput = inp; break;
        }
      }
    }
    if (!weightInput) await sleep(200);
  }

  if (weightInput) {
    await fillMantine(weightInput, '5');
    log('Filled weight: 5');
  } else {
    log('WARNING: Weight not found');
  }
  log('Step 6 done');
}

// STEP 6b: Chon "Khong khai gia hang hoa"
async function step6b_khaiGia() {
  log('Step 6b: Khai gia hang hoa');
  await sleep(400);

  let triggerBtn = null;

  // Tim the la (không chua the con) co text chua tu khoa Khai gia hang hoa
  const startTrig = Date.now();
  while (Date.now() - startTrig < 5000 && !triggerBtn) {
    for (const el of document.querySelectorAll('span, p, div, button')) {
      if (el.childElementCount === 0 && (el.textContent.trim().includes('Khai giá hàng hoá') || el.textContent.trim().includes('khai giá') || el.textContent.trim().includes('Chọn Khai giá'))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          // Lay the button gan nhat bọc ngoài thẻ chữ này
          triggerBtn = el.closest('button, [role="button"]') || el.parentElement || el;
          break;
        }
      }
    }
    if (!triggerBtn) await sleep(300);
  }

  if (triggerBtn) {
    triggerBtn.click();
    log('Clicked khai gia trigger');
    await sleep(500); // Cho mot lat de form khai gia hien ra
  } else {
    log('WARNING: Khai gia trigger not found');
    return;
  }

  let khongKhaiGiaBtn = null;

  // Tim dung the text "Không khai giá hàng hóa" voi vong lap cho doi (retry loop) len toi 5s
  const waitStart = Date.now();
  while (Date.now() - waitStart < 5000 && !khongKhaiGiaBtn) {
    for (const el of document.querySelectorAll('div, span, p, label, button')) {
      if (el.textContent.trim() === 'Không khai giá hàng hóa') {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          khongKhaiGiaBtn = el;
          break;
        }
      }
    }
    if (!khongKhaiGiaBtn) await sleep(200);
  }

  if (khongKhaiGiaBtn) {
    // Click vao the button boc ngoai (co code su kien) hoac parent, hoac chinh no
    const clickable = khongKhaiGiaBtn.closest('button, [role="button"]') || khongKhaiGiaBtn.parentElement || khongKhaiGiaBtn;
    clickable.click();
    log('Selected: Khong khai gia hang hoa');
  } else {
    log('WARNING: Khong khai gia button not found');
  }

  await sleep(200);
  log('Step 6b done');
}

// STEP 7: Chon Thuc pham kho / dong goi
async function step7_selectFoodCategory() {
  log('Step 7: Food category');
  await sleep(200);
  let btn = null;
  const start = Date.now();
  while (Date.now() - start < 5000 && !btn) {
    for (const el of document.querySelectorAll('button,span,p')) {
      const t = el.textContent.trim();
      if (t.includes('Thực phẩm') || t.includes('đóng gói')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top > 0 && r.top < window.innerHeight) { btn = el; break; }
      }
    }
    if (!btn) await sleep(300);
  }
  if (btn) { btn.click(); log('Clicked food category'); }
  else { log('WARNING: Food button not found'); }
  log('Step 7 done');
}
