// ════════════════════════════════════════
//  server/services/aiPlayer.js
//  AI 決策模組 — 支援三種難度
//
//  easy   → 隨機出牌、低頻率碰吃
//  normal → 孤張優先 + 安全牌意識 + 防守
//  hard   → 向聽數 + 危牌偵測 + 讀牌山
// ════════════════════════════════════════
const {
  checkWin, canPong, canKong, hasConcealedKong,
  concealedKongNames, addKongNames, chowOptions, isTing,
} = require('../../shared/mahjongRules');
const { ACTIONS, SEQS, HONOR, WAN, TONG, SUO } = require('../../shared/constants');

// ══════════════════════════════════════
//  公開 API
// ══════════════════════════════════════

/**
 * 搶牌視窗決策
 * ctx: { pile, isTingSeats, allOpponentMelds }
 */
function decideClaim(hand, melds, tile, relPos, level = 'normal', ctx = {}) {
  if (checkWin([...hand, tile], melds)) return { action: ACTIONS.HU };

  if (level === 'easy')   return _claimEasy(hand, melds, tile, relPos);
  if (level === 'hard')   return _claimHard(hand, melds, tile, relPos, ctx);
  return _claimNormal(hand, melds, tile, relPos, ctx);
}

/**
 * 出牌回合決策
 * ctx: { pile, isTingSeats, allOpponentMelds }
 */
function decideDiscard(hand, melds, level = 'normal', ctx = {}) {
  if (checkWin(hand, melds)) return { action: ACTIONS.HU };

  // 任何難度：暗槓 / 加槓
  const kongs = concealedKongNames(hand);
  if (kongs.length > 0) return { action: ACTIONS.KONG, extra: { name: kongs[0] } };
  const addKongs = addKongNames(hand, melds);
  if (addKongs.length > 0) return { action: ACTIONS.KONG, extra: { name: addKongs[0] } };

  if (level === 'easy')   return _discardEasy(hand, melds);
  if (level === 'hard')   return _discardHard(hand, melds, ctx);
  return _discardNormal(hand, melds, ctx);
}

// ══════════════════════════════════════
//  EASY — 新手 AI
// ══════════════════════════════════════
function _claimEasy(hand, melds, tile, relPos) {
  if (canKong(hand, tile) && Math.random() < 0.35)
    return { action: ACTIONS.KONG };
  if (canPong(hand, tile) && Math.random() < 0.30)
    return { action: ACTIONS.PONG };
  if (relPos === 'next') {
    const opts = chowOptions(hand, tile);
    if (opts.length && Math.random() < 0.20)
      return { action: ACTIONS.CHOW, extra: { seq: opts[0] } };
  }
  return { action: ACTIONS.PASS };
}

function _discardEasy(hand) {
  if (Math.random() < 0.30) {
    const idx = Math.floor(Math.random() * hand.length);
    return { action: ACTIONS.PLAY, extra: { tileId: hand[idx].id } };
  }
  let worst = Infinity, idx = 0;
  hand.forEach((tile, i) => {
    const score = _tileFitScore(hand, tile) + (Math.random() * 3 - 1.5);
    if (score < worst) { worst = score; idx = i; }
  });
  return { action: ACTIONS.PLAY, extra: { tileId: hand[idx].id } };
}

// ══════════════════════════════════════
//  NORMAL — 標準 AI
//  孤張優先 + 安全牌意識
// ══════════════════════════════════════
function _claimNormal(hand, melds, tile, relPos, ctx = {}) {
  const { isTingSeats = [] } = ctx;
  const someoneIsTing = isTingSeats.length > 0;

  if (canKong(hand, tile)) return { action: ACTIONS.KONG };
  // 有人聽牌時保守不碰（碰後需出牌可能放炮）
  if (canPong(hand, tile) && !someoneIsTing) return { action: ACTIONS.PONG };
  if (relPos === 'next' && !someoneIsTing) {
    const opts = chowOptions(hand, tile);
    if (opts.length && hand.length >= 3)
      return { action: ACTIONS.CHOW, extra: { seq: opts[0] } };
  }
  return { action: ACTIONS.PASS };
}

