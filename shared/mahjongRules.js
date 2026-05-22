// ════════════════════════════════════════
//  shared/mahjongRules.js
//  純麻將規則邏輯（無 DOM、無 Socket）
//  從台灣麻將.html 抽出並擴展花牌 / 宣告聽牌
// ════════════════════════════════════════

const {
  WAN, TONG, SUO, HONOR, FLOWER,
  NUMBERED, ALL_NAMES, SEQS, SORT_ORDER,
} = typeof require !== 'undefined'
  ? require('./constants')
  : window._MJConst;   // 瀏覽器端由 constants.js 掛在 window

// ── 牌組 ─────────────────────────────────

/** 建立 144 張完整牌組（含 8 花牌） */
function makeDeck() {
  let id = 0;
  const deck = [];
  for (const nm of ALL_NAMES)
    for (let i = 0; i < 4; i++) deck.push({ id: id++, name: nm });
  for (const nm of FLOWER)
    deck.push({ id: id++, name: nm }); // 花牌各1張×8
  return deck;
}

/** Fisher-Yates 洗牌 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 依牌序排序 */
function sortHand(hand) {
  hand.sort((a, b) => {
    const d = SORT_ORDER.indexOf(a.name) - SORT_ORDER.indexOf(b.name);
    return d !== 0 ? d : a.id - b.id;
  });
}

/** 計算某張牌在手牌中的數量 */
function countName(hand, nm) {
  return hand.filter(t => t.name === nm).length;
}

/** 判斷是否為花牌 */
function isFlower(tile) { return FLOWER.includes(tile.name); }

// ── 勝牌判定 ──────────────────────────────

/**
 * 遞迴嘗試用面子（刻子+順子）消耗 `names`
 * @param {string[]} names  剩餘牌名陣列
 * @param {number}   need   還需幾個面子
 */
function canSets(names, need) {
  if (need === 0) return names.length === 0;
  if (names.length < 3) return false;
  const cnt = {};
  for (const n of names) cnt[n] = (cnt[n] || 0) + 1;
  // 刻子
  for (const n of Object.keys(cnt)) {
    if (cnt[n] >= 3) {
      const rest = [...names];
      for (let i = 0; i < 3; i++) rest.splice(rest.indexOf(n), 1);
      if (canSets(rest, need - 1)) return true;
    }
  }
  // 順子
  for (const seq of SEQS) {
    if (seq.every(n => names.includes(n))) {
      const rest = [...names];
      for (const n of seq) rest.splice(rest.indexOf(n), 1);
      if (canSets(rest, need - 1)) return true;
    }
  }
  return false;
}

/** 只允許刻子（碰碰胡輔助） */
function canOnlyTriplets(names, need) {
  if (need === 0) return names.length === 0;
  if (names.length < 3) return false;
  const cnt = {};
  for (const n of names) cnt[n] = (cnt[n] || 0) + 1;
  for (const n of Object.keys(cnt)) {
    if (cnt[n] >= 3) {
      const rest = [...names];
      for (let i = 0; i < 3; i++) rest.splice(rest.indexOf(n), 1);
      if (canOnlyTriplets(rest, need - 1)) return true;
    }
  }
  return false;
}

/** 對子胡判定（7對子=14張 / 8對子=16張，台灣16張制） */
function checkQiDui(hand, melds) {
  if (melds.length !== 0) return false;
  if (hand.length !== 14 && hand.length !== 16) return false;
  const cnt = {};
  for (const t of hand) cnt[t.name] = (cnt[t.name] || 0) + 1;
  const keys = Object.keys(cnt);
  const targetPairs = hand.length === 16 ? 8 : 7;
  return keys.length === targetPairs && keys.every(k => cnt[k] === 2);
}

/**
 * 胡牌判定（支援 14 張標準制 與 16 張台灣制）
 * - 14 張：4 面子 + 1 對子
 * - 16 張：4 面子 + 2 對子
 * @param {Object[]} hand  手牌（含最後一張）
 * @param {Object[][]} melds 副露組
 * @returns {boolean}
 */
