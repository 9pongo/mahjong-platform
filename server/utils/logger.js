// ════════════════════════════════════════
//  server/utils/logger.js  —  Winston 結構化日誌
// ════════════════════════════════════════
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf, colorize, errors, json } = format;

const isProd = process.env.NODE_ENV === 'production';

// ── 開發模式：彩色人可讀格式 ─────────────
const devFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}] ${stack || message}`;
});

// ── 生產模式：JSON 結構化（方便 log aggregator 解析） ─
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const logger = createLogger({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  format: isProd ? prodFormat : combine(
    timestamp({ format: 'HH:mm:ss' }),
    errors({ stack: true }),
    devFormat
  ),
  transports: [
    new transports.Console({
      format: isProd ? prodFormat : combine(
        colorize(),
        timestamp({ format: 'HH:mm:ss' }),
        devFormat
      ),
    }),
  ],
  // 避免未處理的 logger 錯誤讓 process crash
  exitOnError: false,
});

// ── 特殊日誌方法 ─────────────────────────

/** 金流操作強制記錄（error level 確保留存） */
logger.payment = (msg, meta = {}) => {
  logger.error(`[PAYMENT] ${msg}`, meta);
};

/** 安全事件記錄（登入失敗、封鎖等） */
logger.security = (msg, meta = {}) => {
  logger.warn(`[SECURITY] ${msg}`, meta);
};

/** 效能警告（慢查詢等） */
logger.perf = (label, ms) => {
  if (ms > 1000) logger.warn(`[PERF] ${label} took ${ms}ms`);
  else if (ms > 300) logger.debug(`[PERF] ${label} ${ms}ms`);
};

module.exports = logger;
