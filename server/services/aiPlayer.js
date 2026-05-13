// ════════════════════════════════════════
//  server/services/aiPlayer.js
//  AI 決策模組 — 支援三種難度
//
//  easy   → 隨機出牌、低頻率碰吃（新手 AI）
//  normal → 基本策略：最差牌先出、有利必碰  （標準 AI，原有行為）
//  hard   → 讀牌山殘局 + 防守聽牌席（進階 AI）
// ════════════════════════════════════════
const {
  checkWin, canPong, canKong, hasConcealedKong,
  concealedKongNames, addKongNames, chowOptions, isTing,
} = require('../../shared/mahjongRules');
const { ACTIONS, SEQS, HONOR } = require('../../shared/constants');

// ══════════════════════════════════════
//  公開 API
// ══════════════════════════════════════

/**
 * 搶牌視窗決策
 * @param {Array}  hand
 * @param {Array}  melds
 * @param {Object} tile       被出的牌
 * @param {string} relPos     'next' | 'other'
 * @param {string} level      'easy' | 'normal' | 'hard'
 * @param {Object} ctx        { pile:[], isTingSeats:[] }
 */
function decideClaim(hand, melds, tile, relPos, level = 'normal', ctx = {}) {
  // 任何難度：能胡必胡
  if (checkWin([...hand, tile], melds)) return { action: ACTIONS.HU };

  if (level === 'easy')   return _claimEasy(hand, melds, tile, relPos);
  if (level === 'hard')   return _claimHard(hand, melds, tile, relPos, ctx);
  return _claimNormal(hand, melds, tile, relPos);
}

/**
 * 出牌回合決策
 * @param {Array}  hand
 * @param {Array}  melds
 * @param {string} level
 * @param {Object} ctx   { pile:[], isTingSeats:[] }
 */
function decideDiscard(hand, melds, level = 'normal', ctx = {}) {
  // 任何難度：能自摸必自摸
  if (checkWin(hand, melds)) return { action: ACTIONS.HU };

  // 任何難度：有暗槓就槓（先補一張再出牌）
  const kongs = concealedKongNames(hand);
  if (kongs.length > 0) return { action: ACTIONS.KONG, extra: { name: kongs[0] } };

  // 任何難度：有加槓就槓
  const addKongs = addKongNames(hand, melds);
  if (addKongs.length > 0) return { action: ACTIONS.KONG, extra: { name: addKongs[0] } };

  if (level === 'easy')   return _discardEasy(hand, melds);
  if (level === 'hard')   return _discardHard(hand, melds, ctx);
  return _discardNormal(hand, melds, ctx);
}

// ══════════════════════════════════════
//  EASY — 新手 AI
//  隨機性高，很少碰吃，出牌常走偏
// ══════════════════════════════════════
function _claimEasy(hand, melds, tile, relPos) {
  // 明槓：35% 機率
  if (canKong(hand, tile) && Math.random() < 0.35)
    return { action: ACTIONS.KONG };
  // 碰：30% 機率
  if (canPong(hand, tile) && Math.random() < 0.30)
    return { action: ACTIONS.PONG };
  // 吃：20% 機率（僅下家）
  if (relPos === 'next') {
    const opts = chowOptions(hand, tile);
    if (opts.length && Math.random() < 0.20)
      return { action: ACTIONS.CHOW, extra: { seq: opts[0] } };
  }
  return { action: ACTIONS.PASS };
}

function _discardEasy(hand) {
  // 30% 純隨機丟牌
  if (Math.random() < 0.30) {
    const idx = Math.floor(Math.random() * hand.length);
    return { action: ACTIONS.PLAY, extra: { tileId: hand[idx].id } };
  }
  // 其餘用基本評分 + 隨機雜訊（±1.5）
  let worst = Infinity, idx = 0;
  hand.forEach((tile, i) => {
    const score = tileFitScore(hand, tile) + (Math.random() * 3 - 1.5);
    if (score < worst) { worst = score; idx = i; }
  });
  return { action: ACTIONS.PLAY, extra: { tileId: hand[idx].id } };
}

// ══════════════════════════════════════
//  NORMAL — 標準 AI（原有行為保留）
// ══════════════════════════════════════
function _claimNormal(hand, melds, tile, relPos) {
  // 明槓
  if (canKong(hand, tile)) return { action: ACTIONS.KONG };
  // 碰（偏激進：有就碰）
  if (canPong(hand, tile)) return { action: ACTIONS.PONG };
  // 吃
  if (relPos === 'next') {
    const opts = chowOptions(hand, tile);
    if (opts.length && hand.length >= 3)
      return { action: ACTIONS.CHOW, extra: { seq: opts[0] } };
  }
  return { action: ACTIONS.PASS };
}

function _discardNormal(hand, melds, ctx = {}) {
  const { isTingSeats = [] } = ctx;
  const idx = _worstTileIdx(hand, (tile) => {
    // 有人聽牌時：字牌更安全，降低其分數讓它更容易被丟出
    if (isTingSeats.length > 0 && HONOR.includes(tile.name)) return -2;
    return 0;
  });
  return { action: ACTIONS.PLAY, extra: { tileId: hand[idx].id } };
}

