// ════════════════════════════════════════
//  server/services/rankService.js
//  段位（Rank Point）系統
// ════════════════════════════════════════
const supabase = require('../models/supabase');
const logger   = require('../utils/logger');
const { getRpMultiplier } = require('./eventService');

// ── 段位定義 ─────────────────────────────
const RANKS = [
  { name: '新手',   emoji: '🥚', minRp:     0 },
  { name: '初段',   emoji: '🎋', minRp:   100 },
  { name: '二段',   emoji: '🎍', minRp:   300 },
  { name: '三段',   emoji: '🀄', minRp:   600 },
  { name: '四段',   emoji: '🏯', minRp:  1000 },
  { name: '五段',   emoji: '🐉', minRp:  1500 },
  { name: '宗師',   emoji: '👑', minRp:  2200 },
];

// ── 賽季結算獎勵 ────────────────────────
const SEASON_REWARDS = {
  '新手': { coins:      0, diamonds:   0 },
  '初段': { coins:    500, diamonds:   0 },
  '二段': { coins:  1_500, diamonds:   0 },
  '三段': { coins:  3_000, diamonds:  20 },
  '四段': { coins:  5_000, diamonds:  50 },
  '五段': { coins:  8_000, diamonds: 100 },
  '宗師': { coins: 20_000, diamonds: 300 },
};

// RP 勝負變化：基礎值（後乘倍率）
const RP_WIN  =  25;
const RP_LOSS = -15;
const RP_DRAW =   0;

// ── 工具 ─────────────────────────────────

/** 回傳當前賽季：yyyyMM 整數，例如 202606 */
function getCurrentSeason() {
  const now = new Date();
  return now.getFullYear() * 100 + (now.getMonth() + 1);
}

/** 依 rp 取得段位資訊 */
function getRankInfo(rp) {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (rp >= r.minRp) rank = r;
    else break;
  }
  const nextIdx = RANKS.indexOf(rank) + 1;
  const next    = RANKS[nextIdx] || null;
  return {
    name:   rank.name,
    emoji:  rank.emoji,
    rp,
    minRp:  rank.minRp,
    nextRp: next?.minRp ?? null,
    nextName: next?.name ?? null,
  };
}

// ── 核心操作 ─────────────────────────────

/**
 * 遊戲結束後更新段位
 * @param {string} uid
 * @param {'win'|'loss'|'draw'} outcome
 * @param {number} [taiCount=0] 台數（勝者）
 */
async function updateRankAfterGame(uid, outcome, taiCount = 0) {
  try {
    const season = getCurrentSeason();

    // 取得目前段位資料（若不存在則建立）
    let { data: row } = await supabase
      .from('user_ranks')
      .select('*')
      .eq('uid', uid)
      .single();

    // 賽季重置：若不同賽季則歸檔並清零
    if (row && row.season !== season) {
      await supabase.from('rank_history').insert({
        uid,
        season:    row.season,
        final_rp:  row.rp,
        rank_name: getRankInfo(row.rp).name,
      });
      row = null; // 強制重置
    }

    const curRp   = row?.rp   ?? 0;
    const curWins = row?.wins  ?? 0;
    const curLoss = row?.losses ?? 0;

    // 計算 RP 變化
    let delta = 0;
    let wins  = curWins;
    let losses = curLoss;

    // RP 活動倍率（rp_bonus 活動時生效）
    const rpMultiplier = await getRpMultiplier().catch(() => 1);

    if (outcome === 'win') {
      // 台數加成：每台 +3，最高 +30 額外
      const taiBonus = Math.min(taiCount * 3, 30);
      delta  = Math.round((RP_WIN + taiBonus) * rpMultiplier);
      wins  += 1;
    } else if (outcome === 'loss') {
      delta   = RP_LOSS;   // 負分不受活動加成影響
      losses += 1;
    } else {
      delta = RP_DRAW;
    }

    const newRp = Math.max(0, curRp + delta);

    await supabase.from('user_ranks').upsert({
      uid,
      rp:         newRp,
      season,
      wins,
      losses,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'uid' });

    logger.info(`[Rank] ${uid} ${outcome} rp ${curRp} → ${newRp} (${delta >= 0 ? '+' : ''}${delta})`);
    return { rp: newRp, delta, rankInfo: getRankInfo(newRp) };
  } catch (e) {
    logger.error(`[Rank] updateRankAfterGame error: ${e.message}`);
    return null;
  }
}

/**
 * 取得玩家當前段位
 */
