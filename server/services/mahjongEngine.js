// ════════════════════════════════════════
//  server/services/mahjongEngine.js
//  Server-side 麻將引擎，完全在後端維護狀態
//  規則邏輯 import 自 shared/mahjongRules.js
// ════════════════════════════════════════
const {
  makeDeck, shuffle, sortHand, countName, isFlower,
  checkWin, chowOptions, canPong, canKong,
  hasConcealedKong, concealedKongNames,
  calcTai, getTingTiles, isTing,
} = require('../../shared/mahjongRules');

const { SEATS, ACTIONS } = require('../../shared/constants');

// ── 初始化遊戲 ───────────────────────────
/**
 * @param {Object} room  來自 roomManager 的房間物件
 * @returns {Object}     gameState（同步寫入 room.gameState）
 */
function initGame(room) {
  const deck = shuffle(makeDeck());
  const seatList = room.players.map(p => p.seat);  // ['east','south','west','north']
  const dealerSeat = seatList[0];  // 東家為莊

  const state = {
    wall:    deck,
    pile:    [],
    last:    null,
    lastBy:  null,
    hands:   {},
    melds:   {},
    flowers: {},   // 花牌
    drawCounts: {},
    hasDiscarded: {},
    gangShang: {},
    isTing:   {},
    tingTiles: {},
    turnSeat:  dealerSeat,
    phase:     'discard',   // 'discard' | 'claim' | 'gameover'
    dealerSeat,
    seatMap:   Object.fromEntries(room.players.map(p => [p.seat, p.uid])),
  };

  for (const seat of seatList) {
    state.hands[seat]        = [];
    state.melds[seat]        = [];
    state.flowers[seat]      = [];
    state.drawCounts[seat]   = 0;
    state.hasDiscarded[seat] = false;
    state.gangShang[seat]    = false;
    state.isTing[seat]       = false;
    state.tingTiles[seat]    = [];
  }

  // 發牌：台灣16張制 — 莊家發到 16 張，閒家 13 張，補花後繼續摸
  for (let i = 0; i < 13; i++)
    for (const seat of seatList) drawTileForSeat(state, seat);
  // 莊家多一張
  drawTileForSeat(state, dealerSeat);

  // 補花（開局所有人先補完）
  for (const seat of seatList) fillFlowers(state, seat);

  room.gameState = state;
  return state;
}

// ── 摸牌（內部用） ───────────────────────
function drawTileForSeat(state, seat) {
  const tile = state.wall.pop();
  if (!tile) return null;
  if (isFlower(tile)) {
    state.flowers[seat].push(tile);
    return drawTileForSeat(state, seat);  // 花牌自動補
  }
  state.hands[seat].push(tile);
  sortHand(state.hands[seat]);
  return tile;
}

/** 開局把花牌補完 */
function fillFlowers(state, seat) {
  let changed = true;
  while (changed) {
    changed = false;
    const toMove = state.hands[seat].filter(isFlower);
    for (const t of toMove) {
      state.hands[seat].splice(state.hands[seat].indexOf(t), 1);
      state.flowers[seat].push(t);
      const extra = state.wall.pop();
      if (extra) {
        if (isFlower(extra)) {
          state.flowers[seat].push(extra);
        } else {
          state.hands[seat].push(extra);
          sortHand(state.hands[seat]);
        }
        changed = true;
      }
    }
  }
}

// ── 出牌 ─────────────────────────────────
/**
 * @returns {{ claimWindow?, nextAction?, gameEnd? }}
 */
function playTile(room, uid, tileId) {
  const state = room.gameState;
  const seat  = uidToSeat(room, uid);
  if (!seat || state.turnSeat !== seat || state.phase !== 'discard')
    throw new Error('現在不是你的出牌回合');

  const idx = state.hands[seat].findIndex(t => t.id === tileId);
  if (idx < 0) throw new Error('牌不存在手牌中');

  const tile = state.hands[seat].splice(idx, 1)[0];
  state.pile.push(tile);
  state.last   = tile;
  state.lastBy = seat;
  state.gangShang[seat] = false;
  state.hasDiscarded[seat] = true;
  state.phase = 'claim';

  return buildClaimWindow(room, state, tile, seat);
}

/** 計算出牌後所有人可做的動作 */
function buildClaimWindow(room, state, tile, bySeat) {
  const others = room.players
    .filter(p => p.seat !== bySeat)
    .map(p => p.seat);

  const winners  = others.filter(s => checkWin([...state.hands[s], tile], state.melds[s]));
  const kongSeats = others.filter(s => canKong(state.hands[s], tile));
  const pongSeats = others.filter(s => !kongSeats.includes(s) && canPong(state.hands[s], tile));
  const seatList  = room.players.map(p => p.seat);
  const nextSeat  = seatList[(seatList.indexOf(bySeat) + 1) % seatList.length];
  const chowSeat  = (chowOptions(state.hands[nextSeat], tile).length > 0) ? nextSeat : null;

  return {
    claimWindow: {
      tile, bySeat,
      winners, kongSeats, pongSeats, chowSeat,
    },
  };
}