function checkWin(hand, melds) {
  if (checkQiDui(hand, melds)) return true;
  const need = 4 - melds.length;
  const names = hand.map(t => t.name);
  const cnt = {};
  for (const n of names) cnt[n] = (cnt[n] || 0) + 1;
  const pairs = Object.keys(cnt).filter(n => cnt[n] >= 2);

  // 1 對子（標準 14 張制：4 面子 + 1 對子 = 14）
  for (const pn of pairs) {
    const rest = [...names];
    rest.splice(rest.indexOf(pn), 1);
    rest.splice(rest.indexOf(pn), 1);
    if (canSets(rest, need)) return true;
  }

  // 2 對子（台灣 16 張制：4 面子 + 2 對子 = 16）
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i; j < pairs.length; j++) {
      const p1 = pairs[i], p2 = pairs[j];
      if (p1 === p2 && cnt[p1] < 4) continue;  // 同牌兩對需有 4 張
      const rest = [...names];
      rest.splice(rest.indexOf(p1), 1); rest.splice(rest.indexOf(p1), 1);
      rest.splice(rest.indexOf(p2), 1); rest.splice(rest.indexOf(p2), 1);
      if (canSets(rest, need)) return true;
    }
  }

  return false;
}

/** 碰碰胡判定（支援 14/16 張） */
function isPengPengHu(hand, melds) {
  for (const m of melds) {
    if (m.length === 4) continue;
    if (m.length === 3 && m[0].name === m[1].name && m[1].name === m[2].name) continue;
    return false;
  }
  const need = 4 - melds.length;
  const names = hand.map(t => t.name);
  const cnt = {};
  for (const n of names) cnt[n] = (cnt[n] || 0) + 1;
  const pairs = Object.keys(cnt).filter(n => cnt[n] >= 2);

  // 1 對子
  for (const pn of pairs) {
    const rest = [...names];
    rest.splice(rest.indexOf(pn), 1);
    rest.splice(rest.indexOf(pn), 1);
    if (canOnlyTriplets(rest, need)) return true;
  }
  // 2 對子（16 張）
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i; j < pairs.length; j++) {
      const p1 = pairs[i], p2 = pairs[j];
      if (p1 === p2 && cnt[p1] < 4) continue;
      const rest = [...names];
      rest.splice(rest.indexOf(p1), 1); rest.splice(rest.indexOf(p1), 1);
      rest.splice(rest.indexOf(p2), 1); rest.splice(rest.indexOf(p2), 1);
      if (canOnlyTriplets(rest, need)) return true;
    }
  }
  return false;
}

// ── 聽牌判定 ──────────────────────────────

/**
 * 計算聽什麼牌（用於宣告聽牌與 UI 高亮）
 * hand 應為「已出牌後」的手牌（15 張 / 16 張模式，或 13 張 / 14 張模式）
 * @returns {string[]} 可胡的牌名列表
 */
function getTingTiles(hand, melds) {
  const waiting = [];
  for (const nm of ALL_NAMES) {
    const testHand = [...hand, { id: -1, name: nm }];
    if (checkWin(testHand, melds)) waiting.push(nm);
  }
  return waiting;
}

/**
 * 是否可聽牌
 * - 16 張制：手牌為「滿手」(16-3*melds.length) 時，嘗試每張出牌後是否達聽牌狀態
 * - 標準制：手牌差一張可胡
 */
function isTing(hand, melds) {
  const fullSize16 = 16 - 3 * melds.length;
  if (hand.length === fullSize16) {
    // 出牌後剩 fullSize16-1 張，再摸 1 張 = fullSize16 → checkWin
    for (let i = 0; i < hand.length; i++) {
      const reduced = hand.filter((_, k) => k !== i);
      if (getTingTiles(reduced, melds).length > 0) return true;
    }
    return false;
  }
  return getTingTiles(hand, melds).length > 0;
}

// ── 吃碰槓合法性 ──────────────────────────

/** 回傳所有可吃的順子選項 */
function chowOptions(hand, tile) {
  if (!NUMBERED.includes(tile.name)) return [];
  const opts = [];
  const hNames = hand.map(t => t.name);
  for (const seq of SEQS) {
    if (!seq.includes(tile.name)) continue;
    const others = seq.filter(n => n !== tile.name);
    if (others.every(n => hNames.includes(n))) {
      if (!opts.some(o => o.join('') === seq.join(''))) opts.push(seq);
    }
  }
  return opts;
}

/** 是否可碰 */
function canPong(hand, tile) {
  return countName(hand, tile.name) >= 2;
}

/** 是否可明槓 */
function canKong(hand, tile) {
  return countName(hand, tile.name) >= 3;
}

/** 是否有暗槓 */
function hasConcealedKong(hand) {
  const cnt = {};
  for (const t of hand) cnt[t.name] = (cnt[t.name] || 0) + 1;
  return Object.values(cnt).some(v => v >= 4);
}

/** 找出所有可暗槓的牌名 */
function concealedKongNames(hand) {
  const cnt = {};
  for (const t of hand) cnt[t.name] = (cnt[t.name] || 0) + 1;
  return Object.keys(cnt).filter(n => cnt[n] >= 4);
}