function _discardNormal(hand, melds, ctx = {}) {
  const { pile = [], isTingSeats = [] } = ctx;
  const pileCount = _buildPileCount(pile);
  const inDefense = isTingSeats.length > 0;

  const idx = _worstTileIdx(hand, (tile) => {
    let adj = 0;
    const seen = pileCount[tile.name] || 0;

    // ① 死牌（已出3張）：積極丟出
    if (seen >= 3) adj -= 5;
    else if (seen >= 2) adj -= 1;

    // ② 防守模式：優先丟安全牌
    if (inDefense) {
      // 字牌相對安全
      if (HONOR.includes(tile.name)) adj -= 2;
      // 已被任何人打過的牌 = 安全
      if (seen >= 1) adj -= 1;
      // 中張（3~7）在別人聽牌時較危險，降低優先丟出（adj 增加讓它不那麼容易被丟）
      const midTile = _isMidTile(tile.name);
      if (midTile && seen === 0) adj += 2;
    }
    return adj;
  });
  return { action: ACTIONS.PLAY, extra: { tileId: hand[idx].id } };
}

// ══════════════════════════════════════
//  HARD — 進階 AI
//  向聽數 + 危牌偵測 + 讀牌山
// ══════════════════════════════════════
function _claimHard(hand, melds, tile, relPos, ctx) {
  const { isTingSeats = [], pile = [], allOpponentMelds = [] } = ctx;
  const someoneIsTing = isTingSeats.length > 0;

  // 明槓：有人聽牌時保守
  if (canKong(hand, tile) && !someoneIsTing)
    return { action: ACTIONS.KONG };

  // 碰：評估是否改善手牌，且確認補出的牌是安全的
  if (canPong(hand, tile) && !someoneIsTing && _pongImproves(hand, melds, tile)) {
    // 碰後需出一張牌，先確認有安全牌可出
    const afterHand = _simulatePongHand(hand, tile);
    if (_hasSafeTile(afterHand, pile, allOpponentMelds))
      return { action: ACTIONS.PONG };
  }

  // 吃：有人聽牌不吃；選最佳序列
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
  const { pile = [], isTingSeats = [], allOpponentMelds = [] } = ctx;
  const pileCount   = _buildPileCount(pile);
  const inDefense   = isTingSeats.length > 0;
  const shantenBase = _shanten(hand, melds);

  const idx = _worstTileIdx(hand, (tile) => {
    let adj = 0;
    const seen   = pileCount[tile.name] || 0;
    const danger = _dangerScore(tile.name, pile, allOpponentMelds);

    // ① 死牌強烈建議丟
    if (seen >= 3) adj -= 8;
    else if (seen >= 2) adj -= 3;

    // ② 危牌懲罰：有人聽牌時避免丟危牌
    if (inDefense) adj += danger * 3;

    // ③ 安全牌獎勵：已被打過的牌更可以丟
    if (seen >= 1 && !inDefense) adj -= 1;

    // ④ 向聽數：丟這張後向聽數增加 = 壞牌，降低適合分（penalty）
    const afterHand = hand.filter(t => t !== tile);
    const newShanten = _shanten(afterHand, melds);
    if (newShanten > shantenBase) adj -= 2; // 丟了退步 → 更不適合

    return adj;
  });

  return { action: ACTIONS.PLAY, extra: { tileId: hand[idx].id } };
}

// ══════════════════════════════════════
//  危牌偵測系統
// ══════════════════════════════════════

/**
 * 計算某張牌的危險分數
 * 正數=危險（不應丟），負數=安全（可以丟）
 */