// ── 動作處理 ─────────────────────────────
function handleAction(room, uid, action, extra) {
  const state = room.gameState;
  const seat  = uidToSeat(room, uid);

  switch (action) {
    case ACTIONS.HU:    return doHu(room, state, seat);
    case ACTIONS.PONG:  return doPong(room, state, seat);
    case ACTIONS.KONG:  return doKong(room, state, seat, extra);
    case ACTIONS.CHOW:  return doChow(room, state, seat, extra);
    case ACTIONS.PASS:  return doPass(room, state, seat);
    case ACTIONS.DRAW:  return doDraw(room, state, seat);
    default: throw new Error(`未知動作：${action}`);
  }
}

function doHu(room, state, seat) {
  const tile   = state.last;
  const method = state.turnSeat === seat ? 'tsumo' : 'claim';
  const winHand = method === 'tsumo'
    ? state.hands[seat]
    : [...state.hands[seat], tile];

  if (!checkWin(winHand, state.melds[seat])) throw new Error('無法胡牌');

  if (method === 'claim') {
    state.hands[seat].push(tile);
    state.pile.pop();
    state.last = null;
  }

  const flags = {
    tianHu:    state.turnSeat === seat && !state.hasDiscarded[seat] && method === 'tsumo',
    diHu:      !state.hasDiscarded[seat] && method === 'tsumo' && seat !== state.dealerSeat,
    gangShang: state.gangShang[seat],
    drawCount: state.drawCounts[seat],
    wallEmpty: state.wall.length === 0,
    method,
    isTing:    state.isTing[seat],
    flowers:   state.flowers[seat],
  };

  const taiResult = calcTai(state.hands[seat], state.melds[seat], flags);
  state.phase = 'gameover';

  return {
    gameEnd: true,
    winner:  seat,
    winnerUid: room.players.find(p => p.seat === seat)?.uid,
    method,
    gunSeat: method === 'claim' ? state.lastBy : null,
    taiResult,
    hands: state.hands,
    flowers: state.flowers,
  };
}

function doPong(room, state, seat) {
  const tile = state.last;
  if (!tile || !canPong(state.hands[seat], tile)) throw new Error('無法碰牌');
  const removed = [];
  for (let i = state.hands[seat].length - 1; i >= 0 && removed.length < 2; i--) {
    if (state.hands[seat][i].name === tile.name)
      removed.unshift(...state.hands[seat].splice(i, 1));
  }
  state.melds[seat].push([tile, ...removed]);
  state.pile.pop(); state.last = null; state.lastBy = null;
  state.gangShang[seat] = false;
  state.phase     = 'discard';
  state.turnSeat  = seat;
  return { nextAction: { type: 'discard', seat } };
}

function doKong(room, state, seat, extra) {
  // 明槓
  const tile = state.last;
  if (tile && canKong(state.hands[seat], tile)) {
    const removed = [];
    for (let i = state.hands[seat].length - 1; i >= 0 && removed.length < 3; i--) {
      if (state.hands[seat][i].name === tile.name)
        removed.unshift(...state.hands[seat].splice(i, 1));
    }
    state.melds[seat].push([tile, ...removed]);
    state.pile.pop(); state.last = null; state.lastBy = null;
    state.gangShang[seat] = true;
    const drawn = drawTileForSeat(state, seat);
    state.drawCounts[seat]++;
    if (drawn && checkWin(state.hands[seat], state.melds[seat])) {
      return doHu(room, state, seat);
    }
    state.phase = 'discard'; state.turnSeat = seat;
    return { nextAction: { type: 'discard', seat, drawn } };
  }
  // 暗槓
  const names = concealedKongNames(state.hands[seat]);
  const nm    = extra?.name || names[0];
  if (!nm) throw new Error('無法槓牌');
  const removed = [];
  for (let i = state.hands[seat].length - 1; i >= 0 && removed.length < 4; i--) {
    if (state.hands[seat][i].name === nm)
      removed.unshift(...state.hands[seat].splice(i, 1));
  }
  state.melds[seat].push(removed);
  state.gangShang[seat] = true;
  const drawn = drawTileForSeat(state, seat);
  state.drawCounts[seat]++;
  if (drawn && checkWin(state.hands[seat], state.melds[seat])) {
    return doHu(room, state, seat);
  }
  state.phase = 'discard'; state.turnSeat = seat;
  return { nextAction: { type: 'discard', seat, drawn } };
}