/**
 * 找出可加槓的牌名（已碰成刻子副露，手中再摸到第4張）
 * @param {Object[]} hand
 * @param {Object[][]} melds
 * @returns {string[]}
 */
function addKongNames(hand, melds) {
  // 只考慮長度3且三張同名的刻子（碰的那種）
  const pongMeldNames = melds
    .filter(m => m.length === 3 && m[0].name === m[1].name && m[1].name === m[2].name)
    .map(m => m[0].name);
  return pongMeldNames.filter(nm => hand.some(t => t.name === nm));
}

// ── 台數計算 ──────────────────────────────

/**
 * 計算台數
 * @param {Object[]} hand      手牌（含最後一張，不含副露）
 * @param {Object[][]} melds   副露組
 * @param {Object} flags       { tianHu, diHu, gangShang, drawCount,
 *                               wallEmpty, method, isTing, flowers }
 * @returns {{ total:number, details:Array<{name,tai}> }}
 */
function calcTai(hand, melds, flags = {}) {
  const {
    tianHu, diHu, gangShang,
    drawCount = 0, wallEmpty = false,
    method, isTing = false,
    flowers = [],
  } = flags;

  const details = [];
  let total = 0;
  const add = (name, tai) => { details.push({ name, tai }); total += tai; };

  // ── 特殊胡法（直接返回）────
  if (tianHu) { add('天胡', 8); return { total, details }; }
  if (diHu)   { add('地胡', 8); return { total, details }; }

  add('基本', 1);

  const allTiles = [...hand];
  for (const m of melds) allTiles.push(...m);
  const allNames = allTiles.map(t => t.name);

  const isQiDui = checkQiDui(hand, melds);
  if (isQiDui) add(hand.length === 16 ? '八對子' : '七對子', 4);

  // ── 色彩類 ─────────────────
  const suits = new Set(allTiles.map(t =>
    WAN.includes(t.name) ? 'W' : TONG.includes(t.name) ? 'T' :
    SUO.includes(t.name)  ? 'S' : 'H'));
  const numSuits = ['W','T','S'].filter(s => suits.has(s));
  const hasHonor = suits.has('H');
  if (numSuits.length === 1 && !hasHonor) add('清一色', 4);
  else if (numSuits.length === 0 && hasHonor) add('字一色', 8);
  else if (numSuits.length === 1 && hasHonor) add('混一色', 2);

  // ── 牌型類 ─────────────────
  if (!isQiDui && isPengPengHu(hand, melds)) add('碰碰胡', 4);

  const dragons = ['中','發','白'];
  const dTrips = dragons.filter(n => allNames.filter(x => x === n).length >= 3).length;
  const dPair  = dragons.some(n => allNames.filter(x => x === n).length === 2);
  if (dTrips === 3) add('大三元', 8);
  else if (dTrips === 2 && dPair) add('小三元', 4);

  const winds = ['東','南','西','北'];
  const wTrips = winds.filter(n => allNames.filter(x => x === n).length >= 3).length;
  const wPair  = winds.some(n => allNames.filter(x => x === n).length === 2);
  if (wTrips === 4) add('大四喜', 16);
  else if (wTrips === 3 && wPair) add('小四喜', 8);

  // ── 花牌台數 ────────────────
  if (flowers.length >= 4) add('花槓', 1);
  if (flowers.length >= 7) add('七星報喜', 4);
  if (flowers.length === 8) add('八仙過海', 8);

  // ── 自摸 / 門清 ─────────────
  if (method === 'tsumo') {
    if (melds.length === 0 && !isQiDui) add('門清自摸', 2);
    else add('自摸', 1);
  } else {
    if (melds.length === 0) add('門清截胡', 1);
    if (drawCount === 0)    add('全求', 2);
  }

  // ── 宣告聽牌 ────────────────
  if (isTing) add('宣告聽牌', 1);

  // ── 特殊摸牌 ────────────────
  if (gangShang) add('槓上開花', 2);
  if (wallEmpty) {
    if (method === 'tsumo') add('海底撈月', 3);
    else add('河底撈魚', 1);
  }

  return { total, details };
}

// ── Node.js / ESM 雙模式匯出 ─────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    makeDeck, shuffle, sortHand, countName, isFlower,
    canSets, canOnlyTriplets, checkQiDui, checkWin,
    isPengPengHu, getTingTiles, isTing,
    chowOptions, canPong, canKong,
    hasConcealedKong, concealedKongNames, addKongNames,
    calcTai,
  };
}
