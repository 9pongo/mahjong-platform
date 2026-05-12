// ════════════════════════════════════════
//  server/socket/gameSocket.js
//  麻將多人對戰核心 — 含搶牌視窗 / AI 接管
// ════════════════════════════════════════
const roomManager   = require('./roomManager');
const engine        = require('../services/mahjongEngine');
const aiPlayer      = require('../services/aiPlayer');
const gameRecord    = require('../services/gameRecordService');
const { EVENTS, ACTIONS, SEATS } = require('../../shared/constants');
const {
  checkWin, concealedKongNames, chowOptions,
} = require('../../shared/mahjongRules');
const logger = require('../utils/logger');

// uid → socketId（斷線重連）
const userSocket = new Map();

// roomId → ClaimState
// ClaimState = {
//   tile, bySeat, chowSeat,
//   eligible: { [seat]: string[] },
//   responses: { [seat]: { action, extra } },
//   timer: handle,
//   timeout: number,
//   resolved: bool,
// }
const pendingClaims = new Map();

// ══════════════════════════════════════
//  REGISTER
// ══════════════════════════════════════
function registerGameSocket(io, socket) {
  // 從 handshake 取 uid（Phase 2 已有 JWT 驗證，Phase 3 沿用）
  const uid      = socket.handshake.auth?.uid      || socket.id;
  const username = socket.handshake.auth?.username || `玩家${socket.id.slice(0, 4)}`;
  userSocket.set(uid, socket.id);

  // ── join_room ──────────────────────────
  socket.on(EVENTS.JOIN_ROOM, ({ roomId, betKey, roomType, coins }) => {
    try {
      let room = roomId
        ? roomManager.getRoom(roomId)
        : roomManager.matchmake(uid, roomType, betKey);

      if (!room) room = roomManager.createRoom(roomType, betKey, uid);

      room = roomManager.joinRoom(room.roomId, {
        uid, username, socketId: socket.id,
        coins: coins || 10000,
      });

      socket.join(room.roomId);
      logger.info(`${username}(${uid}) joined room ${room.roomId}`);

      io.to(room.roomId).emit(EVENTS.ROOM_STATE, sanitizeRoom(room));

      // 4 人滿桌自動開始
      if (room.players.length === 4) startGame(io, room);
    } catch (e) {
      socket.emit(EVENTS.ERROR, { message: e.message });
    }
  });

  // ── ready（填 AI 後立刻開始）─────────────
  socket.on(EVENTS.READY, ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.status !== 'waiting') return;

    const player = room.players.find(p => p.uid === uid);
    if (player) player.ready = true;

    const allReady = room.players.every(p => p.ready);
    if (allReady && room.players.length >= 1) {
      roomManager.fillWithAI(roomId);
      startGame(io, room);
    }
  });

  // ── play_tile ─────────────────────────
  socket.on(EVENTS.PLAY_TILE, ({ roomId, tileId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.status !== 'playing') return;
    if (pendingClaims.has(roomId)) return; // 搶牌視窗中不能出牌

    const player = room.players.find(p => p.uid === uid);
    if (!player) return;
    clearPlayerTimer(player);

    try {
      const result = engine.playTile(room, uid, tileId);
      broadcastGameState(io, room);
      openClaimWindow(io, room, result.claimWindow);
    } catch (e) {
      socket.emit(EVENTS.ERROR, { message: e.message });
    }
  });

  // ── declare_action（在搶牌視窗或自己回合宣告）
  socket.on(EVENTS.DECLARE_ACTION, ({ roomId, action, extra }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.uid === uid);
    if (!player) return;
    clearPlayerTimer(player);

    // 搶牌視窗模式
    const claims = pendingClaims.get(roomId);
    if (claims && !claims.resolved) {
      const seat = player.seat;
      if (!claims.eligible[seat]) {
        socket.emit(EVENTS.ERROR, { message: '你目前無法動作' });
        return;
      }
      claims.responses[seat] = { action, extra };

      // 所有有資格的玩家都回應了 → 立刻結算
      const allDone = Object.keys(claims.eligible).every(s => claims.responses[s]);
      if (allDone) resolveClaims(io, room, claims);
      return;
    }

    // 自己的出牌回合（自摸 / 暗槓 / 聽牌）
    try {
      const result = engine.handleAction(room, uid, action, extra);
      broadcastGameState(io, room);
      if (result.gameEnd) {
        endGame(io, room, result);
      } else if (result.nextAction) {
        startActionPhase(io, room, result.nextAction, result.nextAction.drawn);
      }
    } catch (e) {
      socket.emit(EVENTS.ERROR, { message: e.message });
    }
  });

  // ── declare_ting ───────────────────────
  socket.on(EVENTS.DECLARE_TING, ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    engine.declareTing(room, uid);
    broadcastGameState(io, room);
  });

  // ── request_ai（玩家要求 AI 代打）───────
  socket.on(EVENTS.REQUEST_AI, ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.status !== 'playing') return;
    const player = room.players.find(p => p.uid === uid);
    if (!player) return;
    player.isAI = true;   // 標記為 AI 代打
    clearPlayerTimer(player);
    logger.info(`${username} 啟動 AI 代打`);

    // 如果現在剛好是他的回合，讓 AI 接管
    const state = room.gameState;
    if (state && state.turnSeat === player.seat) {
      const aiResp = aiPlayer.decideDiscard(
        state.hands[player.seat], state.melds[player.seat],
        room.aiLevel, buildAIContext(room));
      executeAIAction(io, room, player.seat, aiResp);
    }
  });

  // ── 斷線重連 ───────────────────────────
  socket.on('reconnect_room', ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    const player = room.players.find(p => p.uid === uid);
    if (!player) return;

    player.socketId = socket.id;
    userSocket.set(uid, socket.id);
    socket.join(roomId);

    const state = room.gameState;
    socket.emit(EVENTS.ROOM_STATE, {
      ...sanitizeRoom(room),
      myHand:    state?.hands[player.seat]    || [],
      myFlowers: state?.flowers[player.seat]  || [],
    });
    logger.info(`${username} reconnected to ${roomId}`);
  });

  // ── disconnect ──────────────────────────
  socket.on('disconnect', () => {
    userSocket.delete(uid);
    // 找到所在房間，讓 AI 代打
    for (const room of getAllRooms()) {
      const player = room.players.find(p => p.uid === uid);
      if (!player || room.status !== 'playing') continue;
      player.socketId = null;
      logger.info(`${username} disconnected from ${room.roomId}, AI 接管`);
      // 若此時剛好是他的回合，觸發 AI
      const state = room.gameState;
      if (state && state.turnSeat === player.seat && !pendingClaims.has(room.roomId)) {
        const aiResp = aiPlayer.decideDiscard(
          state.hands[player.seat], state.melds[player.seat],
          room.aiLevel, buildAIContext(room));
        setTimeout(() => executeAIAction(io, room, player.seat, aiResp), 1500);
      }
    }
  });
}

