// ════════════════════════════════════════
//  server/services/tournamentService.js
//  賽事系統：報名、積分更新、獎勵發放
// ════════════════════════════════════════
const supabase    = require('../models/supabase');
const { addCoins } = require('./coinService');
const logger      = require('../utils/logger');
// pushService 選擇性載入（未設定 VAPID 時靜默忽略）
let _sendPush;
try { _sendPush = require('./pushService').sendPush; } catch (_) {}
const sendPush = (uid, payload) => _sendPush ? _sendPush(uid, payload).catch(() => {}) : Promise.resolve();

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

  // 推播通知前三名
  for (let i = 0; i < (top || []).length; i++) {
    const entry = top[i];
    const prize = Math.floor(prizePool * (PRIZE_RATIO[i] || 0));
    const medal = ['🥇', '🥈', '🥉'][i];
    if (prize > 0) {
      sendPush(entry.uid, {
        title: `${medal} 賽事結算：${t?.name || '賽事'}`,
        body:  `恭喜您獲得第 ${i + 1} 名！獎勵 ${prize.toLocaleString()} 金幣已入帳`,
        tag:   'tournament-prize',
        data:  { url: '/pages/tournament.html' },
      });
    }
  }
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

    // 推播通知所有已報名玩家
    const { data: entries } = await supabase
      .from('tournament_entries')
      .select('uid')
      .eq('tournament_id', t.id);
    for (const e of entries || []) {
      sendPush(e.uid, {
        title: `🏆 賽事開始：${t.name}`,
        body:  '您報名的賽事現在開始了，快去參加！',
        tag:   `tournament-start-${t.id}`,
        data:  { url: '/pages/tournament.html' },
      });
    }
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

/**
 * 自動建立每日 / 週賽（由 Cron 每日 00:05 台灣時間呼叫）
 * - daily：每天 08:00～隔天 08:00 台灣時間
 * - weekly：每週一 00:00～週日 23:59 台灣時間（僅週一建立）
 */
async function autoCreateTournaments() {
  const now     = new Date();
  const twNow   = new Date(now.getTime() + 8 * 3600 * 1000);  // UTC+8
  const twDay   = twNow.getUTCDay();   // 0=Sun,1=Mon,...
  const twDate  = twNow.toISOString().slice(0, 10);

  // ── 每日賽 ────────────────────────────────
  const dailyStart = new Date(`${twDate}T08:00:00+08:00`);
  const dailyEnd   = new Date(dailyStart.getTime() + 24 * 3600 * 1000);

  // 避免重複建立（同日期已有 daily 賽事）
  const { data: existingDaily } = await supabase
    .from('tournaments')
    .select('id')
    .eq('type', 'daily')
    .gte('starts_at', dailyStart.toISOString())
    .lt('starts_at', dailyEnd.toISOString())
    .maybeSingle();

  if (!existingDaily) {
    await supabase.from('tournaments').insert({
      name:        `每日賽 ${twDate}`,
      description: '每天自動舉辦的限時賽事，免費報名，積分最高者獲勝！',
      type:        'daily',
      entry_fee:   0,
      prize_pool:  5000,
      max_players: 200,
      status:      dailyStart <= now ? 'active' : 'upcoming',
      starts_at:   dailyStart.toISOString(),
      ends_at:     dailyEnd.toISOString(),
    });
    logger.info(`[Tournament] 自動建立每日賽：${twDate}`);
  }

  // ── 週賽（僅週一建立）────────────────────
  if (twDay === 1) {
    const weekStart = new Date(`${twDate}T00:00:00+08:00`);
    // 找下個週日 23:59
    const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 3600 * 1000 + 23 * 3600 * 1000 + 59 * 60 * 1000);

    const { data: existingWeekly } = await supabase
      .from('tournaments')
      .select('id')
      .eq('type', 'weekly')
      .gte('starts_at', weekStart.toISOString())
      .maybeSingle();

    if (!existingWeekly) {
      await supabase.from('tournaments').insert({
        name:        `週賽 W${twNow.getUTCFullYear()}-${String(Math.ceil(twNow.getUTCDate() / 7)).padStart(2,'0')}`,
        description: '每週舉辦的積分賽，報名費 100 金幣，前三名瓜分萬幣獎池！',
        type:        'weekly',
        entry_fee:   100,
        prize_pool:  30000,
        max_players: 500,
        status:      'active',
        starts_at:   weekStart.toISOString(),
        ends_at:     weekEnd.toISOString(),
      });
      logger.info(`[Tournament] 自動建立週賽：${twDate}`);
    }
  }
}

module.exports = {
  getActiveTournaments,
  getTournamentDetail,
  registerTournament,
  updateTournamentScore,
  tickTournaments,
  closeTournament,
  autoCreateTournaments,
};
