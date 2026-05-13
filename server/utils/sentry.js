// ════════════════════════════════════════
//  server/utils/sentry.js
//  Sentry 錯誤追蹤（可選，需設定 SENTRY_DSN）
//  未設定時自動退化為 no-op
// ════════════════════════════════════════
const logger = require('./logger');

let Sentry = null;

if (process.env.SENTRY_DSN) {
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn:         process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      release:     process.env.npm_package_version || '1.0.0',
      // 取樣率：production 10%，其他 100%
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      // 過濾已知非嚴重錯誤
      beforeSend(event) {
        const msg = event.exception?.values?.[0]?.value || '';
        // 略過：rate limit、已知驗證錯誤
        if (msg.includes('請求過於頻繁') || msg.includes('Token 無效')) return null;
        return event;
      },
    });
    logger.info('[Sentry] 已初始化，DSN 末段：...' + process.env.SENTRY_DSN.slice(-8));
  } catch (e) {
    logger.warn('[Sentry] 初始化失敗（可能未安裝 @sentry/node）：' + e.message);
    Sentry = null;
  }
} else {
  logger.debug('[Sentry] SENTRY_DSN 未設定，錯誤追蹤已停用');
}

/**
 * 捕捉錯誤（Sentry 未啟用時只用 logger）
 */
function captureException(err, context = {}) {
  if (Sentry) {
    Sentry.withScope(scope => {
      for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
      Sentry.captureException(err);
    });
  }
  logger.error('[Sentry.captureException]', err);
}

/**
 * 捕捉訊息
 */
function captureMessage(msg, level = 'info') {
  if (Sentry) Sentry.captureMessage(msg, level);
  else logger[level]?.('[Sentry.msg] ' + msg);
}

/**
 * Express error handler（放在所有路由之後）
 * 使用方式：app.use(sentryErrorHandler)
 */
function errorHandler(err, req, res, next) {
  captureException(err, { url: req.url, method: req.method });
  next(err);
}

/**
 * 取得 Sentry 實例（供進階使用）
 */
function getInstance() { return Sentry; }

module.exports = { captureException, captureMessage, errorHandler, getInstance };
