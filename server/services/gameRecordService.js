// ════════════════════════════════════════
//  server/services/gameRecordService.js
//  牌局記錄、戰力統計、金幣結算
// ════════════════════════════════════════
const supabase  = require('../models/supabase');
const { settleGame } = require('./coinService');
const { addVPoints } = require('./vipService');
const logger    = require('../utils/logger');

/**
 * 遊戲結束後呼叫：結算金幣並寫入記錄
 * @param {Object} room         房間物件
 * @param {Object} endResult    mahjongEngine.doHu 回傳的結果
 */
async function settleAndRecord(room, endResult) {
  const { winner, winnerUid, method, gunSeat, taiResult } = endResult;
  const { baseBet, taiUnit, players } = room;
  const taiPay = (taiResult?.total || 0) * taiUnit;

  for (const player of players) {
    if (player.isAI) continue;
    const uid  = player.uid;
    const seat = player.seat;
    let delta  = 0;
    let huCount = 0, zimoCount = 0, fangCount = 0;

    if (!winner) {
      // 流局：底注已扣，不追加
      delta = 0;
    } else if (winnerUid === uid) {
      // 贏家：收回自己底注 + 3 家底注 + 台數
      delta   = 3 * baseBet + 3 * taiPay;
      huCount = 1;
      if (method === 'tsumo') zimoCount = 1;
    } else {
      // 輸家
      if (method === 'tsumo') {
        // 自摸：每家賠台數
        delta = -taiPay;
      } else {
        // 截胡：放槍者賠底注×2 + 台數×3；其他人無追加
        const gunPlayer = players.find(p => p.seat === gunSeat);
        if (gunPlayer?.uid === uid) {
          delta     = -(2 * baseBet + 3 * taiPay);
          fangCount = 1;
        }
      }
    }

    // 更新金幣
    const reason = winner
      ? (winnerUid === uid ? 'game_win' : (fangCount ? 'game_fangqiang' : 'game_zimo_loss'))
      : 'game_draw';
    if (delta !== 0) await settleGame(uid, delta, reason);

    // 寫入牌局記錄
    await supabase.from('game_records').insert({
      room_id:         room.roomId,
      uid,
      seat,
      win_lose_coins:  delta,
      hu_count:        huCount,
      zimo_count:      zimoCount,
      fangqiang_count: fangCount,
      tai_count:       winnerUid === uid ? (taiResult?.total || 0) : 0,
    });

    // 遊玩 1 萬金幣 = 1 V點（基於投入金額計算）
    const coinsPlayed = baseBet + Math.max(0, -delta);
    if (coinsPlayed >= 10000) {
      await addVPoints(uid, Math.floor(coinsPlayed / 10000), 'play');
    }

    logger.info(`Settle: ${uid} ${delta >= 0 ? '+' : ''}${delta} (${reason})`);
  }
}

/**
 * 取得玩家戰力統計（雷達圖用）
 */
async function getPlayerStats(uid) {
  const { data } = await supabase
    .from('game_records')
    .select('win_lose_coins,hu_count,zimo_count,fangqiang_count,played_at')
    .eq('uid', uid)
    .order('played_at', { ascending: false })
    .limit(200);

  if (!data || data.length === 0)
    return { games: 0, win_rate: '0%', hu_rate: '0%', zimo_rate: '0%', fangqiang_rate: '0%', recent: [] };

  const games      = data.length;
  const wins       = data.filter(r => r.win_lose_coins > 0).length;
  const hu         = data.reduce((s, r) => s + (r.hu_count || 0), 0);
  const zimo       = data.reduce((s, r) => s + (r.zimo_count || 0), 0);
  const fangqiang  = data.reduce((s, r) => s + (r.fangqiang_count || 0), 0);

  return {
    games,
    wins,
    win_rate:      pct(wins, games),
    hu_rate:       pct(hu,   games),
    zimo_rate:     pct(zimo, games),
    fangqiang_rate:pct(fangqiang, games),
    recent: data.slice(0, 20),
  };
}

function pct(n, d) { return d === 0 ? '0%' : ((n / d) * 100).toFixed(1) + '%'; }

module.exports = { settleAndRecord, getPlayerStats };
