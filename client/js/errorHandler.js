// ════════════════════════════════════════
//  client/js/errorHandler.js
//  前端全域錯誤邊界 & Sentry 輕量追蹤
//  在 HTML <head> 最前面載入（非 module）
// ════════════════════════════════════════

(function () {
  'use strict';

  // ── Sentry 瀏覽器 SDK（可選，由後端注入 DSN） ─
  // 若頁面 meta[name=sentry-dsn] 存在則載入
  const sentryDsnMeta = document.querySelector('meta[name="sentry-dsn"]');
  const SENTRY_DSN    = sentryDsnMeta?.content;

  let _sentryLoaded = false;
  if (SENTRY_DSN) {
    const s = document.createElement('script');
    s.src   = 'https://browser.sentry-cdn.com/7.99.0/bundle.min.js';
    s.crossOrigin = 'anonymous';
    s.onload = () => {
      if (window.Sentry) {
        window.Sentry.init({
          dsn:         SENTRY_DSN,
          environment: location.hostname === 'localhost' ? 'development' : 'production',
          tracesSampleRate: 0.05,
          beforeSend(event) {
            // 略過網路離線錯誤
            const msg = event.exception?.values?.[0]?.value || '';
            if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return null;
            return event;
          },
        });
        _sentryLoaded = true;
      }
    };
    document.head.appendChild(s);
  }

  // ── 全域錯誤回報 ─────────────────────────
  function report(type, message, extra = {}) {
    // 1. 傳到 Sentry（若已載入）
    if (_sentryLoaded && window.Sentry) {
      window.Sentry.captureMessage(`[${type}] ${message}`, {
        level: 'error',
        extra,
      });
    }

    // 2. 靜默回報到自身 API（fire-and-forget）
    try {
      navigator.sendBeacon?.('/api/client-error', JSON.stringify({
        type, message,
        url:  location.href,
        ua:   navigator.userAgent,
        ts:   Date.now(),
        ...extra,
      }));
    } catch {}

    console.error(`[${type}]`, message, extra);
  }

  // ── window.onerror ────────────────────────
  const _origOnError = window.onerror;
  window.onerror = function (message, source, lineno, colno, error) {
    // 略過跨域腳本錯誤（第三方 CDN）
    if (message === 'Script error.' && !source) return false;

    report('UncaughtError', String(message), {
      source, lineno, colno,
      stack: error?.stack?.slice(0, 500),
    });

    if (typeof _origOnError === 'function') return _origOnError.apply(this, arguments);
    return false;
  };

  // ── unhandledrejection ────────────────────
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const message = reason instanceof Error
      ? reason.message
      : String(reason);

    // 略過：用戶主動取消（AbortController）、離線錯誤
    if (message.includes('AbortError') || message.includes('Failed to fetch')) return;

    report('UnhandledPromise', message, {
      stack: reason?.stack?.slice(0, 500),
    });
  });

  // ── 頁面崩潰偵測（beforeunload + performance） ─
  let _lastActivity = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) _lastActivity = Date.now();
  });
  ['click', 'keydown', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, () => { _lastActivity = Date.now(); }, { passive: true })
  );

  // ── 公開 API ─────────────────────────────
  window.__errorHandler = { report };
})();
