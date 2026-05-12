// ════════════════════════════════════════
//  server/socket/gameSocket.js
//  麻將對戰 Socket.io 事件處理
// ════════════════════════════════════════
const roomManager  = require('./roomManager');
const mahjongEngine = require('../services/mahjongEngine');
const { EVENTS, ACTIONS } = require('../../shared/constants');
const logger = require('../utils/logger');

// uid → socketId 映射（斷線重連用）
const userSocket = new Map();

function registerGameSocket(io, socket) {
  // ── 身份取得（Phase 2 補 JWT 驗證，Phase 1 先用 handshake.auth） ──
  const uid      = socket.handshake.auth?.uid      || socket.id;
  const username = socket.handshake.auth?.username || `玩家${socket.id.slice(0,4)}`;
  userSocket.set(uid, socket.id);

  // ── join_room ────────────────────────────
  socket.on(EVENTS.JOIN_ROOM, ({ roomId, betKey, roomType }) => {
    try {
      let room = roomId
        ? roomManager.getRoom(roomId)
        : roomManager.matchmake(uid, roomType, betKey);

      if (!room) room = roomManager.createRoom(roomType, betKey, uid);

      room = roomManager.joinRoom(room.roomId, {
        uid, username, socketId: socket.id, coins: 10000,
      });

      socket.join(room.roomId);
      logger.info(`${username} joined room ${room.roomId}`);

      // 廣播房間狀態給所有人
      io.to(room.roomId).emit(EVENTS.ROOM_STATE, sanitizeRoom(room));

      // 滿 4 人 → 自動開始
      if (room.players.length === MAX_PLAYERS_IN_ROOM(room)) {
        startGame(io, room);
      }
    } catch (e) {
      socket.emit(EVENTS.ERROR, { message: e.message });
    }
  });

  // ── ready（單人先行：先填 AI 再開始）────
  socket.on(EVENTS.READY, ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    const player = room.players.find(p => p.uid === uid);
    if (player) player.ready = true;

    const allReady = room.players.every(p => p.ready);
    if (allReady && room.players.length >= 1) {
      roomManager.fillWithAI(roomId);  // 補滿 AI
      startGame(io, room);
    }
  });

  // ── play_tile ────────────────────────────
  socket.on(EVENTS.PLAY_TILE, ({ roomId, tileId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.status !== 'playing') return;
    try {
      const result = mahjongEngine.playTile(room, uid, tileId);
      broadcastGameState(io, room);
      handleAfterPlay(io, room, result);
    } catch (e) {
      socket.emit(EVENTS.ERROR, { message: e.message });
    }
  });

  // ── declare_action  (pong/kong/chow/hu/pass) ──
  socket.on(EVENTS.DECLARE_ACTION, ({ roomId, action, extra }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.status !== 'playing') return;
    try {
      const result = mahjongEngine.handleAction(room, uid, action, extra);
      broadcastGameState(io, room);
      if (result.gameEnd) {
        endGame(io, room, result);
      } else if (result.nextAction) {
        promptAction(io, room, result.nextAction);
      }
    } catch (e) {
      socket.emit(EVENTS.ERROR, { message: e.message });
    }
  });

  // ── declare_ting ────────────────────────
  socket.on(EVENTS.DECLARE_TING, ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    mahjongEngine.declareTing(room, uid);
    broadcastGameState(io, room);
  });

  // ── 斷線重連 ─────────────────────────────
  socket.on('reconnect_room', ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    const player = room.players.find(p => p.uid === uid);
    if (player) {
      player.socketId = socket.id;
      userSocket.set(uid, socket.id);
      socket.join(roomId);
      // 只發給本人目前完整狀態
      socket.emit(EVENTS.ROOM_STATE, sanitizeRoomForPlayer(room, uid));
    }
  });
}

