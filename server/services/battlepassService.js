// ════════════════════════════════════════
//  server/services/battlepassService.js
//  Battle Pass 自動管理服務
// ════════════════════════════════════════
const supabase = require('../models/supabase');
const logger   = require('../utils/logger');

// 標準 30 天獎勵模板（每月通用）
function buildRewards(passId) {
  return [
    // 第1週
    { pass_id: passId, day:  1, free_type: 'coins',    free_amount:  100, premium_type: 'coins',    premium_amount:  500 },
    { pass_id: passId, day:  2, free_type: 'coins',    free_amount:   50, premium_type: 'coins',    premium_amount:  200 },
    { pass_id: passId, day:  3, free_type: 'coins',    free_amount:  100, premium_type: 'coins',    premium_amount:  300 },
    { pass_id: passId, day:  4, free_type: 'coins',    free_amount:   50, premium_type: 'coins',    premium_amount:  200 },
    { pass_id: passId, day:  5, free_type: 'coins',    free_amount:  150, premium_type: 'coins',    premium_amount:  500 },
    { pass_id: passId, day:  6, free_type: 'coins',    free_amount:   50, premium_type: 'coins',    premium_amount:  200 },
    { pass_id: passId, day:  7, free_type: 'diamonds', free_amount:    2, premium_type: 'diamonds', premium_amount:   10 }, // 週獎
    // 第2週
    { pass_id: passId, day:  8, free_type: 'coins',    free_amount:  100, premium_type: 'coins',    premium_amount:  300 },
    { pass_id: passId, day:  9, free_type: 'coins',    free_amount:   50, premium_type: 'coins',    premium_amount:  200 },
    { pass_id: passId, day: 10, free_type: 'coins',    free_amount:  200, premium_type: 'coins',    premium_amount:  600 },
    { pass_id: passId, day: 11, free_type: 'coins',    free_amount:   50, premium_type: 'coins',    premium_amount:  200 },
    { pass_id: passId, day: 12, free_type: 'coins',    free_amount:  100, premium_type: 'coins',    premium_amount:  300 },
    { pass_id: passId, day: 13, free_type: 'coins',    free_amount:   50, premium_type: 'coins',    premium_amount:  200 },
    { pass_id: passId, day: 14, free_type: 'diamonds', free_amount:    3, premium_type: 'diamonds', premium_amount:   20 }, // 雙週獎
    // 第3週
    { pass_id: passId, day: 15, free_type: 'coins',    free_amount:  200, premium_type: 'coins',    premium_amount:  600 },
    { pass_id: passId, day: 16, free_type: 'coins',    free_amount:   50, premium_type: 'coins',    premium_amount:  200 },
    { pass_id: passId, day: 17, free_type: 'coins',    free_amount:  100, premium_type: 'coins',    premium_amount:  300 },
    { pass_id: passId, day: 18, free_type: 'coins',    free_amount:   50, premium_type: 'coins',    premium_amount:  200 },
    { pass_id: passId, day: 19, free_type: 'coins',    free_amount:  150, premium_type: 'coins',    premium_amount:  500 },
    { pass_id: passId, day: 20, free_type: 'coins',    free_amount:   50, premium_type: 'coins',    premium_amount:  200 },
    { pass_id: passId, day: 21, free_type: 'diamonds', free_amount:    5, premium_type: 'diamonds', premium_amount:   30 }, // 三週獎
    // 第4週
    { pass_id: passId, day: 22, free_type: 'coins',    free_amount:  100, premium_type: 'coins',    premium_amount:  300 },
    { pass_id: passId, day: 23, free_type: 'coins',    free_amount:   50, premium_type: 'coins',    premium_amount:  200 },
    { pass_id: passId, day: 24, free_type: 'coins',    free_amount:  200, premium_type: 'coins',    premium_amount:  600 },
    { pass_id: passId, day: 25, free_type: 'coins',    free_amount:   50, premium_type: 'coins',    premium_amount:  200 },
    { pass_id: passId, day: 26, free_type: 'coins',    free_amount:  100, premium_type: 'coins',    premium_amount:  300 },
    { pass_id: passId, day: 27, free_type: 'coins',    free_amount:   50, premium_type: 'coins',    premium_amount:  200 },
    { pass_id: passId, day: 28, free_type: 'coins',    free_amount:  150, premium_type: 'coins',    premium_amount:  500 },
    { pass_id: passId, day: 29, free_type: 'coins',    free_amount:  100, premium_type: 'coins',    premium_amount:  300 },
    { pass_id: passId, day: 30, free_type: 'diamonds', free_amount:   10, premium_type: 'diamonds', premium_amount:   50 }, // 滿月大獎 🌕
  ];
}