function _dangerScore(tileName, pile, allOpponentMelds = []) {
  // 字牌基礎危險度低（只能刻子，不組順子）
  if (HONOR.includes(tileName)) return 0;

  const cnt  = _buildPileCount(pile);
  const seen = cnt[tileName] || 0;

  // 死牌：絕對安全
  if (seen >= 3) return -5;
  // 已出2張：相對安全
  if (seen >= 2) return -2;
  // 已出1張：安全
  if (seen >= 1) return -1;

  // 從未出現的牌：計算基礎危險度
  let danger = 0;

  // 中張（3~7）可組成更多順子 → 更危險
  if (_isMidTile(tileName)) danger += 2;
  // 邊張（1,2,8,9）
  else if (_isEdgeTile(tileName)) danger += 0;
  else danger += 1; // 近邊張 (3,7 型)

  // 分析對手已碰/槓的牌組，推算其順子需求
  for (const meld of allOpponentMelds) {
    const meldNames = meld.map(t => (typeof t === 'string' ? t : t.name));
    const unique = [...new Set(meldNames)];

    // 順子（三張不同）→ 判斷延伸危牌
    if (unique.length === 3) {
      for (const seq of SEQS) {
        if (unique.every(n => seq.includes(n))) {
          // 找到吻合的順子，其端點外的延伸牌可能危險
          const seqIdx = seq.indexOf(tileName);
          if (seqIdx !== -1) danger += 1; // 同組順子的牌
        }
      }
    }
  }

  // 分析牌山：若鄰牌已大量出現，這張的搭配潛力降低（→ 反而更安全可出）
  const suit  = _getSuit(tileName);
  const num   = _getNum(tileName);
  if (suit && num) {
    const adjNames = [];
    if (num > 1) adjNames.push(suit[num - 2]);
    if (num < 9) adjNames.push(suit[num]);
    const adjGone = adjNames.filter(n => n && (cnt[n] || 0) >= 3).length;
    if (adjGone === adjNames.length && adjNames.length > 0) danger -= 2; // 鄰牌都死了 = 這張也沒用
  }

  return Math.max(-5, Math.min(5, danger));
}

/**
 * 手牌中是否有至少一張安全牌可出
 */
function _hasSafeTile(hand, pile, allOpponentMelds) {
  for (const tile of hand) {
    if (_dangerScore(tile.name, pile, allOpponentMelds) <= -1) return true;
    if (HONOR.includes(tile.name)) return true;
  }
  return false;
}

// ══════════════════════════════════════
//  向聽數（簡化版）
//  台灣16張：5組面子 + 1雀頭 = 聽牌
//  目前：-1=胡 0=聽牌 1~n=距離
// ══════════════════════════════════════
function _shanten(hand, melds) {
  if (checkWin(hand, melds)) return -1;

  const meldCount = melds.length; // 已成面子數
  const needed    = 5 - meldCount; // 手牌還需幾組面子

  // 枚舉雀頭候選，取最小向聽數
  let minShanten = 8;
  const names = hand.map(t => t.name);

  // 有雀頭的情況
  for (const name of new Set(names)) {
    if (names.filter(n => n === name).length >= 2) {
      const withoutPair = _removeCopies(hand, name, 2);
      const s = _shantenNoHead(withoutPair, needed);
      minShanten = Math.min(minShanten, s);
    }
  }

  // 沒有確定雀頭的情況（留一對最好的作頭）
  const s2 = _shantenNoHead(hand, needed) + 1;
  minShanten = Math.min(minShanten, s2);

  return Math.max(-1, minShanten);
}

/** 不考慮雀頭，計算向聽數（基於完整面子+搭子計數） */
function _shantenNoHead(hand, needed) {
  // 貪婪算法：先嘗試抽出最多完整面子，剩下算搭子
  const { complete, partial } = _countSetsAndPartials(hand);
  const completeSets = Math.min(complete, needed);
  const remaining    = needed - completeSets;
  const partialUsed  = Math.min(partial, remaining);
  return remaining - partialUsed;
}

/** 計算手牌中完整面子數和搭子（雙張）數 */
function _countSetsAndPartials(hand) {
  const names = [...hand.map(t => t.name)];
  let complete = 0, partial = 0;

  // 先抽刻子
  const uniq = [...new Set(names)];
  for (const n of uniq) {
    const cnt = names.filter(x => x === n).length;
    if (cnt >= 3) {
      complete++;
      for (let i = 0; i < 3; i++) names.splice(names.indexOf(n), 1);
    }
  }

  // 再抽順子
  for (const seq of SEQS) {
    if (seq.every(n => names.includes(n))) {
      complete++;
      for (const n of seq) names.splice(names.indexOf(n), 1);
    }
  }

  // 剩下計搭子（雙張連號/對子）
  const remaining = [...new Set(names)];
  for (const n of remaining) {
    const cnt = names.filter(x => x === n).length;
    if (cnt >= 2) { partial++; names.splice(names.indexOf(n), 1); names.splice(names.indexOf(n), 1); continue; }
    // 連號搭子
    for (const seq of SEQS) {
      const idx = seq.indexOf(n);
      if (idx !== -1) {
        for (let j = 0; j < seq.length; j++) {
          if (j !== idx && names.includes(seq[j])) {
            partial++;
            names.splice(names.indexOf(n), 1);
            names.splice(names.indexOf(seq[j]), 1);
            break;
          }
        }
        break;
      }
    }
  }

  return { complete, partial };
}