// ── 開始遊戲 ─────────────────────────────
function startGame(io, room) {
  if (room.status === 'playing') return;
  room.status = 'playing';
  const state = mahjongEngine.initGame(room);
  roomManager.setGameState(room.roomId, state);

  // 各自只能看到自己的手牌
  for (const player of room.players) {
    if (player.isAI || !player.socketId) continue;
    const sockets = io.sockets.sockets;
    const s = sockets.get(player.socketId);
    if (s) {
      s.emit(EVENTS.GAME_START, {
        hand:    state.hands[player.seat],   // 只給自己的手牌
        flowers: state.flowers[player.seat],
        seats:   state.seatMap,
        dealer:  state.dealerSeat,
        wall:    state.wall.length,
      });
    }
  }

  // 通知莊家出牌
  promptAction(io, room, { type: 'discard', seat: state.dealerSeat });
}

// ── 廣播遊戲狀態（隱藏對手手牌）────────
function broadcastGameState(io, room) {
  io.to(room.roomId).emit(EVENTS.ROOM_STATE, sanitizeRoom(room));
}

// ── 結束遊戲 ─────────────────────────────
function endGame(io, room, result) {
  room.status = 'finished';
  io.to(room.roomId).emit(EVENTS.GAME_END, result);
  logger.info(`Game ended in room ${room.roomId}`);
  // 5 秒後清理房間（給玩家看結算）
  setTimeout(() => {
    for (const p of room.players) {
      if (p.socketId) {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) s.leave(room.roomId);
      }
    }
  }, 5000);
}

// ── 提示下一個動作 ────────────────────────
function promptAction(io, room, actionInfo) {
  const { seat, type, timeout = 8000, availableActions } = actionInfo;
  const player = room.players.find(p => p.seat === seat);
  if (!player) return;

  if (player.isAI) {
    // AI 自動決策
    const delay = 400 + Math.random() * 600;
    setTimeout(() => {
      const action = mahjongEngine.aiDecide(room, seat);
      mahjongEngine.handleAction(room, player.uid, action.type, action.extra);
      broadcastGameState(io, room);
    }, delay);
    return;
  }

  const s = io.sockets.sockets.get(player.socketId);
  if (!s) return;
  s.emit(EVENTS.ACTION_REQUIRED, { type, availableActions, timeout });

  // 超時自動 AI 接管
  player._timeoutHandle = setTimeout(() => {
    const action = mahjongEngine.aiDecide(room, seat);
    mahjongEngine.handleAction(room, player.uid, action.type, action.extra);
    broadcastGameState(io, room);
  }, timeout + 500);
}

function handleAfterPlay(io, room, result) {
  if (result.gameEnd) { endGame(io, room, result); return; }
  if (result.claimWindow) {
    // 廣播出牌給所有人，等待搶牌
    io.to(room.roomId).emit(EVENTS.TILE_PLAYED, result.claimWindow);
    // 各自收到後自行判斷可碰/槓/胡
  } else if (result.nextAction) {
    promptAction(io, room, result.nextAction);
  }
}

// ── 工具：去除對手手牌 ───────────────────
function sanitizeRoom(room) {
  return {
    roomId:   room.roomId,
    betKey:   room.betKey,
    baseBet:  room.baseBet,
    taiUnit:  room.taiUnit,
    status:   room.status,
    players:  room.players.map(p => ({
      uid: p.uid, username: p.username, seat: p.seat,
      handCount: p.isAI || !room.gameState ? 0 : (room.gameState.hands[p.seat]?.length || 0),
      melds: room.gameState?.melds[p.seat] || [],
      flowers: room.gameState?.flowers[p.seat] || [],
      isTing: p.isTing, ready: p.ready, isAI: p.isAI,
    })),
    wall:     room.gameState?.wall?.length || 0,
    pile:     room.gameState?.pile || [],
    last:     room.gameState?.last || null,
    lastBy:   room.gameState?.lastBy || null,
    turnSeat: room.gameState?.turnSeat || null,
    phase:    room.gameState?.phase || null,
  };
}

function sanitizeRoomForPlayer(room, uid) {
  const base = sanitizeRoom(room);
  const player = room.players.find(p => p.uid === uid);
  if (player && room.gameState) {
    base.myHand    = room.gameState.hands[player.seat];
    base.myFlowers = room.gameState.flowers[player.seat];
  }
  return base;
}

function MAX_PLAYERS_IN_ROOM(room) {
  // 短打廳允許 2 人開桌（填 AI）；大眾廳需 4 人
  return room.roomType === 'short' ? 2 : 4;
}

module.exports = { registerGameSocket };