// ══════════════════════════════════════
//  HARD — 進階 AI
//  讀牌山、防守聽牌、選最佳吃牌順序
// ══════════════════════════════════════
function _claimHard(hand, melds, tile, relPos, ctx) {
  const { isTingSeats = [] } = ctx;
  const someoneIsTing = isTingSeats.length > 0;

  // 明槓：有人聽牌時保守不槓（槓後要出牌，怕放炮）
  if (canKong(hand, tile) && !someoneIsTing)
    return { action: ACTIONS.KONG };

  // 碰：只碰能改善孤立牌比例的情況
  if (canPong(hand, tile) && _pongImproves(hand, melds, tile))
    return { action: ACTIONS.PONG };

  // 吃：有人聽牌時不吃；選最佳序列
  if (relPos === 'next' && !someoneIsTing) {
    const opts = chowOptions(hand, tile);
    if (opts.length) {
      const best = _bestChowOption(hand, melds, tile, opts);
      if (best) return { action: ACTIONS.CHOW, extra: { seq: best } };
    }
  }
  return { action: ACTIONS.PASS };
}

function _discardHard(hand, melds, ctx) {
  const { pile = [], isTingSeats = [] } = ctx;
  const pileCount = _buildPileCount(pile);

  const idx = _worstTileIdx(hand, (tile) => {
    let bonus = 0;
    const seen = pileCount[tile.name] || 0;

    // 牌山已出 3 張以上 → 死牌，強烈建議丟出（分數降低 = 更應丟）
    if (seen >= 3) bonus -= 6;
    else if (seen >= 2) bonus -= 2;

    // 有人聽牌時，字牌（字張）更安全 → 應優先留字牌（不丟）
    // 實作：若有人聽牌且該牌是數字牌，給出牌候選加懲罰（讓它不那麼容易被選中丟出）
    if (isTingSeats.length > 0 && !HONOR.includes(tile.name)) {
      // 數字牌在別人聽牌時較危險，保守點（降低丟出意願 → bonus 加正值讓 score 高）
      bonus += 1;
    }

    return bonus;
  });

  return { action: ACTIONS.PLAY, extra: { tileId: hand[idx].id } };
}

// ══════════════════════════════════════
//  共用工具
// ══════════════════════════════════════

/** 選最差出牌（分數最低的牌）；adjFn(tile)→number 讓難度可調整 */
function _worstTileIdx(hand, adjFn) {
  let worst = Infinity, idx = 0;
  hand.forEach((tile, i) => {
    const score = tileFitScore(hand, tile) + adjFn(tile);
    if (score < worst) { worst = score; idx = i; }
  });
  return idx;
}

/** 評估一張牌在手牌中的「配合分數」，越高越不該丟 */
function tileFitScore(hand, tile) {
  const others = hand.filter(t => t !== tile).map(t => t.name);
  let score = 0;

  // 同名牌（刻子潛力）
  const sameCount = Math.min(others.filter(n => n === tile.name).length, 2);
  score += sameCount * 3;

  // 順子配合
  for (const seq of SEQS) {
    if (!seq.includes(tile.name)) continue;
    score += seq.filter(n => others.includes(n)).length * 2;
  }

  return score;
}

/** 建立牌山已出牌計數表 */
function _buildPileCount(pile) {
  const cnt = {};
  for (const t of pile) cnt[t.name] = (cnt[t.name] || 0) + 1;
  return cnt;
}

/** 碰牌後是否改善孤立牌數量（或至少不惡化） */
function _pongImproves(hand, melds, tile) {
  const before = _countIsolated(hand, melds);
  // 模擬碰：移除 2 張同名牌
  let removed = 0;
  const afterHand = hand.filter(t => {
    if (t.name === tile.name && removed < 2) { removed++; return false; }
    return true;
  });
  const afterMelds = [...melds, [tile, tile, tile]]; // 碰形成的刻子
  const after = _countIsolated(afterHand, afterMelds);
  return after <= before;
}

/** 計算手牌中孤立（無任何配合）的牌張數 */
function _countIsolated(hand, melds) {
  const names = hand.map(t => t.name);
  return hand.filter(tile => {
    // 有對子或刻子潛力 → 不孤立
    if (names.filter(n => n === tile.name).length >= 2) return false;
    // 有順子配合 → 不孤立
    for (const seq of SEQS) {
      if (!seq.includes(tile.name)) continue;
      const others = seq.filter(n => n !== tile.name);
      if (others.some(n => names.includes(n))) return false;
    }
    return true; // 孤立
  }).length;
}

/** 選最佳吃牌序列（吃完後孤立牌最少） */
function _bestChowOption(hand, melds, tile, opts) {
  let best = null, bestIsolated = Infinity;
  for (const opt of opts) {
    // 模擬吃：從手牌移除序列中非吃入牌的2張
    let removed = 0;
    const toRemove = opt.filter(n => n !== tile.name);
    const afterHand = hand.filter(t => {
      if (toRemove.includes(t.name) && removed < 2) { removed++; return false; }
      return true;
    });
    const isolated = _countIsolated(afterHand, melds);
    if (isolated < bestIsolated) { bestIsolated = isolated; best = opt; }
  }
  return best;
}

module.exports = { decideClaim, decideDiscard };