// ══════════════════════════════════════
//  共用工具
// ══════════════════════════════════════

/** 評估一張牌在手牌中的配合分數（越高越應保留） */
function _tileFitScore(hand, tile) {
  const others = hand.filter(t => t !== tile).map(t => t.name);
  let score = 0;

  // 對子 / 刻子潛力
  const sameCount = Math.min(others.filter(n => n === tile.name).length, 2);
  score += sameCount * 3;

  // 順子配合（連號越多越有價值）
  let seqConn = 0;
  for (const seq of SEQS) {
    if (!seq.includes(tile.name)) continue;
    const matchCount = seq.filter(n => others.includes(n)).length;
    seqConn = Math.max(seqConn, matchCount * 2);
  }
  score += seqConn;

  // 孤立懲罰（完全無配合）
  if (sameCount === 0 && seqConn === 0) score -= 1;

  return score;
}

/** 選最差出牌（分數最低的牌）；adjFn(tile)→number 讓難度可調整 */
function _worstTileIdx(hand, adjFn) {
  let worst = Infinity, idx = 0;
  hand.forEach((tile, i) => {
    const score = _tileFitScore(hand, tile) + adjFn(tile);
    if (score < worst) { worst = score; idx = i; }
  });
  return idx;
}

/** 建立牌山已出牌計數表 */
function _buildPileCount(pile) {
  const cnt = {};
  for (const t of pile) cnt[t.name] = (cnt[t.name] || 0) + 1;
  return cnt;
}

/** 碰牌後是否改善孤立牌數量 */
function _pongImproves(hand, melds, tile) {
  const before = _countIsolated(hand, melds);
  let removed = 0;
  const afterHand = hand.filter(t => {
    if (t.name === tile.name && removed < 2) { removed++; return false; }
    return true;
  });
  const afterMelds = [...melds, [tile, tile, tile]];
  return _countIsolated(afterHand, afterMelds) <= before;
}

/** 計算手牌孤立張數 */
function _countIsolated(hand, melds) {
  const names = hand.map(t => t.name);
  return hand.filter(tile => {
    if (names.filter(n => n === tile.name).length >= 2) return false;
    for (const seq of SEQS) {
      if (!seq.includes(tile.name)) continue;
      if (seq.filter(n => n !== tile.name).some(n => names.includes(n))) return false;
    }
    return true;
  }).length;
}

/** 選最佳吃牌序列 */
function _bestChowOption(hand, melds, tile, opts) {
  let best = null, bestShanten = Infinity;
  for (const opt of opts) {
    const toRemove = opt.filter(n => n !== tile.name);
    let removed = 0;
    const afterHand = hand.filter(t => {
      if (toRemove.includes(t.name) && removed < 2) { removed++; return false; }
      return true;
    });
    const s = _shanten(afterHand, melds);
    if (s < bestShanten) { bestShanten = s; best = opt; }
  }
  return best;
}

/** 模擬碰後的手牌 */
function _simulatePongHand(hand, tile) {
  let removed = 0;
  return hand.filter(t => {
    if (t.name === tile.name && removed < 2) { removed++; return false; }
    return true;
  });
}

/** 移除手牌中 N 張指定名稱的牌 */
function _removeCopies(hand, name, count) {
  let removed = 0;
  return hand.filter(t => {
    if (t.name === name && removed < count) { removed++; return false; }
    return true;
  });
}

/** 是否為中張（3~7）的數字牌 */
function _isMidTile(name) {
  const num = _getNum(name);
  return num !== null && num >= 3 && num <= 7;
}

/** 是否為邊張（1,2,8,9） */
function _isEdgeTile(name) {
  const num = _getNum(name);
  return num !== null && (num <= 2 || num >= 8);
}

/** 取得花色陣列 */
function _getSuit(name) {
  if (WAN.includes(name))  return WAN;
  if (TONG.includes(name)) return TONG;
  if (SUO.includes(name))  return SUO;
  return null;
}

/** 取得數字（1-9），非數字牌回傳 null */
function _getNum(name) {
  const suit = _getSuit(name);
  if (!suit) return null;
  return suit.indexOf(name) + 1;
}

module.exports = { decideClaim, decideDiscard };