function doChow(room, state, seat, extra) {
  const tile = state.last;
  if (!tile) throw new Error('無牌可吃');
  const opts = chowOptions(state.hands[seat], tile);
  if (!opts.length) throw new Error('無法吃牌');
  const seq = extra?.seq || opts[0];
  const meldTiles = [tile];
  for (const nm of seq.filter(n => n !== tile.name)) {
    const idx = state.hands[seat].findIndex(t => t.name === nm);
    if (idx >= 0) meldTiles.push(...state.hands[seat].splice(idx, 1));
  }
  meldTiles.sort((a, b) => seq.indexOf(a.name) - seq.indexOf(b.name));
  state.melds[seat].push(meldTiles);
  state.pile.pop(); state.last = null; state.lastBy = null;
  state.gangShang[seat] = false;
  state.phase = 'discard'; state.turnSeat = seat;
  return { nextAction: { type: 'discard', seat } };
}

function doPass(room, state, seat) {
  // 過：直接進到下一個摸牌
  const seatList = room.players.map(p => p.seat);
  const nextSeat = seatList[(seatList.indexOf(state.lastBy) + 1) % seatList.length];
  state.last = null; state.lastBy = null;
  state.phase = 'discard'; state.turnSeat = nextSeat;
  return { nextAction: { type: 'draw', seat: nextSeat } };
}

function doDraw(room, state, seat) {
  if (state.wall.length === 0)
    return { gameEnd: true, winner: null, method: null, taiResult: { total: 0, details: [{ name: '流局', tai: 0 }] } };
  const tile = drawTileForSeat(state, seat);
  if (!tile) return doDraw(room, state, seat);
  state.drawCounts[seat]++;
  state.gangShang[seat] = false;
  state.last = null; state.lastBy = null;
  state.phase = 'discard'; state.turnSeat = seat;
  return { nextAction: { type: 'discard', seat, drawn: tile } };
}

// ── 宣告聽牌 ─────────────────────────────
function declareTing(room, uid) {
  const state = room.gameState;
  const seat  = uidToSeat(room, uid);
  if (!seat) return;
  const waiting = getTingTiles(state.hands[seat], state.melds[seat]);
  if (waiting.length === 0) return;
  state.isTing[seat]    = true;
  state.tingTiles[seat] = waiting;
}

// ── AI 決策 ──────────────────────────────
function aiDecide(room, seat) {
  const state = room.gameState;
  if (state.phase === 'claim' && state.last) {
    const tile = state.last;
    if (checkWin([...state.hands[seat], tile], state.melds[seat]))
      return { type: ACTIONS.HU };
    if (canKong(state.hands[seat], tile))
      return { type: ACTIONS.KONG };
    if (canPong(state.hands[seat], tile))
      return { type: ACTIONS.PONG };
    return { type: ACTIONS.PASS };
  }
  if (state.phase === 'discard' && state.turnSeat === seat) {
    if (checkWin(state.hands[seat], state.melds[seat]))
      return { type: ACTIONS.HU };
    if (hasConcealedKong(state.hands[seat]))
      return { type: ACTIONS.KONG };
    const idx = chooseTileToDiscard(state.hands[seat], state.melds[seat]);
    return { type: ACTIONS.PLAY, extra: { tileId: state.hands[seat][idx].id } };
  }
  return { type: ACTIONS.PASS };
}

// ── 出牌啟發式 ───────────────────────────
function tileScore(hand, tile) {
  const oNames = hand.filter(t => t !== tile).map(t => t.name);
  const { SEQS } = require('../../shared/constants');
  let score = 0;
  for (const seq of SEQS) {
    if (!seq.includes(tile.name)) continue;
    score += seq.filter(n => oNames.includes(n)).length * 2;
  }
  score += Math.min(oNames.filter(n => n === tile.name).length, 2) * 3;
  return score;
}
function chooseTileToDiscard(hand) {
  let worst = Infinity, idx = 0;
  hand.forEach((t, i) => {
    const s = tileScore(hand, t);
    if (s < worst) { worst = s; idx = i; }
  });
  return idx;
}

// ── 所有人過牌後推進到下一家摸牌 ──────────
function proceedToNextDraw(room, fromSeat) {
  const state   = room.gameState;
  const seatList = room.players.map(p => p.seat);
  const nextSeat = seatList[(seatList.indexOf(fromSeat) + 1) % seatList.length];
  state.last    = null;
  state.lastBy  = null;
  state.phase   = 'discard';
  state.turnSeat = nextSeat;
  return { nextSeat };
}

// ── 工具 ─────────────────────────────────
function uidToSeat(room, uid) {
  return room.players.find(p => p.uid === uid)?.seat || null;
}

module.exports = {
  initGame, playTile, handleAction,
  declareTing, aiDecide, proceedToNextDraw,
};
