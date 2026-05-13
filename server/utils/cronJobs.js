// ════════════════════════════════════════
//  server/utils/cronJobs.js  —  定時任務
// ════════════════════════════════════════
const cron   = require('node-cron');
const logger = require('./logger');
const { checkAndDegradeVip }  = require('../services/vipService');
const { processDailyPass }    = require('../services/monthlyPassService');
const { tickTournaments, autoCreateTournaments } = require('../services/tournamentService');
const roomManager             = require('../socket/roomManager');

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

  // 每日 00:05 台灣時間（UTC 16:05）自動建立每日/週賽
  cron.schedule('5 16 * * *', async () => {
    logger.info('[CRON] 自動建立賽事開始');
    try {
      await autoCreateTournaments();
      logger.info('[CRON] 自動建立賽事完成');
    } catch (e) {
      logger.error('[CRON] 自動建立賽事失敗：' + e.message);
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

  // 每 5 分鐘：賽事狀態推進（upcoming→active、active→ended 並結算獎金）
  cron.schedule('*/5 * * * *', async () => {
    try {
      await tickTournaments();
    } catch (e) {
      logger.error('[CRON] 賽事 tick 失敗：' + e.message);
    }
  });

  // 每 10 分鐘清理殭屍房間（waiting 超過 2 小時、finished 房間）
  cron.schedule('*/10 * * * *', () => {
    try {
      const now     = Date.now();
      const rooms   = roomManager.getAllRooms();
      let cleaned   = 0;
      for (const room of rooms) {
        const ageMin = (now - room.createdAt) / 60000;
        const shouldClean =
          (room.status === 'waiting'  && ageMin > 120) ||  // 等待超過 2h
          (room.status === 'finished' && ageMin > 10)  ||  // 結束超過 10min
          (room.players.length === 0  && ageMin > 5);      // 空房 5min
        if (shouldClean) {
          roomManager.deleteRoom(room.roomId);
          cleaned++;
        }
      }
      if (cleaned > 0) logger.info(`[CRON] 清理殭屍房間 ${cleaned} 個`);
    } catch (e) {
      logger.warn('[CRON] 房間清理失敗：' + e.message);
    }
  });

  logger.info('Cron jobs started');
}

module.exports = { startCronJobs };
