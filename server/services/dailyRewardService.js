// ════════════════════════════════════════
//  server/services/dailyRewardService.js
//  每日轉盤 + 紅包機制
// ════════════════════════════════════════
const supabase   = require('../models/supabase');
const { updateCoins } = require('./coinService');
const { getDailyHongbaoCount } = require('./vipService');

// 台灣時間（UTC+8）跨日計算
function todayTW() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

async function getDailyRow(uid) {
  const today = todayTW();
  const { data } = await supabase
    .from('daily_rewards')
    .select()
    .eq('uid', uid)
    .eq('reward_date', today)
    .single();
  if (data) return data;
  // 今天尚無記錄，建立
  const { data: created } = await supabase
    .from('daily_rewards')
    .insert({ uid, reward_date: today, spin_claimed: false, hongbao_count: 0 })
    .select()
    .single();
  return created;
}

// ── 每日轉盤 ─────────────────────────────
const SPIN_PRIZES = [
  { label: '100 金幣',  coins: 100,   weight: 40 },
  { label: '300 金幣',  coins: 300,   weight: 25 },
  { label: '500 金幣',  coins: 500,   weight: 18 },
  { label: '1000 金幣', coins: 1000,  weight: 10 },
  { label: '3000 金幣', coins: 3000,  weight: 5  },
  { label: '8888 金幣', coins: 8888,  weight: 2  },
];

function pickPrize() {
  const total = SPIN_PRIZES.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of SPIN_PRIZES) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return SPIN_PRIZES[0];
}

/**
 * 每天限一次轉盤
 * @returns {{ ok, prize, coins, error }}
 */
async function spinWheel(uid) {
  const row = await getDailyRow(uid);
  if (!row) return { ok: false, error: '資料庫錯誤' };
  if (row.spin_claimed) return { ok: false, error: '今天已經轉過了' };

  const prize = pickPrize();
  await updateCoins(uid, prize.coins, 'daily_spin');
  await supabase.from('daily_rewards')
    .update({ spin_claimed: true })
    .eq('uid', uid)
    .eq('reward_date', todayTW());

  return { ok: true, prize: prize.label, coins: prize.coins };
}

// ── 開紅包 ───────────────────────────────
const HONGBAO_PRIZES = [
  { coins: 10,  weight: 50 },
  { coins: 50,  weight: 30 },
  { coins: 100, weight: 15 },
  { coins: 500, weight: 4  },
  { coins: 1000,weight: 1  },
];

function pickHongbao() {
  const total = HONGBAO_PRIZES.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of HONGBAO_PRIZES) { r -= p.weight; if (r <= 0) return p; }
  return HONGBAO_PRIZES[0];
}

/**
 * 開紅包（依 VIP 等級決定次數上限）
 */
async function openHongbao(uid, vipLevel) {
  const row   = await getDailyRow(uid);
  const limit = getDailyHongbaoCount(vipLevel);
  if (!row) return { ok: false, error: '資料庫錯誤' };
  if (row.hongbao_count >= limit)
    return { ok: false, error: `今天紅包已開完（上限 ${limit} 次）` };

  const prize = pickHongbao();
  await updateCoins(uid, prize.coins, 'hongbao');
  await supabase.from('daily_rewards')
    .update({ hongbao_count: row.hongbao_count + 1 })
    .eq('uid', uid)
    .eq('reward_date', todayTW());

  return { ok: true, coins: prize.coins, remaining: limit - row.hongbao_count - 1 };
}

/**
 * 取得今日獎勵狀態
 */
async function getDailyStatus(uid, vipLevel) {
  const row   = await getDailyRow(uid);
  const limit = getDailyHongbaoCount(vipLevel);
  return {
    spinClaimed:    row?.spin_claimed || false,
    hongbaoUsed:    row?.hongbao_count || 0,
    hongbaoLimit:   limit,
    hongbaoLeft:    Math.max(0, limit - (row?.hongbao_count || 0)),
    prizes:         SPIN_PRIZES,
  };
}

module.exports = { spinWheel, openHongbao, getDailyStatus };