// ══════════════════════════════════════
//  開始遊戲
// ══════════════════════════════════════
function startGame(io, room) {
  if (room.status === 'playing') return;
  room.status = 'playing';

  const state = engine.initGame(room);
  logger.info(`Game started in ${room.roomId}, dealer=${state.dealerSeat}`);

  // 各自只看自己手牌
  for (const player of room.players) {
    if (player.isAI || !player.socketId) continue;
    const s = io.sockets.sockets.get(player.socketId);
    if (!s) continue;
    s.emit(EVENTS.GAME_START, {
      hand:     state.hands[player.seat],
      flowers:  state.flowers[player.seat],
      mySeat:   player.seat,
      seats:    state.seatMap,
      dealer:   state.dealerSeat,
      wallLeft: state.wall.length,
    });
  }

  broadcastGameState(io, room);
  // 莊家先出牌
  startActionPhase(io, room, { type: 'discard', seat: state.dealerSeat });
}

// ══════════════════════════════════════
//  搶牌視窗
// ══════════════════════════════════════
function openClaimWindow(io, room, claimData) {
  const { tile, bySeat, winners, kongSeats, pongSeats, chowSeat } = claimData;

  // 廣播出牌（動畫用）
  io.to(room.roomId).emit(EVENTS.TILE_PLAYED, { tile, bySeat });

  // 建立 eligible
  const eligible = {};
  for (const s of winners)  eligible[s] = (eligible[s] || []).concat('hu');
  for (const s of kongSeats) eligible[s] = (eligible[s] || []).concat('kong');
  for (const s of pongSeats) eligible[s] = (eligible[s] || []).concat('pong');
  if (chowSeat) eligible[chowSeat] = (eligible[chowSeat] || []).concat('chow');

  const eligibleSeats = Object.keys(eligible);
  if (eligibleSeats.length === 0) {
    // 無人可動 → 小延遲後推進
    setTimeout(() => {
      if (room.status === 'playing') proceedToNextDraw(io, room, bySeat);
    }, 350);
    return;
  }

  const timeout = room.roomType === 'short' ? 5000 : 8000;
  const claims = {
    tile, bySeat, chowSeat,
    eligible, responses: {},
    timeout, resolved: false,
    timer: null,
  };
  pendingClaims.set(room.roomId, claims);

  // 通知各有資格玩家
  for (const seat of eligibleSeats) {
    const player = room.players.find(p => p.seat === seat);
    if (!player) continue;

    if (player.isAI || !player.socketId) {
      // AI 立即決定
      const relPos = seat === getNextSeat(room, bySeat) ? 'next' : 'other';
      const aiResp = aiPlayer.decideClaim(
        room.gameState.hands[seat], room.gameState.melds[seat], tile, relPos,
        room.aiLevel, buildAIContext(room));
      claims.responses[seat] = aiResp;
    } else {
      const s = io.sockets.sockets.get(player.socketId);
      if (s) {
        // 吃牌時附帶可選序列，供客戶端顯示選單
        const chowOpts = eligible[seat].includes('chow')
          ? chowOptions(room.gameState.hands[seat], tile)
          : [];
        s.emit(EVENTS.ACTION_REQUIRED, {
          type: 'claim',
          tile,
          availableActions: eligible[seat],
          chowOpts,
          timeout,
        });
      }
    }
  }

  // 若所有玩家都已回應（全 AI）→ 直接結算
  if (eligibleSeats.every(s => claims.responses[s])) {
    resolveClaims(io, room, claims);
    return;
  }

  // 超時後強制結算（未回應 = 過）
  claims.timer = setTimeout(() => {
    for (const s of eligibleSeats) {
      if (!claims.responses[s]) claims.responses[s] = { action: ACTIONS.PASS };
    }
    resolveClaims(io, room, claims);
  }, timeout + 600);
}

