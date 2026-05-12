// ════════════════════════════════════════
//  server/services/achievementService.js
//  成就系統：定義 + 解鎖邏輯
// ════════════════════════════════════════
const supabase   = require('../models/supabase');
const { updateCoins } = require('./coinService');
const logger     = require('../utils/logger');

// ── 成就定義 ─────────────────────────────
// condition(stats) → boolean
// stats 由 _buildStats(uid) 計算
const ACHIEVEMENTS = [
  {
    id:      'first_game',
    name:    '初出茅廬',
    icon:    '🎯',
    desc:    '完成第一局麻將',
    reward:  100,
    condition: s => s.games >= 1,
  },
  {
    id:      'veteran_10',
    name:    '麻將新秀',
    icon:    '🀄',
    desc:    '完成 10 場對局',
    reward:  200,
    condition: s => s.games >= 10,
  },
  {
    id:      'veteran_100',
    name:    '百戰老兵',
    icon:    '🎖',
    desc:    '完成 100 場對局',
    reward:  1000,
    condition: s => s.games >= 100,
  },
  {
    id:      'veteran_500',
    name:    '麻將宗師',
    icon:    '👑',
    desc:    '完成 500 場對局',
    reward:  5000,
    condition: s => s.games >= 500,
  },
  {
    id:      'zimo_10',
    name:    '自摸達人',
    icon:    '✨',
    desc:    '累積自摸 10 次',
    reward:  300,
    condition: s => s.zimoTotal >= 10,
  },
  {
    id:      'zimo_50',
    name:    '自摸宗師',
    icon:    '🌟',
    desc:    '累積自摸 50 次',
    reward:  1500,
    condition: s => s.zimoTotal >= 50,
  },
  {
    id:      'win_streak_3',
    name:    '連勝三場',
    icon:    '🔥',
    desc:    '連續贏得 3 場對局',
    reward:  500,
    condition: s => s.currentStreak >= 3,
  },
  {
    id:      'win_streak_5',
    name:    '五連勝',
    icon:    '⚡',
    desc:    '連續贏得 5 場對局',
    reward:  1500,
    condition: s => s.currentStreak >= 5,
  },
  {
    id:      'high_tai',
    name:    '高台大師',
    icon:    '🏆',
    desc:    '單局胡牌達 8 台以上',
    reward:  800,
    condition: s => s.maxTai >= 8,
  },
  {
    id:      'rich_100k',
    name:    '金幣收藏家',
    icon:    '💰',
    desc:    '持有金幣達到 10 萬',
    reward:  0,
    condition: s => s.currentCoins >= 100000,
  },
  {
    id:      'rich_1m',
    name:    '百萬富翁',
    icon:    '💎',
    desc:    '持有金幣達到 100 萬',
    reward:  10000,
    condition: s => s.currentCoins >= 1000000,
  },
  {
    id:      'fangqiang_20',
    name:    '砲灰英雄',
    icon:    '😅',
    desc:    '累積放槍 20 次（好人卡）',
    reward:  200,
    condition: s => s.fangTotal >= 20,
  },
  {
    id:      'win_50pct',
    name:    '勝率達人',
    icon:    '📈',
    desc:    '50 場以上且勝率超過 50%',
    reward:  2000,
    condition: s => s.games >= 50 && s.wins / s.games >= 0.5,
  },
];

// ── 匯出成就清單（供前端顯示） ─────────────
const ACHIEVEMENT_MAP = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

// ── 建立玩家統計快照 ──────────────────────
async function _buildStats(uid) {
  const [userRes, recordsRes] = await Promise.all([
    supabase.from('users').select('coins').eq('uid', uid).single(),
    supabase.from('game_records')
      .select('win_lose_coins,zimo_count,fangqiang_count,tai_count,played_at')
      .eq('uid', uid)
      .order('played_at', { ascending: false })
      .limit(600),
  ]);

  const coins   = userRes.data?.coins || 0;
  const records = recordsRes.data || [];

  let wins = 0, zimoTotal = 0, fangTotal = 0, maxTai = 0;
  let currentStreak = 0, countingStreak = true;

  for (const r of records) {
    if (r.win_lose_coins > 0) {
      wins++;
      if (countingStreak) currentStreak++;
    } else {
      countingStreak = false;
    }
    zimoTotal += r.zimo_count || 0;
    fangTotal += r.fangqiang_count || 0;
    if ((r.tai_count || 0) > maxTai) maxTai = r.tai_count;
  }

  return {
    games:         records.length,
    wins,
    zimoTotal,
    fangTotal,
    maxTai,
    currentStreak,
    currentCoins:  coins,
  };
}

// ── 主函式：檢查並解鎖新成就 ──────────────
/**
 * @param {string} uid
 * @returns {Array} 新解鎖的成就清單（可用於即時通知）
 */
async function checkAchievements(uid) {
  try {
    // 1. 取已解鎖
    const { data: existing } = await supabase
      .from('user_achievements')
      .select('achievement')
      .eq('uid', uid);

    const unlocked = new Set((existing || []).map(r => r.achievement));

    // 2. 建立統計
    const stats = await _buildStats(uid);

    // 3. 比對條件
    const newlyUnlocked = [];
    for (const ach of ACHIEVEMENTS) {
      if (unlocked.has(ach.id)) continue;
      if (!ach.condition(stats)) continue;

      // 解鎖！
      const { error } = await supabase.from('user_achievements').insert({
        uid, achievement: ach.id,
      });
      if (error) continue;   // 可能 race condition，略過

      // 發放獎勵金幣
      if (ach.reward > 0) {
        await updateCoins(uid, ach.reward, `achievement_${ach.id}`).catch(() => {});
      }

      logger.info(`Achievement unlocked: ${uid} → ${ach.id}`);
      newlyUnlocked.push({ ...ach });
    }

    return newlyUnlocked;
  } catch (e) {
    logger.warn('checkAchievements error: ' + e.message);
    return [];
  }
}

// ── 取得玩家所有成就（含未解鎖）─────────────
async function getUserAchievements(uid) {
  const { data } = await supabase
    .from('user_achievements')
    .select('achievement, unlocked_at')
    .eq('uid', uid);

  const unlocked = {};
  for (const row of (data || [])) {
    unlocked[row.achievement] = row.unlocked_at;
  }

  return ACHIEVEMENTS.map(a => ({
    ...a,
    condition: undefined,     // 不傳條件函式給前端
    unlocked:  !!unlocked[a.id],
    unlockedAt: unlocked[a.id] || null,
  }));
}

module.exports = { checkAchievements, getUserAchievements, ACHIEVEMENTS, ACHIEVEMENT_MAP };
