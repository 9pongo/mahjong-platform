// ════════════════════════════════════════
//  server/utils/logger.js  —  Winston 結構化日誌
// ════════════════════════════════════════
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf, colorize, errors } = format;

const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}] ${stack || message}`;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    new transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat),
    }),
  ],
});

// 金流操作強制記錄（error level 確保留存）
logger.payment = (msg, meta = {}) => {
  logger.error(`[PAYMENT] ${msg}`, meta);
};

module.exports = logger;