// ── 結算搶牌視窗 ──────────────────────────
function resolveClaims(io, room, claims) {
  if (claims.resolved) return;
  claims.resolved = true;
  clearTimeout(claims.timer);
  pendingClaims.delete(room.roomId);
  if (room.status !== 'playing') return;

  const { tile, bySeat, eligible, responses, chowSeat } = claims;
  const seatList  = room.players.map(p => p.seat);
  const clockwise = getClockwiseSeats(seatList, bySeat);

  // 優先 1：胡（順時針先搶）
  for (const seat of clockwise) {
    const resp = responses[seat];
    if (resp?.action === ACTIONS.HU && eligible[seat]?.includes('hu')) {
      _executeAction(io, room, seat, ACTIONS.HU, null, 'hu');
      return;
    }
  }

  // 優先 2：明槓
  for (const seat of clockwise) {
    const resp = responses[seat];
    if (resp?.action === ACTIONS.KONG && eligible[seat]?.includes('kong')) {
      _executeAction(io, room, seat, ACTIONS.KONG, null, 'kong');
      return;
    }
  }

  // 優先 3：碰
  for (const seat of clockwise) {
    const resp = responses[seat];
    if (resp?.action === ACTIONS.PONG && eligible[seat]?.includes('pong')) {
      _executeAction(io, room, seat, ACTIONS.PONG, null, 'pong');
      return;
    }
  }

  // 優先 4：吃（只有下家可吃）
  if (chowSeat) {
    const resp = responses[chowSeat];
    if (resp?.action === ACTIONS.CHOW && eligible[chowSeat]?.includes('chow')) {
      _executeAction(io, room, chowSeat, ACTIONS.CHOW, resp.extra, 'chow');
      return;
    }
  }

  // 全過 → 下一家摸牌
  proceedToNextDraw(io, room, bySeat);
}

// ── 執行一個動作（含廣播）───────────────
function _executeAction(io, room, seat, action, extra, label) {
  const player = room.players.find(p => p.seat === seat);
  if (!player) return;
  try {
    const result = engine.handleAction(room, player.uid, action, extra);
    if (label !== 'hu') {
      io.to(room.roomId).emit(EVENTS.ACTION_RESULT, { action: label, bySeat: seat });
    }
    broadcastGameState(io, room);

    if (result.gameEnd) {
      endGame(io, room, result);
    } else if (result.nextAction) {
      startActionPhase(io, room, result.nextAction, result.nextAction.drawn);
    }
  } catch (e) {
    logger.error(`[${label}] error seat=${seat}:`, e.message);
  }
}

