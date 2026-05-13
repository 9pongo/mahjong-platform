// ════════════════════════════════════════
//  server/utils/cronJobs.js  —  定時任務
// ════════════════════════════════════════
const cron   = require('node-cron');
const logger = require('./logger');
const { checkAndDegradeVip }  = require('../services/vipService');
const { processDailyPass }    = require('../services/monthlyPassService');

function startCronJobs() {
  // 每日 00:05 台灣時間（UTC 16:05）做 VIP 降級檢查
  cron.schedule('5 16 * * *', async () => {
    logger.info('[CRON] VIP 降級檢查開始');
    try {
      await checkAndDegradeVip();
      logger.info('[CRON] VIP 降級檢查完成');
    } catch (e) {
      logger.error('[CRON] VIP 降級失敗：' + e.message);
    }
  });

  // 每日 00:05 台灣時間（UTC 16:05）月卡自動發放
  cron.schedule('5 16 * * *', async () => {
    logger.info('[CRON] 月卡自動發放開始');
    try {
      const { count } = await processDailyPass();
      logger.info(`[CRON] 月卡發放完成，共 ${count} 人`);
    } catch (e) {
      logger.error('[CRON] 月卡發放失敗：' + e.message);
    }
  });

  // 每晚 20:00 台灣時間（UTC 12:00）彩金賽結算（Phase 5 實作）
  cron.schedule('0 12 * * *', () => {
    logger.info('[CRON] 彩金賽結算 placeholder（Phase 5）');
  });

  logger.info('Cron jobs started');
}

module.exports = { startCronJobs };
