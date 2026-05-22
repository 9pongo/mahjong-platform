// ════════════════════════════════════════
//  server/utils/cronJobs.js  —  定時任務
// ════════════════════════════════════════
const cron   = require('node-cron');
const logger = require('./logger');
const { checkAndDegradeVip }  = require('../services/vipService');
const { processDailyPass }    = require('../services/monthlyPassService');
const { tickTournaments, autoCreateTournaments } = require('../services/tournamentService');
const { settleSeasonRewards } = require('../services/rankService');
const { prepareNextMonthPass, activateMonthlyPass } = require('../services/battlepassService');
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

  // 每月25日 12:00 UTC（台灣 20:00）：預建下個月 Battle Pass
  cron.schedule('0 12 25 * *', async () => {
    logger.info('[CRON] 預建下月 Battle Pass 開始');
    try {
      const result = await prepareNextMonthPass();
      logger.info(`[CRON] 預建下月 Battle Pass: ${JSON.stringify(result)}`);
    } catch (e) {
      logger.error('[CRON] 預建下月 Battle Pass 失敗：' + e.message);
    }
  });

  // 每月1日 00:01 UTC+8（UTC 16:01 前一天）：啟動本月 Battle Pass
  cron.schedule('1 16 28-31 * *', async () => {
    // 台灣時間00:01 = UTC 16:01，但1日在UTC是前一天28-31日的UTC 16:01
    // 此處改用簡單判斷：台灣時間每日00:01執行，若是1日就啟動
    const twNow = new Date(Date.now() + 8 * 3600 * 1000);
    if (twNow.getUTCDate() !== 1) return;
    logger.info('[CRON] 啟動本月 Battle Pass 開始');
    try {
      const result = await activateMonthlyPass();
      logger.info(`[CRON] Battle Pass 啟動: ${JSON.stringify(result)}`);
    } catch (e) {
      logger.error('[CRON] Battle Pass 啟動失敗：' + e.message);
    }
  });

  // 每月最後一天 23:00 UTC（台灣 07:00+1）：賽季結算 + 獎勵發放
  // cron: 0 23 28-31 * *（每月 28~31 日 23:00 UTC 嘗試，函式內確認是否最後一天）
  cron.schedule('0 23 28-31 * *', async () => {
    const now = new Date();
    // 確認是當月最後一天
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (now.getUTCDate() !== lastDay) return;

    logger.info('[CRON] 賽季結算開始');
    try {
      const result = await settleSeasonRewards();
      logger.info(`[CRON] 賽季結算完成：${result.count}/${result.total} 人`);
    } catch (e) {
      logger.error('[CRON] 賽季結算失敗：' + e.message);
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