// ══════════════════════════════════════
//  動作推進（摸牌 / 出牌提示）
// ══════════════════════════════════════
function startActionPhase(io, room, nextAction, drawnTile) {
  if (!nextAction || room.status !== 'playing') return;
  const { type, seat } = nextAction;
  const player = room.players.find(p => p.seat === seat);
  if (!player || !room.gameState) return;

  if (type === 'draw') {
    // 執行摸牌
    const result = engine.handleAction(room, player.uid, ACTIONS.DRAW);
    if (result.gameEnd) { endGame(io, room, result); return; }

    const drawn = result.nextAction?.drawn;
    broadcastGameState(io, room);

    // 摸牌結果只告訴本人
    if (!player.isAI && player.socketId) {
      const s = io.sockets.sockets.get(player.socketId);
      if (s) s.emit(EVENTS.TILE_DRAWN, { tile: drawn });
    }
    // 繼續到出牌階段
    startActionPhase(io, room, result.nextAction, drawn);
    return;
  }

  if (type === 'discard') {
    const state  = room.gameState;
    const hand   = state.hands[seat];
    const melds  = state.melds[seat];

    if (player.isAI || !player.socketId) {
      const delay = 500 + Math.random() * 700;
      setTimeout(() => {
        if (room.status !== 'playing') return;
        const aiResp = aiPlayer.decideDiscard(
          room.gameState.hands[seat], room.gameState.melds[seat],
          room.aiLevel, buildAIContext(room));
        executeAIAction(io, room, seat, aiResp);
      }, delay);
      return;
    }

    // 人類玩家：發送提示 + 設超時
    const timeout = room.roomType === 'short' ? 12000 : 20000;
    clearPlayerTimer(player);
    const s = io.sockets.sockets.get(player.socketId);
    if (s) {
      s.emit(EVENTS.ACTION_REQUIRED, {
        type: 'discard',
        hand,
        drawn:          drawnTile,
        canHu:          checkWin(hand, melds),
        concealedKongs: concealedKongNames(hand),
        timeout,
      });
    }

    player._actionTimer = setTimeout(() => {
      if (room.status !== 'playing') return;
      logger.info(`玩家 ${seat} 超時，AI 代打`);
      const aiResp = aiPlayer.decideDiscard(
        room.gameState.hands[seat], room.gameState.melds[seat],
        room.aiLevel, buildAIContext(room));
      executeAIAction(io, room, seat, aiResp);
    }, timeout + 800);
  }
}

// ── 推進到下一家摸牌 ─────────────────────
function proceedToNextDraw(io, room, fromSeat) {
  const { nextSeat } = engine.proceedToNextDraw(room, fromSeat);
  startActionPhase(io, room, { type: 'draw', seat: nextSeat });
}

// ══════════════════════════════════════
//  AI 難度 Context 建立
// ══════════════════════════════════════
function buildAIContext(room) {
  const gs = room.gameState;
  if (!gs) return {};
  return {
    pile:        gs.pile || [],
    isTingSeats: Object.entries(gs.isTing || {})
      .filter(([, v]) => v).map(([s]) => s),
  };
}

// ══════════════════════════════════════
//  AI 執行動作
// ══════════════════════════════════════
function executeAIAction(io, room, seat, aiResp) {
  if (room.status !== 'playing' || !room.gameState) return;
  const player = room.players.find(p => p.seat === seat);
  if (!player) return;

  try {
    if (aiResp.action === ACTIONS.PLAY) {
      // 出牌
      const tileId = aiResp.extra?.tileId;
      if (!tileId) return;
      const result = engine.playTile(room, player.uid, tileId);
      broadcastGameState(io, room);
      openClaimWindow(io, room, result.claimWindow);
    } else if (aiResp.action === ACTIONS.HU) {
      const result = engine.handleAction(room, player.uid, ACTIONS.HU);
      broadcastGameState(io, room);
      if (result.gameEnd) endGame(io, room, result);
    } else if (aiResp.action === ACTIONS.KONG) {
      const result = engine.handleAction(room, player.uid, ACTIONS.KONG, aiResp.extra);
      broadcastGameState(io, room);
      if (result.gameEnd) endGame(io, room, result);
      else if (result.nextAction) startActionPhase(io, room, result.nextAction, result.nextAction.drawn);
    } else {
      // fallback：出最差的一張
      const hand = room.gameState.hands[seat];
      if (!hand?.length) return;
      const { extra } = aiPlayer.decideDiscard(
        hand, room.gameState.melds[seat], room.aiLevel, buildAIContext(room));
      const fallTileId = extra?.tileId || hand[0].id;
      const result = engine.playTile(room, player.uid, fallTileId);
      broadcastGameState(io, room);
      openClaimWindow(io, room, result.claimWindow);
    }
  } catch (e) {
    logger.error(`AI executeAIAction seat=${seat}:`, e.message);
    // 最後保底：出第一張
    try {
      const hand = room.gameState?.hands[seat];
      if (hand?.length) {
        const result = engine.playTile(room, player.uid, hand[0].id);
        broadcastGameState(io, room);
        openClaimWindow(io, room, result.claimWindow);
      }
    } catch (e2) { logger.error('AI fallback failed:', e2.message); }
  }
}

