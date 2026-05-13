// ════════════════════════════════════════
//  client/js/dialog.js  —  Mobile-friendly Modal
//  取代原生 confirm() / prompt()
//  回傳 Promise，await 使用
// ════════════════════════════════════════

// 全域 CSS（只插一次）
function _injectStyle() {
  if (document.getElementById('__dlg_style__')) return;
  const s = document.createElement('style');
  s.id = '__dlg_style__';
  s.textContent = `
    .__dlg-backdrop {
      position: fixed; inset: 0; z-index: 99998;
      background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      animation: __dlgFadeIn .15s ease;
    }
    .__dlg-backdrop.__dlg-out {
      animation: __dlgFadeOut .15s ease forwards;
    }
    .__dlg-box {
      background: linear-gradient(160deg,#2a1a4a,#1a2a3a);
      border: 1px solid rgba(255,215,0,0.3);
      border-radius: 20px; padding: 24px 20px;
      width: 100%; max-width: 320px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.6);
      animation: __dlgSlideIn .2s cubic-bezier(.25,1.5,.5,1);
      font-family: 'Noto Serif TC', serif; color: #fff;
    }
    .__dlg-title {
      font-size: 16px; font-weight: bold;
      color: #ffd700; margin-bottom: 10px; line-height: 1.4;
    }
    .__dlg-body {
      font-size: 13px; color: #ccc; line-height: 1.6;
      margin-bottom: 16px; white-space: pre-wrap;
    }
    .__dlg-input {
      width: 100%; background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.25);
      color: #fff; border-radius: 10px;
      padding: 10px 12px; font-size: 15px; outline: none;
      margin-bottom: 16px; box-sizing: border-box;
      font-family: 'Noto Serif TC', serif;
    }
    .__dlg-input:focus { border-color: #ffd700; }
    .__dlg-btns {
      display: flex; gap: 8px;
    }
    .__dlg-btn {
      flex: 1; border: none; border-radius: 12px;
      padding: 12px; font-size: 14px; font-weight: bold;
      cursor: pointer; transition: opacity .15s;
      font-family: 'Noto Serif TC', serif;
    }
    .__dlg-btn:active { opacity: .75; }
    .__dlg-btn-cancel {
      background: rgba(255,255,255,0.12); color: #aaa;
    }
    .__dlg-btn-ok {
      background: linear-gradient(135deg,#ffd700,#ff9900);
      color: #1a0a00;
    }
    .__dlg-btn-danger {
      background: linear-gradient(135deg,#cc3300,#ff5500);
      color: #fff;
    }
    @keyframes __dlgFadeIn   { from { opacity:0; } to { opacity:1; } }
    @keyframes __dlgFadeOut  { from { opacity:1; } to { opacity:0; } }
    @keyframes __dlgSlideIn  {
      from { opacity:0; transform: scale(.88) translateY(12px); }
      to   { opacity:1; transform: scale(1)   translateY(0);    }
    }
  `;
  document.head.appendChild(s);
}

function _close(backdrop, resolve, value) {
  backdrop.classList.add('__dlg-out');
  setTimeout(() => { backdrop.remove(); resolve(value); }, 160);
}

/**
 * 確認對話框（取代 confirm()）
 * @param {string} message
 * @param {object} opts  { title, okText, cancelText, danger }
 * @returns {Promise<boolean>}
 */
function confirm(message, opts = {}) {
  _injectStyle();
  return new Promise(resolve => {
    const { title = '確認', okText = '確定', cancelText = '取消', danger = false } = opts;

    const backdrop = document.createElement('div');
    backdrop.className = '__dlg-backdrop';
    backdrop.innerHTML = `
      <div class="__dlg-box">
        <div class="__dlg-title">${title}</div>
        <div class="__dlg-body">${String(message).replace(/</g,'&lt;')}</div>
        <div class="__dlg-btns">
          <button class="__dlg-btn __dlg-btn-cancel" id="__dlg_cancel">${cancelText}</button>
          <button class="__dlg-btn ${danger ? '__dlg-btn-danger' : '__dlg-btn-ok'}" id="__dlg_ok">${okText}</button>
        </div>
      </div>
    `;

    backdrop.querySelector('#__dlg_ok').onclick     = () => _close(backdrop, resolve, true);
    backdrop.querySelector('#__dlg_cancel').onclick = () => _close(backdrop, resolve, false);
    // 點背景關閉
    backdrop.onclick = (e) => { if (e.target === backdrop) _close(backdrop, resolve, false); };

    document.body.appendChild(backdrop);
    setTimeout(() => backdrop.querySelector('#__dlg_ok')?.focus(), 50);
  });
}

/**
 * 輸入對話框（取代 prompt()）
 * @param {string} message
 * @param {string} defaultValue
 * @param {object} opts  { title, placeholder, okText, cancelText }
 * @returns {Promise<string|null>}  取消返回 null
 */
function prompt(message, defaultValue = '', opts = {}) {
  _injectStyle();
  return new Promise(resolve => {
    const { title = '請輸入', placeholder = '', okText = '確定', cancelText = '取消' } = opts;

    const backdrop = document.createElement('div');
    backdrop.className = '__dlg-backdrop';
    backdrop.innerHTML = `
      <div class="__dlg-box">
        <div class="__dlg-title">${title}</div>
        ${message ? `<div class="__dlg-body">${String(message).replace(/</g,'&lt;')}</div>` : ''}
        <input class="__dlg-input" id="__dlg_inp" value="${String(defaultValue).replace(/"/g,'&quot;')}"
               placeholder="${placeholder}">
        <div class="__dlg-btns">
          <button class="__dlg-btn __dlg-btn-cancel" id="__dlg_cancel">${cancelText}</button>
          <button class="__dlg-btn __dlg-btn-ok"     id="__dlg_ok">${okText}</button>
        </div>
      </div>
    `;

    const inp = backdrop.querySelector('#__dlg_inp');
    backdrop.querySelector('#__dlg_ok').onclick     = () => _close(backdrop, resolve, inp.value || '');
    backdrop.querySelector('#__dlg_cancel').onclick = () => _close(backdrop, resolve, null);
    backdrop.onclick = (e) => { if (e.target === backdrop) _close(backdrop, resolve, null); };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter')  _close(backdrop, resolve, inp.value || '');
      if (e.key === 'Escape') _close(backdrop, resolve, null);
    });

    document.body.appendChild(backdrop);
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  });
}

/**
 * 純提示對話框（只有確定按鈕）
 * @param {string} message
 * @param {object} opts  { title, okText }
 * @returns {Promise<void>}
 */
function alert(message, opts = {}) {
  _injectStyle();
  return new Promise(resolve => {
    const { title = '提示', okText = '確定' } = opts;

    const backdrop = document.createElement('div');
    backdrop.className = '__dlg-backdrop';
    backdrop.innerHTML = `
      <div class="__dlg-box">
        <div class="__dlg-title">${title}</div>
        <div class="__dlg-body">${String(message).replace(/</g,'&lt;')}</div>
        <div class="__dlg-btns">
          <button class="__dlg-btn __dlg-btn-ok" id="__dlg_ok" style="flex:unset;min-width:120px;margin:0 auto">${okText}</button>
        </div>
      </div>
    `;

    backdrop.querySelector('#__dlg_ok').onclick = () => _close(backdrop, resolve, undefined);
    backdrop.onclick = (e) => { if (e.target === backdrop) _close(backdrop, resolve, undefined); };

    document.body.appendChild(backdrop);
    setTimeout(() => backdrop.querySelector('#__dlg_ok')?.focus(), 50);
  });
}

const dialog = { confirm, prompt, alert };
export default dialog;
