// ════════════════════════════════════════
//  server/services/coinService.js
//  金幣流水帳（所有金幣異動必須過這裡）
//  使用 Supabase RPC update_coins_atomic
//  以 FOR UPDATE 鎖防止並發競爭條件
// ════════════════════════════════════════
const supabase = require('../models/supabase');
const logger   = require('../utils/logger');

/**
 * 原子更新金幣（含流水帳記錄）
 * 優先使用 RPC；若 RPC 不存在（尚未部署）自動降級為 read-write
 * @param {string} uid
 * @param {number} delta   正 = 增加，負 = 扣除
 * @param {string} reason
 * @returns {{ ok, newBalance, error }}
 */
async function updateCoins(uid, delta, reason) {
  // ── 嘗試原子 RPC ──────────────────────
  const { data, error: rpcErr } = await supabase.rpc('update_coins_atomic', {
    p_uid:    uid,
    p_delta:  delta,
    p_reason: reason,
  });

  if (!rpcErr) {
    const result = data;   // jsonb → JS object
    if (!result?.ok) {
      logger.warn(`Coins rejected: ${uid} ${delta} (${reason}) — ${result?.error}`);
      return { ok: false, error: result?.error || '金幣更新失敗' };
    }
    const newBalance = result.new_balance;
    logger.info(`Coins: ${uid} ${delta > 0 ? '+' : ''}${delta} (${reason}) → ${newBalance}`);
    return { ok: true, newBalance };
  }

  // ── RPC 不存在時的降級方案（本機開發用）──
  if (rpcErr.message?.includes('Could not find') || rpcErr.code === 'PGRST202') {
    logger.warn(`update_coins_atomic RPC not found, falling back to read-write`);
    return _fallbackUpdateCoins(uid, delta, reason);
  }

  logger.error(`update_coins_atomic RPC error: ${rpcErr.message}`);
  return { ok: false, error: rpcErr.message };
}

/** 降級方案：read → check → write（非原子，僅供本機開發） */
async function _fallbackUpdateCoins(uid, delta, reason) {
  const { data: user, error: fetchErr } = await supabase
    .from('users').select('coins').eq('uid', uid).single();

  if (fetchErr || !user) return { ok: false, error: '找不到用戶' };

  const newBalance = user.coins + delta;
  if (newBalance < 0) return { ok: false, error: '金幣不足' };

  const { error: updateErr } = await supabase
    .from('users').update({ coins: newBalance }).eq('uid', uid);

  if (updateErr) return { ok: false, error: updateErr.message };

  await supabase.from('coin_ledger').insert({ uid, delta, reason, balance: newBalance });

  logger.info(`Coins(fallback): ${uid} ${delta > 0 ? '+' : ''}${delta} (${reason}) → ${newBalance}`);
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

/** addCoins：updateCoins 的語義別名（用於發放獎勵場景） */
async function addCoins(uid, amount, reason) {
  return updateCoins(uid, Math.abs(amount), reason);
}

module.exports = { updateCoins, addCoins, getCoins, deductBaseBet, settleGame };