/**
 * 建立指定月份的 Battle Pass（若已存在則跳過）
 * @param {number} year  e.g. 2026
 * @param {number} month e.g. 6 (1-based)
 */
async function createMonthlyPass(year, month) {
  const season    = `${year}-${String(month).padStart(2, '0')}`;
  const lastDay   = new Date(year, month, 0).getDate();
  const startsAt  = `${season}-01T00:00:00+08:00`;
  const endsAt    = `${season}-${lastDay}T23:59:59+08:00`;

  const MONTH_NAMES = ['', '一月', '二月', '三月', '四月', '五月', '六月',
                            '七月', '八月', '九月', '十月', '十一月', '十二月'];
  const name = `月見通行證 — ${year}年${month}月`;

  // 確認不重複建立
  const { data: existing } = await supabase
    .from('battle_passes')
    .select('id')
    .eq('season', season)
    .maybeSingle();
  if (existing) {
    logger.info(`[BattlePass] ${season} 已存在，跳過`);
    return { skipped: true, season };
  }

  // 建立通行證
  const { data: pass, error } = await supabase
    .from('battle_passes')
    .insert({ name, season, starts_at: startsAt, ends_at: endsAt, premium_price: 300, active: false })
    .select()
    .single();
  if (error) throw new Error(`建立 battle_pass 失敗：${error.message}`);

  // 插入 30 天獎勵
  const rewards = buildRewards(pass.id);
  const { error: rewardErr } = await supabase
    .from('battle_pass_rewards')
    .insert(rewards);
  if (rewardErr) throw new Error(`插入獎勵失敗：${rewardErr.message}`);

  logger.info(`[BattlePass] 建立 ${season} 完成（id=${pass.id}）`);
  return { created: true, season, passId: pass.id };
}

/**
 * 每月1日啟動新賽季、關閉舊賽季
 * 由 cron 呼叫
 */
async function activateMonthlyPass() {
  const now    = new Date();
  const year   = now.getFullYear();
  const month  = now.getMonth() + 1;  // 1-based
  const season = `${year}-${String(month).padStart(2, '0')}`;

  // 找到本月的 pass（應已由上月25日的 cron 預建）
  let { data: pass } = await supabase
    .from('battle_passes')
    .select('id')
    .eq('season', season)
    .maybeSingle();

  if (!pass) {
    // 緊急補建
    logger.warn(`[BattlePass] ${season} 尚未預建，緊急建立`);
    const result = await createMonthlyPass(year, month);
    const { data } = await supabase
      .from('battle_passes')
      .select('id')
      .eq('season', season)
      .single();
    pass = data;
  }

  // 關閉所有舊的 active pass，啟動本月
  await supabase
    .from('battle_passes')
    .update({ active: false })
    .eq('active', true)
    .neq('id', pass.id);

  await supabase
    .from('battle_passes')
    .update({ active: true })
    .eq('id', pass.id);

  logger.info(`[BattlePass] ${season} 已設為 active`);
  return { season, activated: true };
}

/**
 * 每月25日預建下個月的 Battle Pass
 * 由 cron 呼叫
 */
async function prepareNextMonthPass() {
  const now   = new Date();
  let year    = now.getFullYear();
  let month   = now.getMonth() + 2;  // 下個月（1-based）
  if (month > 12) { month = 1; year++; }

  return createMonthlyPass(year, month);
}

module.exports = {
  createMonthlyPass,
  activateMonthlyPass,
  prepareNextMonthPass,
};
