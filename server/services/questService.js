// ════════════════════════════════════════
//  server/services/questService.js
//  每日 / 每週任務系統
// ════════════════════════════════════════
const supabase      = require('../models/supabase');
const { updateCoins } = require('./coinService');
const logger        = require('../utils/logger');

// ── 台灣時間工具 ──────────────────────────
function todayTW() {
  const d = new Date(Date.now() + 8 * 3600000);
  return d.toISOString().slice(0, 10);           // 'YYYY-MM-DD'
}
function weekKeyTW() {
  const d   = new Date(Date.now() + 8 * 3600000);
  const dow = d.getDay() || 7;                   // 1=Mon … 7=Sun
  const mon = new Date(d);
  mon.setDate(d.getDate() - (dow - 1));
  return mon.toISOString().slice(0, 10);         // 本週一日期
}

// ── 任務定義 ──────────────────────────────
// metric 對應 updateQuestProgress() 的呼叫鍵值
const QUEST_DEFS = [
  // 每日
  { id: 'daily_login',   type: 'daily',  name: '每日登入',        icon: '📅', goal: 1,  metric: 'login',        reward: 100  },
  { id: 'daily_play3',   type: 'daily',  name: '出戰 3 場',       icon: '🀄', goal: 3,  metric: 'games_played', reward: 300  },
  { id: 'daily_win1',    type: 'daily',  name: '贏牌 1 場',       icon: '🏆', goal: 1,  metric: 'games_won',    reward: 500  },
  { id: 'daily_zimo1',   type: 'daily',  name: '自摸 1 次',       icon: '✨', goal: 1,  metric: 'zimo',         reward: 200  },
  // 每週
  { id: 'weekly_play20', type: 'weekly', name: '本週出戰 20 場',  icon: '🎮', goal: 20, metric: 'games_played', reward: 2000 },
  { id: 'weekly_win5',   type: 'weekly', name: '本週贏牌 5 場',   icon: '👑', goal: 5,  metric: 'games_won',    reward: 3000 },
  { id: 'weekly_tai10',  type: 'weekly', name: '本週累積 10 台',  icon: '🌟', goal: 10, metric: 'tai',          reward: 1500 },
];

// 任務唯一 ID = def.id + '_' + 週期日期
function periodKey(def) {
  return def.type === 'daily' ? todayTW() : weekKeyTW();
}
function questRowId(def) {
  return `${def.id}__${periodKey(def)}`;
}

// ── 取得玩家任務列表（含本期進度）──────────
async function getQuests(uid) {
  const rowIds = QUEST_DEFS.map(questRowId);

  const { data: rows } = await supabase
    .from('quests')
    .select('quest_id, progress, completed, claimed')
    .eq('uid', uid)
    .in('quest_id', rowIds);

  const rowMap = {};
  for (const r of rows || []) rowMap[r.quest_id] = r;

  // 初始化尚未建立的任務列
  const missing = rowIds.filter(id => !rowMap[id]);
  if (missing.length) {
    const inserts = missing.map(id => ({
      uid, quest_id: id, progress: 0, completed: false, claimed: false,
    }));
    await supabase.from('quests').insert(inserts).select(); // 忽略衝突
  }

  return QUEST_DEFS.map(def => {
    const rid = questRowId(def);
    const row = rowMap[rid] || { progress: 0, completed: false, claimed: false };
    const prog = Math.min(row.progress, def.goal);
    return {
      questId:   rid,
      defId:     def.id,
      type:      def.type,
      name:      def.name,
      icon:      def.icon,
      goal:      def.goal,
      progress:  prog,
      completed: prog >= def.goal,
      claimed:   row.claimed,
      reward:    def.reward,
      pct:       Math.round((prog / def.goal) * 100),
    };
  });
}

// ── 更新任務進度（遊戲結束後呼叫）──────────
async function updateQuestProgress(uid, metrics) {
  // metrics = { games_played?: n, games_won?: n, zimo?: n, tai?: n, login?: n }
  const entries = Object.entries(metrics).filter(([, v]) => v > 0);
  if (!entries.length) return;

  for (const [metric, amount] of entries) {
    const matching = QUEST_DEFS.filter(d => d.metric === metric);
    for (const def of matching) {
      const rid = questRowId(def);

      const { data } = await supabase
        .from('quests')
        .select('progress')
        .eq('uid', uid)
        .eq('quest_id', rid)
        .maybeSingle();

      const oldProg = data?.progress || 0;
      if (oldProg >= def.goal) continue;           // 已達標，不更新

      const newProg    = Math.min(oldProg + amount, def.goal);
      const completed  = newProg >= def.goal;
      await supabase.from('quests').upsert({
        uid, quest_id: rid, progress: newProg,
        completed, claimed: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'uid,quest_id' });

      if (completed) {
        logger.info(`Quest completed: uid=${uid} quest=${rid}`);
      }
    }
  }
}

// ── 領取獎勵 ──────────────────────────────
async function claimQuest(uid, questId) {
  const { data, error } = await supabase
    .from('quests')
    .select('progress, completed, claimed')
    .eq('uid', uid)
    .eq('quest_id', questId)
    .maybeSingle();

  if (!data)             return { ok: false, error: '任務不存在' };
  if (!data.completed)   return { ok: false, error: '任務尚未完成' };
  if (data.claimed)      return { ok: false, error: '已領取過' };

  // 找到 def
  const defId = questId.split('__')[0];       // 'daily_win1' 等
  const def   = QUEST_DEFS.find(d => d.id === defId);
  if (!def) return { ok: false, error: '任務定義不存在' };

  await supabase.from('quests')
    .update({ claimed: true })
    .eq('uid', uid)
    .eq('quest_id', questId);

  await updateCoins(uid, def.reward, 'quest_reward');
  logger.info(`Quest claimed: uid=${uid} quest=${questId} +${def.reward}`);

  return { ok: true, coins: def.reward, name: def.name };
}

module.exports = { getQuests, updateQuestProgress, claimQuest };
