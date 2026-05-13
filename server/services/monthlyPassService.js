// ════════════════════════════════════════
//  server/services/monthlyPassService.js
//  月卡系統：購買 / 每日領取 / Cron 自動發放
// ════════════════════════════════════════
const supabase = require('../models/supabase');
const { addCoins } = require('./coinService');
const logger   = require('../utils/logger');

const DAILY_COINS   = 500;   // 月卡每日金幣
const PASS_DAYS     = 30;    // 月卡天數

// ── 取得月卡狀態 ────────────────────────
async function getPassStatus(uid) {
  const { data } = await supabase
    .from('monthly_passes')
    .select('*')
    .eq('uid', uid)
    .single();

  if (!data) return { active: false };

  const now     = new Date();
  const expires = new Date(data.expires_at);
  const active  = expires > now;

  // 今天（台灣時間）是否已領取
  const todayTW   = _todayTW();
  const lastClaim = data.last_claimed || '';
  const claimed   = lastClaim === todayTW;

  return {
    active,
    expires_at:   data.expires_at,
    daily_coins:  data.daily_coins,
    last_claimed: data.last_claimed,
    claimed_today: claimed,
    days_left:    active ? Math.ceil((expires - now) / 86400000) : 0,
  };
}

// ── 購買月卡（stub：直接到帳，金流留空） ─
async function purchasePass(uid, days = PASS_DAYS) {
  const now     = new Date();
  const { data: existing } = await supabase
    .from('monthly_passes')
    .select('expires_at')
    .eq('uid', uid)
    .single();

  // 若已有月卡，從到期日延長；否則從今天算
  const base = (existing && new Date(existing.expires_at) > now)
    ? new Date(existing.expires_at)
    : now;

  const expires_at = new Date(base.getTime() + days * 86400000);

  await supabase.from('monthly_passes').upsert({
    uid,
    expires_at: expires_at.toISOString(),
    daily_coins: DAILY_COINS,
  }, { onConflict: 'uid' });

  logger.info(`[Pass] ${uid} 購買月卡 ${days}天，到期 ${expires_at.toDateString()}`);
  return { expires_at, days_left: days };
}

// ── 手動領取月卡（玩家主動點） ───────────
async function claimDailyPass(uid) {
  const status = await getPassStatus(uid);
  if (!status.active)        throw new Error('月卡未啟用或已到期');
  if (status.claimed_today)  throw new Error('今日已領取');

  const today = _todayTW();
  await supabase.from('monthly_passes')
    .update({ last_claimed: today })
    .eq('uid', uid);

  await addCoins(uid, status.daily_coins, 'monthly_pass');
  logger.info(`[Pass] ${uid} 手動領取 ${status.daily_coins} 金幣`);
  return { coins: status.daily_coins };
}

// ── Cron：發放所有有效月卡（00:05 台灣時間） ─
async function processDailyPass() {
  const today = _todayTW();
  const now   = new Date().toISOString();

  // 找：月卡有效 && 今天尚未領取
  const { data: passes } = await supabase
    .from('monthly_passes')
    .select('uid, daily_coins')
    .gt('expires_at', now)
    .or(`last_claimed.is.null,last_claimed.neq.${today}`);

  if (!passes?.length) {
    logger.info('[Pass] 今日無需發放月卡');
    return { count: 0 };
  }

  let count = 0;
  for (const pass of passes) {
    try {
      await addCoins(pass.uid, pass.daily_coins, 'monthly_pass_auto');
      await supabase.from('monthly_passes')
        .update({ last_claimed: today })
        .eq('uid', pass.uid);
      count++;
    } catch (e) {
      logger.warn(`[Pass] 發放失敗 ${pass.uid}: ${e.message}`);
    }
  }

  logger.info(`[Pass] 月卡自動發放完成，共 ${count} 人`);
  return { count };
}

// ── 工具：台灣時間的 YYYY-MM-DD ─────────
function _todayTW() {
  return new Date(Date.now() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
}

module.exports = { getPassStatus, purchasePass, claimDailyPass, processDailyPass };