// ══════════════════════════════════════
//  遊戲結束
// ══════════════════════════════════════
async function endGame(io, room, result) {
  room.status = 'finished';
  pendingClaims.delete(room.roomId);

  // 清掉所有玩家的超時計時器
  for (const p of room.players) clearPlayerTimer(p);

  // 揭露所有人手牌
  const state = room.gameState;
  const allHands    = state?.hands    || {};
  const allFlowers  = state?.flowers  || {};

  io.to(room.roomId).emit(EVENTS.GAME_END, {
    ...result,
    allHands,
    allFlowers,
    melds: state?.melds,
  });

  logger.info(`Game ended room=${room.roomId} winner=${result.winner}`);

  // 結算金幣（只記錄真人玩家）
  try {
    await gameRecord.settleAndRecord(room, result);
  } catch (e) {
    logger.error('結算失敗:', e.message);
  }

  // 10 秒後清理房間
  setTimeout(() => {
    for (const p of room.players) {
      if (p.socketId) {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) s.leave(room.roomId);
      }
    }
    roomManager.deleteRoom?.(room.roomId);
  }, 10000);
}

// ══════════════════════════════════════
//  工具函式
// ══════════════════════════════════════

/** 廣播房間狀態（隱藏各家手牌） */
function broadcastGameState(io, room) {
  io.to(room.roomId).emit(EVENTS.ROOM_STATE, sanitizeRoom(room));
}

/** 去除手牌（只保留張數）、保留公開資訊 */
function sanitizeRoom(room) {
  const gs = room.gameState;
  return {
    roomId:   room.roomId,
    betKey:   room.betKey,
    baseBet:  room.baseBet,
    taiUnit:  room.taiUnit,
    status:   room.status,
    players:  room.players.map(p => ({
      uid:       p.uid,
      username:  p.username,
      seat:      p.seat,
      handCount: gs ? (gs.hands[p.seat]?.length || 0) : 0,
      melds:     gs?.melds[p.seat]    || [],
      flowers:   gs?.flowers[p.seat]  || [],
      isTing:    p.isTing || gs?.isTing?.[p.seat] || false,
      ready:     p.ready,
      isAI:      p.isAI,
    })),
    wallLeft:  gs?.wall?.length   ?? 0,
    pile:      gs?.pile           ?? [],
    last:      gs?.last           ?? null,
    lastBy:    gs?.lastBy         ?? null,
    turnSeat:  gs?.turnSeat       ?? null,
    phase:     gs?.phase          ?? null,
    dealer:    gs?.dealerSeat     ?? null,
  };
}

/** 取得下一個座位 */
function getNextSeat(room, fromSeat) {
  const seats = room.players.map(p => p.seat);
  return seats[(seats.indexOf(fromSeat) + 1) % seats.length];
}

/** 從 fromSeat 順時針排除自身 */
function getClockwiseSeats(seatList, fromSeat) {
  const idx = seatList.indexOf(fromSeat);
  const result = [];
  for (let i = 1; i < seatList.length; i++) {
    result.push(seatList[(idx + i) % seatList.length]);
  }
  return result;
}

/** 清除玩家的動作超時計時器 */
function clearPlayerTimer(player) {
  if (player?._actionTimer) {
    clearTimeout(player._actionTimer);
    player._actionTimer = null;
  }
}

/** 遍歷所有房間 */
function getAllRooms() {
  return roomManager.getAllRooms();
}

module.exports = { registerGameSocket };
