// ════════════════════════════════════════
//  server/services/referralService.js
//  推薦碼系統：雙方各得 1000 金幣
// ════════════════════════════════════════
const supabase = require('../models/supabase');
const { addCoins } = require('./coinService');
const logger   = require('../utils/logger');

const REWARD_COINS = 1000;  // 推薦人 & 被推薦人各得

// ── 產生唯一推薦碼（6碼大寫英數） ────────
function _genCode(uid) {
  // 取 uid 前 8 碼 XOR 折疊再 base36 編碼，保證同 uid 相同結果
  const hex = uid.replace(/-/g, '').slice(0, 8);
  const n   = parseInt(hex, 16) % (36 ** 6);
  return n.toString(36).toUpperCase().padStart(6, '0');
}

// ── 取得或建立推薦碼 ────────────────────
async function getOrCreateCode(uid) {
  // 查詢
  const { data } = await supabase
    .from('referral_codes')
    .select('code')
    .eq('owner_uid', uid)
    .single();

  if (data) return data.code;

  // 建立（若碰撞則加隨機後綴）
  let code = _genCode(uid);
  const { data: conflict } = await supabase
    .from('referral_codes')
    .select('owner_uid')
    .eq('code', code)
    .single();

  if (conflict && conflict.owner_uid !== uid) {
    // 碰撞：加隨機 2 碼
    code = code.slice(0, 4) + Math.random().toString(36).slice(2, 4).toUpperCase();
  }

  await supabase.from('referral_codes').upsert(
    { code, owner_uid: uid },
    { onConflict: 'code', ignoreDuplicates: true }
  );
  return code;
}

// ── 使用推薦碼（新用戶完成後呼叫） ────────
async function useReferralCode(code, newUid) {
  if (!code || !newUid) throw new Error('參數錯誤');
  code = code.toUpperCase().trim();

  // 檢查推薦碼有效性
  const { data: codeRow } = await supabase
    .from('referral_codes')
    .select('owner_uid')
    .eq('code', code)
    .single();

  if (!codeRow) throw new Error('推薦碼不存在');
  if (codeRow.owner_uid === newUid) throw new Error('不能使用自己的推薦碼');

  // 檢查是否已被推薦過
  const { data: already } = await supabase
    .from('referrals')
    .select('id')
    .eq('referred_uid', newUid)
    .single();

  if (already) throw new Error('你已使用過推薦碼');

  // 寫入紀錄
  await supabase.from('referrals').insert({
    code,
    referrer_uid: codeRow.owner_uid,
    referred_uid: newUid,
    reward_coins: REWARD_COINS,
  });

  // 雙方發放金幣
  await addCoins(codeRow.owner_uid, REWARD_COINS, 'referral_reward');
  await addCoins(newUid,            REWARD_COINS, 'referral_bonus');

  logger.info(`[Referral] ${code}: ${codeRow.owner_uid} → ${newUid}，各得 ${REWARD_COINS}`);
  return { referrerUid: codeRow.owner_uid, reward: REWARD_COINS };
}

// ── 查詢推薦紀錄 ────────────────────────
async function getReferralStats(uid) {
  const code = await getOrCreateCode(uid);

  const { data: referrals } = await supabase
    .from('referrals')
    .select('referred_uid, reward_coins, created_at')
    .eq('referrer_uid', uid)
    .order('created_at', { ascending: false })
    .limit(20);

  const total = (referrals || []).reduce((s, r) => s + r.reward_coins, 0);
  return { code, count: referrals?.length || 0, total_earned: total, list: referrals || [] };
}

module.exports = { getOrCreateCode, useReferralCode, getReferralStats };
