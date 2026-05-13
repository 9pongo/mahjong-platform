// ════════════════════════════════════════
//  server/services/rankService.js
//  段位（Rank Point）系統
// ════════════════════════════════════════
const supabase = require('../models/supabase');
const logger   = require('../utils/logger');

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

    if (outcome === 'win') {
      // 台數加成：每台 +3，最高 +30 額外
      const taiBonus = Math.min(taiCount * 3, 30);
      delta  = RP_WIN + taiBonus;
      wins  += 1;
    } else if (outcome === 'loss') {
      delta   = RP_LOSS;
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

module.exports = {
  getCurrentSeason,
  getRankInfo,
  updateRankAfterGame,
  getUserRank,
  getRankLeaderboard,
  RANKS,
};
