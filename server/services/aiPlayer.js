// ════════════════════════════════════════
//  server/services/aiPlayer.js
//  AI 決策模組（出牌策略與搶牌判斷）
// ════════════════════════════════════════
const {
  checkWin, canPong, canKong, hasConcealedKong,
  concealedKongNames, chowOptions, isTing,
} = require('../../shared/mahjongRules');
const { ACTIONS, SEQS } = require('../../shared/constants');

// ── 搶牌視窗決策 ─────────────────────────
/**
 * 在有人出牌後，AI 決定要碰/槓/吃/胡/過
 * @param {Array}  hand  - AI 手牌
 * @param {Array}  melds - AI 已組合牌
 * @param {Object} tile  - 被出的牌
 * @param {string} relPos - 'next' | 'other'（AI 與出牌者的相對位置）
 * @returns {{ action: string, extra?: any }}
 */
function decideClaim(hand, melds, tile, relPos) {
  // 優先：胡
  if (checkWin([...hand, tile], melds)) return { action: ACTIONS.HU };

  // 明槓（需4張同名）
  if (canKong(hand, tile)) return { action: ACTIONS.KONG };

  // 碰（需2張同名，且對策略有益）
  if (canPong(hand, tile) && isPongWorthwhile(hand, melds, tile)) {
    return { action: ACTIONS.PONG };
  }

  // 吃（只有下一家可吃）
  if (relPos === 'next') {
    const opts = chowOptions(hand, tile);
    if (opts.length > 0 && isChowWorthwhile(hand, melds, opts[0])) {
      return { action: ACTIONS.CHOW, extra: { seq: opts[0] } };
    }
  }

  return { action: ACTIONS.PASS };
}

// ── 出牌回合決策 ─────────────────────────
/**
 * 輪到 AI 出牌時，決定要出哪張牌（或自摸/暗槓）
 * @param {Array} hand  - AI 手牌
 * @param {Array} melds - AI 已組合牌
 * @returns {{ action: string, extra?: any }}
 */
function decideDiscard(hand, melds) {
  // 自摸胡
  if (checkWin(hand, melds)) return { action: ACTIONS.HU };

  // 暗槓
  const kongs = concealedKongNames(hand);
  if (kongs.length > 0) return { action: ACTIONS.KONG, extra: { name: kongs[0] } };

  // 出牌
  const idx = chooseTileToDiscard(hand, melds);
  return { action: ACTIONS.PLAY, extra: { tileId: hand[idx]?.id } };
}

// ── 啟發式：碰牌是否有利 ─────────────────
function isPongWorthwhile(hand, melds, tile) {
  // 如果碰後聽牌數量沒變少，就碰
  const sim = hand.filter((t, i) => {
    if (t.name !== tile.name) return true;
    return false; // 移除其中2張
  });
  // 簡化：只要有 2 張同名就碰（AI 偏激進）
  return true;
}

// ── 啟發式：吃牌是否有利 ─────────────────
function isChowWorthwhile(hand, melds, seq) {
  // AI 簡化策略：吃牌後出的牌不比原本更孤立就吃
  return hand.length >= 3;
}

// ── 選最差的出牌 ─────────────────────────
function chooseTileToDiscard(hand) {
  let worstScore = Infinity;
  let worstIdx   = 0;
  hand.forEach((tile, i) => {
    const score = tileFitScore(hand, tile);
    if (score < worstScore) { worstScore = score; worstIdx = i; }
  });
  return worstIdx;
}

/**
 * 評估一張牌在手牌中的「配合分數」，越高越不該丟
 */
function tileFitScore(hand, tile) {
  const others = hand.filter(t => t !== tile).map(t => t.name);
  let score = 0;

  // 同名牌加分（刻子潛力）
  const sameCount = Math.min(others.filter(n => n === tile.name).length, 2);
  score += sameCount * 3;

  // 順子配合加分
  for (const seq of SEQS) {
    if (!seq.includes(tile.name)) continue;
    score += seq.filter(n => others.includes(n)).length * 2;
  }

  return score;
}

module.exports = { decideClaim, decideDiscard };
