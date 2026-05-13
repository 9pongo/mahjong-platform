// ════════════════════════════════════════
//  server/services/tournamentService.js
//  賽事系統：報名、積分更新、獎勵發放
// ════════════════════════════════════════
const supabase = require('../models/supabase');
const { addCoins } = require('./coinService');
const logger   = require('../utils/logger');

// ── 積分計算 ───────────────────────────
const SCORE_WIN  = 10;   // 勝局 +10
const SCORE_ZIMO =  5;   // 自摸額外 +5
const SCORE_TAI  =  2;   // 每台額外 +2（上限 20）

// 獎勵比例 Top3
const PRIZE_RATIO = [0.5, 0.3, 0.2];

/**
 * 取得進行中 & 即將開始的賽事列表
 */
async function getActiveTournaments() {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .in('status', ['upcoming', 'active'])
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * 取得賽事詳情 + 前 20 名排行
 * @param {string} tournamentId
 * @param {string|null} myUid
 */
async function getTournamentDetail(tournamentId, myUid = null) {
  const { data: t, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .maybeSingle();
  if (error || !t) return null;

  // 前 20 名（含 username）
  const { data: entries } = await supabase
    .from('tournament_entries')
    .select('uid, score, wins, rank, prize_coins, registered_at')
    .eq('tournament_id', tournamentId)
    .order('score', { ascending: false })
    .limit(20);

  // 取 username
  const uids = (entries || []).map(e => e.uid);
  let userMap = {};
  if (uids.length) {
    const { data: users } = await supabase.from('users')
      .select('uid, username, game_level').in('uid', uids);
    for (const u of users || []) userMap[u.uid] = u;
  }

  const leaderboard = (entries || []).map((e, i) => ({
    rank:       i + 1,
    uid:        e.uid,
    username:   userMap[e.uid]?.username || '玩家',
    game_level: userMap[e.uid]?.game_level || 1,
    score:      e.score,
    wins:       e.wins,
    prize_coins: e.prize_coins,
  }));

  // 我的報名狀態
  let myEntry = null;
  if (myUid) {
    const { data: me } = await supabase
      .from('tournament_entries')
      .select('score, wins, rank, prize_coins, registered_at')
      .eq('tournament_id', tournamentId)
      .eq('uid', myUid)
      .maybeSingle();
    if (me) {
      const myPos = leaderboard.findIndex(e => e.uid === myUid);
      myEntry = { ...me, position: myPos >= 0 ? myPos + 1 : null };
    }
  }

  // 總報名人數
  const { count } = await supabase
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId);

  return { tournament: t, leaderboard, myEntry, playerCount: count || 0 };
}

/**
 * 報名賽事（扣除報名費）
 */
async function registerTournament(tournamentId, uid) {
  const { data: t } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .maybeSingle();
  if (!t) throw new Error('賽事不存在');
  if (t.status === 'ended') throw new Error('賽事已結束');

  // 是否已報名
  const { data: exists } = await supabase
    .from('tournament_entries')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('uid', uid)
    .maybeSingle();
  if (exists) throw new Error('已報名此賽事');

  // 人數上限
  const { count } = await supabase
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId);
  if (count >= t.max_players) throw new Error('報名人數已達上限');

  // 扣除報名費
  if (t.entry_fee > 0) {
    const { data: user } = await supabase
      .from('users').select('coins').eq('uid', uid).maybeSingle();
    if (!user || user.coins < t.entry_fee)
      throw new Error(`金幣不足（需 ${t.entry_fee.toLocaleString()} 金幣）`);
    await addCoins(uid, -t.entry_fee, 'tournament_entry');
  }

  // 寫入報名
  await supabase.from('tournament_entries').insert({
    tournament_id: tournamentId,
    uid,
    score: 0,
    wins:  0,
  });

  return { ok: true, entry_fee: t.entry_fee, name: t.name };
}

/**
 * 遊戲結束後更新賽事積分（由 gameRecordService 呼叫）
 * @param {string} uid
 * @param {{ won: boolean, zimo: boolean, tai: number }} result
 */
async function updateTournamentScore(uid, { won, zimo, tai }) {
  if (!won) return;   // 只有勝者加分

  try {
    // 找出此玩家已報名、且目前 active 的賽事
    const { data: entries } = await supabase
      .from('tournament_entries')
      .select('id, tournament_id, score, wins')
      .eq('uid', uid);

    if (!entries?.length) return;

    const tournamentIds = entries.map(e => e.tournament_id);
    const { data: activeTours } = await supabase
      .from('tournaments')
      .select('id')
      .in('id', tournamentIds)
      .eq('status', 'active');

    if (!activeTours?.length) return;

    const activeIds = new Set(activeTours.map(t => t.id));
    const taiScore  = Math.min(tai * SCORE_TAI, 20);
    const gained    = SCORE_WIN + (zimo ? SCORE_ZIMO : 0) + taiScore;

    for (const entry of entries) {
      if (!activeIds.has(entry.tournament_id)) continue;
      await supabase.from('tournament_entries')
        .update({ score: entry.score + gained, wins: entry.wins + 1 })
        .eq('id', entry.id);
    }
  } catch (e) {
    logger.warn('[Tournament] updateTournamentScore 失敗：' + e.message);
  }
}

/**
 * 結束賽事並分配獎金（由 cron 呼叫）
 * @param {string} tournamentId
 */
async function closeTournament(tournamentId) {
  // 取前 3 名
  const { data: top } = await supabase
    .from('tournament_entries')
    .select('id, uid, score')
    .eq('tournament_id', tournamentId)
    .order('score', { ascending: false })
    .limit(3);

  const { data: t } = await supabase
    .from('tournaments')
    .select('prize_pool, name')
    .eq('id', tournamentId)
    .maybeSingle();

  const prizePool = t?.prize_pool || 0;

  // 發放獎金
  for (let i = 0; i < (top || []).length; i++) {
    const entry  = top[i];
    const prize  = Math.floor(prizePool * (PRIZE_RATIO[i] || 0));
    if (prize > 0) {
      await addCoins(entry.uid, prize, 'tournament_prize');
    }
    await supabase.from('tournament_entries')
      .update({ rank: i + 1, prize_coins: prize })
      .eq('id', entry.id);
  }

  // 標記結束
  await supabase.from('tournaments')
    .update({ status: 'ended' })
    .eq('id', tournamentId);

  logger.info(`[Tournament] 賽事 ${t?.name} 已結算，獎池 ${prizePool}`);
}

/**
 * Cron：將到期的 upcoming→active、active→ended
 */
async function tickTournaments() {
  const now = new Date().toISOString();

  // upcoming → active
  const { data: toActivate } = await supabase
    .from('tournaments')
    .select('id, name')
    .eq('status', 'upcoming')
    .lte('starts_at', now);
  for (const t of toActivate || []) {
    await supabase.from('tournaments').update({ status: 'active' }).eq('id', t.id);
    logger.info(`[Tournament] 賽事開始：${t.name}`);
  }

  // active → ended
  const { data: toEnd } = await supabase
    .from('tournaments')
    .select('id')
    .eq('status', 'active')
    .lte('ends_at', now);
  for (const t of toEnd || []) {
    await closeTournament(t.id);
  }
}

module.exports = {
  getActiveTournaments,
  getTournamentDetail,
  registerTournament,
  updateTournamentScore,
  tickTournaments,
  closeTournament,
};
