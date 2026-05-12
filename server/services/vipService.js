// ════════════════════════════════════════
//  server/services/vipService.js
//  VIP 點數計算、升降級、每日紅包次數
// ════════════════════════════════════════
const supabase = require('../models/supabase');
const logger   = require('../utils/logger');
const { VIP_LEVELS } = require('../../shared/constants');

/**
 * 根據累積 V 點計算應有等級
 * @param {number} vPoints  30日內累積 V 點
 * @param {number} currentLevel 當前等級（VIP0不降）
 */
function calculateVipLevel(vPoints, currentLevel = 0) {
  // VIP0 永遠不降
  if (currentLevel === 0 && vPoints < 1) return 0;

  // 由高往低找符合的等級
  for (let i = VIP_LEVELS.length - 1; i >= 0; i--) {
    if (vPoints >= VIP_LEVELS[i].minVP) return VIP_LEVELS[i].level;
  }
  return 0;
}

/**
 * 新增 V 點並觸發升降級
 * @param {string} uid
 * @param {number} points  正數 = 獲得，負數不應出現（降級由 checkAndDegradeVip 處理）
 * @param {string} reason  'purchase' | 'play'
 */
async function addVPoints(uid, points, reason) {
  if (points <= 0) return;

  // 取目前資料
  const { data: user, error } = await supabase
    .from('users')
    .select('vip_level, v_points')
    .eq('uid', uid)
    .single();
  if (error || !user) return;

  const newVP    = user.v_points + points;
  const newLevel = calculateVipLevel(newVP, user.vip_level);
  const levelUp  = newLevel > user.vip_level;

  await supabase.from('users').update({
    v_points:  newVP,
    vip_level: newLevel,
  }).eq('uid', uid);

  // 記錄異動
  await supabase.from('vip_log').insert({
    uid, v_points: points, action: reason,
  });

  if (levelUp) {
    logger.info(`VIP upgrade: ${uid} → VIP${newLevel}`);
  }
  return { newVP, newLevel, levelUp };
}

/**
 * 每日 00:00 執行，降級 30 日內不足條件的用戶
 * 不影響 VIP0（永久）
 */
async function checkAndDegradeVip() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // 取所有 VIP1+ 用戶
  const { data: users } = await supabase
    .from('users')
    .select('uid, vip_level, v_points')
    .gt('vip_level', 0);

  if (!users) return;

  for (const user of users) {
    // 計算 30 日內累積 V 點
    const { data: logs } = await supabase
      .from('vip_log')
      .select('v_points')
      .eq('uid', user.uid)
      .gte('created_at', since);

    const vp30 = (logs || []).reduce((s, r) => s + r.v_points, 0);
    const shouldLevel = calculateVipLevel(vp30, user.vip_level);

    if (shouldLevel < user.vip_level) {
      await supabase.from('users')
        .update({ vip_level: shouldLevel })
        .eq('uid', user.uid);
      await supabase.from('vip_log').insert({
        uid: user.uid, v_points: 0, action: 'degrade',
      });
      logger.info(`VIP degrade: ${user.uid} VIP${user.vip_level} → VIP${shouldLevel}`);
    }
  }
}

/**
 * 取得該 VIP 等級每日紅包上限次數
 */
function getDailyHongbaoCount(vipLevel) {
  const cfg = VIP_LEVELS.find(v => v.level === vipLevel);
  return cfg ? cfg.dailyHongbao : 1;
}

module.exports = { calculateVipLevel, addVPoints, checkAndDegradeVip, getDailyHongbaoCount };
