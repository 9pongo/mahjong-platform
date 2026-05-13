// ════════════════════════════════════════
//  client/js/toast.js  —  統一 Toast 通知
//  取代原生 alert()，支援 success/error/warn/info
//  ES Module，無外部依賴
// ════════════════════════════════════════

const COLORS = {
  success: { bg: 'rgba(30,180,80,0.95)',  icon: '✅' },
  error:   { bg: 'rgba(200,40,40,0.95)',  icon: '❌' },
  warn:    { bg: 'rgba(200,130,0,0.95)',  icon: '⚠️' },
  info:    { bg: 'rgba(30,120,200,0.95)', icon: 'ℹ️' },
};

// 建立容器（只建一次）
function _getContainer() {
  let c = document.getElementById('__toast_container__');
  if (c) return c;
  c = document.createElement('div');
  c.id = '__toast_container__';
  Object.assign(c.style, {
    position:      'fixed',
    top:           '16px',
    left:          '50%',
    transform:     'translateX(-50%)',
    zIndex:        '99999',
    display:       'flex',
    flexDirection: 'column',
    alignItems:    'center',
    gap:           '8px',
    pointerEvents: 'none',
    width:         'min(90vw, 360px)',
  });
  // 全域 CSS（只插一次）
  if (!document.getElementById('__toast_style__')) {
    const style = document.createElement('style');
    style.id = '__toast_style__';
    style.textContent = `
      .__toast {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 12px 16px; border-radius: 14px;
        font-family: 'Noto Serif TC', serif; font-size: 14px;
        color: #fff; line-height: 1.4; box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        cursor: pointer; pointer-events: auto;
        animation: __toastIn .25s cubic-bezier(.25,1.5,.5,1) forwards;
        max-width: 100%; word-break: break-word;
      }
      .__toast.__toast-out {
        animation: __toastOut .2s ease forwards;
      }
      .__toast-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
      .__toast-msg  { flex: 1; }
      @keyframes __toastIn {
        from { opacity: 0; transform: translateY(-16px) scale(.92); }
        to   { opacity: 1; transform: translateY(0)    scale(1);    }
      }
      @keyframes __toastOut {
        from { opacity: 1; transform: translateY(0) scale(1);        max-height: 80px; }
        to   { opacity: 0; transform: translateY(-8px) scale(.96);   max-height: 0;    }
      }
    `;
    document.head.appendChild(style);
  }
  document.body.appendChild(c);
  return c;
}

function show(message, type = 'info', duration = 3000) {
  const container = _getContainer();
  const cfg = COLORS[type] || COLORS.info;

  const el = document.createElement('div');
  el.className = '__toast';
  el.style.background = cfg.bg;
  el.innerHTML = `
    <span class="__toast-icon">${cfg.icon}</span>
    <span class="__toast-msg">${String(message).replace(/</g,'&lt;')}</span>
  `;

  // 點擊立即關閉
  el.addEventListener('click', () => dismiss(el));

  container.appendChild(el);

  // 自動消失
  const timer = setTimeout(() => dismiss(el), duration);
  el._toastTimer = timer;
}

function dismiss(el) {
  if (!el || el.classList.contains('__toast-out')) return;
  clearTimeout(el._toastTimer);
  el.classList.add('__toast-out');
  setTimeout(() => el.remove(), 220);
}

const toast = {
  show,
  success: (msg, dur = 3000) => show(msg, 'success', dur),
  error:   (msg, dur = 4000) => show(msg, 'error',   dur),
  warn:    (msg, dur = 3500) => show(msg, 'warn',    dur),
  info:    (msg, dur = 3000) => show(msg, 'info',    dur),
};

export default toast;
