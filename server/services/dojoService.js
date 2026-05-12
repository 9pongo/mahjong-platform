// ════════════════════════════════════════
//  server/services/dojoService.js
//  道館 PvE 挑戰系統
// ════════════════════════════════════════
const supabase    = require('../models/supabase');
const { updateCoins } = require('./coinService');
const logger      = require('../utils/logger');

// ── 道館定義（對應 supabase/seed.sql）──────
const DOJO_DEFS = [
  { order: 1, id: 'village',  name: '新手村',       requiredWins: 3,  reward: 500,   desc: '適合初學者，AI 策略簡單' },
  { order: 2, id: 'town',     name: '小鎮廣場',     requiredWins: 5,  reward: 1200,  desc: 'AI 會基本碰槓吃' },
  { order: 3, id: 'teahouse', name: '江湖茶館',     requiredWins: 5,  reward: 2500,  desc: 'AI 懂得聽牌防守' },
  { order: 4, id: 'hall',     name: '天下第一廳',   requiredWins: 7,  reward: 5000,  desc: 'AI 有完整策略' },
  { order: 5, id: 'throne',   name: '麻將王座',     requiredWins: 10, reward: 12000, desc: '最高難度，百戰百勝才可通關' },
];

// ── 取得玩家道館進度 ──────────────────────
async function getDojoProgress(uid) {
  // 從 DB 拿進度
  const dojoIds = DOJO_DEFS.map(d => d.id);

  const { data: rows } = await supabase.from('player_dojo')
    .select('dojo_id, status, wins, unlocked_at')
    .eq('uid', uid)
    .in('dojo_id', dojoIds);

  const rowMap = {};
  for (const r of rows || []) rowMap[r.dojo_id] = r;

  return DOJO_DEFS.map((def, idx) => {
    const row   = rowMap[def.id] || { status: 'locked', wins: 0 };
    const prev  = idx === 0 ? null : DOJO_DEFS[idx - 1];

    // 解鎖條件：第一關直接開放，之後需上一關通關
    let status = row.status;
    if (idx === 0 && status === 'locked') status = 'available';
    if (prev && rowMap[prev.id]?.status === 'cleared' && status === 'locked') {
      status = 'available';
    }

    return {
      ...def,
      status,
      wins:        row.wins || 0,
      unlockedAt:  row.unlocked_at,
      pct:         Math.round(Math.min(1, (row.wins || 0) / def.requiredWins) * 100),
    };
  });
}

// ── 記錄贏局進度 ──────────────────────────
async function recordWin(uid, dojoId) {
  const def = DOJO_DEFS.find(d => d.id === dojoId);
  if (!def) return { ok: false, error: '道館不存在' };

  // 取現有進度
  const { data: row } = await supabase.from('player_dojo')
    .select('status, wins')
    .eq('uid', uid).eq('dojo_id', dojoId)
    .maybeSingle();

  if (row?.status === 'cleared') {
    return { ok: true, cleared: false, wins: row.wins, alreadyCleared: true };
  }

  const newWins  = (row?.wins || 0) + 1;
  const cleared  = newWins >= def.requiredWins;
  const newStatus = cleared ? 'cleared' : 'in_progress';

  await supabase.from('player_dojo').upsert({
    uid,
    dojo_id:     dojoId,
    status:      newStatus,
    wins:        newWins,
    unlocked_at: !row ? new Date().toISOString() : undefined,
  }, { onConflict: 'uid,dojo_id' });

  if (cleared) {
    await updateCoins(uid, def.reward, `dojo_clear_${dojoId}`);
    logger.info(`Dojo cleared: uid=${uid} dojo=${dojoId} reward=${def.reward}`);
  }

  return { ok: true, cleared, wins: newWins, required: def.requiredWins, reward: cleared ? def.reward : 0 };
}

module.exports = { DOJO_DEFS, getDojoProgress, recordWin };
