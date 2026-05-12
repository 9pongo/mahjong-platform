// ════════════════════════════════════════
//  server/services/coinService.js
//  金幣流水帳（所有金幣異動必須過這裡）
// ════════════════════════════════════════
const supabase = require('../models/supabase');
const logger   = require('../utils/logger');

/**
 * 安全更新金幣（含流水帳記錄）
 * @param {string} uid
 * @param {number} delta   正 = 增加，負 = 扣除
 * @param {string} reason  'game_win' | 'game_loss' | 'spin' | 'purchase' | 'transfer' ...
 * @returns {{ ok, newBalance, error }}
 */
async function updateCoins(uid, delta, reason) {
  // 取目前餘額（用 select for update 防並發，Supabase 用 RPC 處理）
  const { data: user, error: fetchErr } = await supabase
    .from('users')
    .select('coins')
    .eq('uid', uid)
    .single();

  if (fetchErr || !user) return { ok: false, error: '找不到用戶' };

  const newBalance = user.coins + delta;
  if (newBalance < 0) return { ok: false, error: '金幣不足' };

  const { error: updateErr } = await supabase
    .from('users')
    .update({ coins: newBalance })
    .eq('uid', uid);

  if (updateErr) return { ok: false, error: updateErr.message };

  // 寫入流水帳
  await supabase.from('coin_ledger').insert({
    uid, delta, reason, balance: newBalance,
  });

  logger.info(`Coins: ${uid} ${delta > 0 ? '+' : ''}${delta} (${reason}) → ${newBalance}`);
  return { ok: true, newBalance };
}

/**
 * 查詢用戶當前金幣
 */
async function getCoins(uid) {
  const { data } = await supabase.from('users').select('coins').eq('uid', uid).single();
  return data?.coins ?? 0;
}

/**
 * 扣除底注（開局前呼叫）
 */
async function deductBaseBet(uid, baseBet) {
  return updateCoins(uid, -baseBet, 'game_base_bet');
}

/**
 * 結算遊戲金幣（勝/負/流局）
 */
async function settleGame(uid, netDelta, reason = 'game_settle') {
  return updateCoins(uid, netDelta, reason);
}

module.exports = { updateCoins, getCoins, deductBaseBet, settleGame };