async function getUserRank(uid) {
  const season = getCurrentSeason();
  const { data } = await supabase
    .from('user_ranks')
    .select('*')
    .eq('uid', uid)
    .single();

  if (!data || data.season !== season) {
    return { uid, rp: 0, season, wins: 0, losses: 0, ...getRankInfo(0) };
  }
  return { ...data, ...getRankInfo(data.rp) };
}

/**
 * 本賽季排行榜（前 N 名）
 */
async function getRankLeaderboard(limit = 20) {
  const season = getCurrentSeason();
  const { data, error } = await supabase
    .from('user_ranks')
    .select('uid, rp, wins, losses')
    .eq('season', season)
    .order('rp', { ascending: false })
    .limit(limit);

  if (error) throw error;
  if (!data?.length) return [];

  // 補 username
  const uids = data.map(r => r.uid);
  const { data: users } = await supabase
    .from('users')
    .select('uid, username, game_level, vip_level')
    .in('uid', uids);

  const userMap = {};
  for (const u of users || []) userMap[u.uid] = u;

  return data.map((r, i) => ({
    rank:       i + 1,
    uid:        r.uid,
    rp:         r.rp,
    wins:       r.wins,
    losses:     r.losses,
    ...getRankInfo(r.rp),
    username:   userMap[r.uid]?.username  ?? '—',
    game_level: userMap[r.uid]?.game_level ?? 1,
    vip_level:  userMap[r.uid]?.vip_level  ?? 0,
  }));
}

/**
 * 賽季結算：發放所有玩家的段位獎勵
 * 由 Cron 在每月最後一天呼叫
 * @param {number} [season] 預設為當前賽季
 */
async function settleSeasonRewards(season) {
  const coinService    = require('./coinService');
  const diamondService = require('./shopService');

  const targetSeason = season || getCurrentSeason();
  logger.info(`[Rank] 開始賽季 ${targetSeason} 結算`);

  // 取出本賽季所有玩家
  const { data: rows, error } = await supabase
    .from('user_ranks')
    .select('uid, rp, season')
    .eq('season', targetSeason)
    .gt('rp', 0); // 只結算有參賽的玩家

  if (error) throw error;
  if (!rows?.length) {
    logger.info(`[Rank] 賽季 ${targetSeason} 無玩家需結算`);
    return { count: 0 };
  }

  let rewarded = 0;
  for (const row of rows) {
    try {
      const rankInfo = getRankInfo(row.rp);
      const reward   = SEASON_REWARDS[rankInfo.name];
      if (!reward || (reward.coins === 0 && reward.diamonds === 0)) continue;

      // 發放金幣
      if (reward.coins > 0) {
        await coinService.addCoins(row.uid, reward.coins, `season_reward_${targetSeason}`);
      }
      // 發放鑽石
      if (reward.diamonds > 0) {
        await supabase.rpc('update_diamonds_atomic', {
          p_uid:    row.uid,
          p_delta:  reward.diamonds,
          p_reason: `season_reward_${targetSeason}`,
        });
      }

      // 歸檔到 rank_history（含獎勵資訊）
      await supabase.from('rank_history').upsert({
        uid:              row.uid,
        season:           targetSeason,
        final_rp:         row.rp,
        rank_name:        rankInfo.name,
        reward_coins:     reward.coins,
        reward_diamonds:  reward.diamonds,
        rewarded_at:      new Date().toISOString(),
      }, { onConflict: 'uid,season' });

      rewarded++;
      logger.info(`[Rank] ${row.uid} 賽季 ${targetSeason} 結算 ${rankInfo.name} → ${reward.coins}金幣 ${reward.diamonds}鑽石`);
    } catch (e) {
      logger.error(`[Rank] ${row.uid} 結算失敗: ${e.message}`);
    }
  }

  logger.info(`[Rank] 賽季 ${targetSeason} 結算完成，共 ${rewarded}/${rows.length} 人`);
  return { count: rewarded, total: rows.length };
}

/**
 * 取得玩家的歷史賽季記錄（含獎勵）
 */
async function getSeasonHistory(uid, limit = 6) {
  const { data } = await supabase
    .from('rank_history')
    .select('season, final_rp, rank_name, reward_coins, reward_diamonds, rewarded_at')
    .eq('uid', uid)
    .order('season', { ascending: false })
    .limit(limit);
  return data || [];
}

module.exports = {
  getCurrentSeason,
  getRankInfo,
  updateRankAfterGame,
  getUserRank,
  getRankLeaderboard,
  settleSeasonRewards,
  getSeasonHistory,
  RANKS,
  SEASON_REWARDS,
};
