// ════════════════════════════════════════
//  server/socket/gameSocket.js
//  麻將多人對戰核心 — 含搶牌視窗 / AI 接管
// ════════════════════════════════════════
const roomManager   = require('./roomManager');
const { addObserver, removeObserver } = require('./roomManager');
const engine        = require('../services/mahjongEngine');
const aiPlayer      = require('../services/aiPlayer');
const gameRecord    = require('../services/gameRecordService');
const { collectAchievementNotifications } = require('../services/gameRecordService');
const { sendPush }  = require('../services/pushService');
const { EVENTS, ACTIONS, SEATS } = require('../../shared/constants');
const {
  checkWin, concealedKongNames, addKongNames, chowOptions,
} = require('../../shared/mahjongRules');
const logger = require('../utils/logger');

// uid → socketId（斷線重連）
const userSocket = new Map();

// uid → { roomId, betKey, roomType }（進行中對局，強制回局用）
const userActiveGame = new Map();

// roomId → TimeoutHandle（全員離場後的自動結束計時器）
const abandonTimers = new Map();

// roomId → { seq: number, buf: Array }（回放步驟緩衝）
const moveLogs = new Map();

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

  // 加入個人頻道（供好友邀請通知使用）
  socket.join(`user:${uid}`);

  // ── 連線時通知是否有進行中對局（大廳用）──
  const existingGame = userActiveGame.get(uid);
  if (existingGame) {
    const activeRoom = roomManager.getRoom(existingGame.roomId);
    if (activeRoom && activeRoom.status === 'playing') {
      socket.emit('has_active_game', existingGame);
    } else {
      // 對局已結束，清除紀錄
      userActiveGame.delete(uid);
    }
  }

  // ── join_room ──────────────────────────
  socket.on(EVENTS.JOIN_ROOM, ({ roomId, betKey, roomType, coins }) => {
    try {
      // ── 強制回局：若有進行中對局，禁止加入新房間 ──
      const activeGame = userActiveGame.get(uid);
      if (activeGame) {
        const activeRoom = roomManager.getRoom(activeGame.roomId);
        if (activeRoom && activeRoom.status === 'playing') {
          // 通知客戶端導回進行中對局
          socket.emit('redirect_to_room', activeGame);
          logger.info(`${username} blocked from joining new room, redirected to ${activeGame.roomId}`);
          return;
        } else {
          userActiveGame.delete(uid); // 舊紀錄已失效，清除
        }
      }

      let room = roomId
        ? roomManager.getRoom(roomId)
        : roomManager.matchmake(uid, roomType, betKey);

      if (!room) room = roomManager.createRoom(roomType, betKey, uid);

      room = roomManager.joinRoom(room.roomId, {
        uid, username, socketId: socket.id,
        coins: coins || 10000,
      });

      // 更新 lastActive（包含重連進同一房間的情況）
      const self = room.players.find(p => p.uid === uid);
      if (self) self.lastActive = Date.now();

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
  // 任何一位玩家送出 ready 即立刻補 AI 開始
  // （避免多頁重連產生殭屍座位導致 allReady 永遠不成立）
  socket.on(EVENTS.READY, ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.status !== 'waiting') return;

    // 確認送出者確實在房間內
    const player = room.players.find(p => p.uid === uid);
    if (!player) return;

    // 更新自己的 lastActive
    player.lastActive = Date.now();

    // 殭屍清除：踢掉超過 20 秒沒有任何活動的非 AI 座位
    // （Socket.io 心跳最久 45 秒才偵測到斷線，用時間戳更可靠）
    const ZOMBIE_MS = 20_000;
    const now = Date.now();
    const kicked = [];
    room.players = room.players.filter(p => {
      if (p.isAI)       return true;
      if (p.uid === uid) return true;   // 當前玩家保留
      const active = p.lastActive || 0;
      if (now - active < ZOMBIE_MS) return true;  // 最近有活動，保留
      kicked.push(p.username);
      return false;
    });
    if (kicked.length) logger.info(`[Ready] 踢除殭屍座位: ${kicked.join(', ')}`);

    // 立即填滿 AI 並開始
    roomManager.fillWithAI(roomId);
    startGame(io, room);
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

  // ── 好友對戰邀請 ──────────────────────
  socket.on('friend:invite_send', ({ targetUid, betKey, roomType }) => {
    const { BET_CONFIGS } = require('../../shared/constants');
    if (!BET_CONFIGS[betKey]) {
      socket.emit('friend:invite_error', { message: '無效桌金' });
      return;
    }
    try {
      const rType = roomType || BET_CONFIGS[betKey].roomType;
      const room  = roomManager.createRoom(rType, betKey, uid);
      // 通知目標玩家（Socket + Push）
      io.to(`user:${targetUid}`).emit('friend:invite', {
        fromUid:      uid,
        fromUsername: username,
        betKey,
        roomType:     rType,
        roomId:       room.roomId,
      });
      sendPush(targetUid, {
        title: '🀄 對戰邀請',
        body:  `${username} 邀請你加入底注 ${betKey.replace('_', '/')} 的牌局！`,
        tag:   'game-invite',
        data:  { url: `/pages/game.html?roomId=${room.roomId}&betKey=${betKey}&roomType=${rType}` },
      });
      // 告訴邀請方 roomId，讓他自行跳轉
      socket.emit('friend:invite_sent', {
        roomId:   room.roomId,
        betKey,
        roomType: rType,
      });
      logger.info(`${username} 邀請 ${targetUid} 到房間 ${room.roomId}`);
    } catch (e) {
      socket.emit('friend:invite_error', { message: e.message });
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

    // 有玩家回來了，取消自動結算
    const aTimer = abandonTimers.get(roomId);
    if (aTimer) { clearTimeout(aTimer); abandonTimers.delete(roomId); }

    const state = room.gameState;
    socket.emit(EVENTS.ROOM_STATE, {
      ...sanitizeRoom(room),
      myHand:    state?.hands[player.seat]    || [],
      myFlowers: state?.flowers[player.seat]  || [],
    });
    logger.info(`${username} reconnected to ${roomId}`);
  });

  // ── spectate_room  ────────────────────────
  socket.on('spectate_room', ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) { socket.emit(EVENTS.ERROR, { message: '房間不存在' }); return; }
    addObserver(roomId, socket.id);
    socket.join(roomId);
    logger.info(`[spectator] ${socket.id} watching ${roomId}`);

    // 立即推送目前遊戲狀態（若遊戲中）
    if (room.status === 'playing' && room.gameState) {
      const state = room.gameState;
      const spectatorState = {
        roomId,
        betKey:   room.betKey,
        status:   room.status,
        turnSeat: state.turnSeat,
        wallLeft: state.wall?.length ?? 0,
        pile:     state.pile,
        melds:    state.melds,
        // 所有玩家手牌背面（不揭示）
        players:  room.players.map(p => ({
          uid: p.uid, username: p.username,
          seat: p.seat, handCount: state.hands[p.seat]?.length ?? 0,
          isTing: state.tingSeats?.[p.seat] ?? false,
        })),
      };
      socket.emit('spectate_state', spectatorState);
    }
  });

  // ── disconnect ──────────────────────────
  socket.on('disconnect', () => {
    userSocket.delete(uid);
    // 移除觀戰
    for (const room of getAllRooms()) {
      removeObserver(room.roomId, socket.id);
    }
    // 找到所在房間
    for (const room of getAllRooms()) {
      const player = room.players.find(p => p.uid === uid);
      if (!player) continue;

      if (room.status === 'waiting') {
        // 等待中斷線 → 直接移除座位，避免殭屍座位卡住補 AI
        roomManager.leaveRoom(room.roomId, uid);
        io.to(room.roomId).emit(EVENTS.ROOM_STATE, sanitizeRoom(room));
        logger.info(`${username} left waiting room ${room.roomId}`);
      } else if (room.status === 'playing') {
        // 遊戲中斷線 → AI 代打
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

        // 若所有真人玩家都已離線，60 秒後自動結算
        const humanOnline = room.players.filter(p => !p.isAI && p.socketId);
        if (humanOnline.length === 0 && !abandonTimers.has(room.roomId)) {
          logger.info(`All humans left ${room.roomId}, scheduling auto-finish in 60s`);
          const t = setTimeout(() => {
            abandonTimers.delete(room.roomId);
            if (room.status === 'playing') {
              // 強制以流局結束
              endGame(io, room, { winner: null, loser: null, winType: 'exhaust',
                scores: {}, details: '所有玩家離場，自動結算' });
            }
          }, 60000);
          abandonTimers.set(room.roomId, t);
        }
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

  // 登記所有真人玩家的進行中對局
  for (const p of room.players) {
    if (!p.isAI) {
      userActiveGame.set(p.uid, {
        roomId:   room.roomId,
        betKey:   room.betKey,
        roomType: room.roomType,
      });
    }
  }

  // 初始化回放步驟緩衝
  moveLogs.set(room.roomId, { seq: 0, buf: [] });

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
  logMove(room.roomId, bySeat, 'discard', tile.name);

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
    // 記錄步驟（碰/槓/吃/胡）
    const tileNameForLog = extra?.tile?.name || extra?.name || null;
    logMove(room.roomId, seat, label, tileNameForLog, extra || {});
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
    // 防止遊戲卡死：根據當前 phase 嘗試恢復
    if (room.status !== 'playing' || !room.gameState) return;
    const gs = room.gameState;
    try {
      if (gs.phase === 'discard' && gs.hands[seat]?.length) {
        // 輪到該玩家出牌 → 強制出第一張
        const result = engine.playTile(room, player.uid, gs.hands[seat][0].id);
        broadcastGameState(io, room);
        openClaimWindow(io, room, result.claimWindow);
      } else if (gs.phase === 'claim') {
        // 搶牌階段發生錯誤 → 推進到下一家摸牌
        const bySeat = gs.lastBy || seat;
        pendingClaims.delete(room.roomId);
        proceedToNextDraw(io, room, bySeat);
      }
    } catch (e2) { logger.error('_executeAction recovery failed:', e2.message); }
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

    // 記錄摸牌
    if (drawn) logMove(room.roomId, seat, 'draw', drawn.name);

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
        if (room.status !== 'playing' || !room.gameState) return;
        const gs = room.gameState;
        if (!gs.hands[seat]?.length) {
          // 手牌異常空了，強制跳過（避免永久卡死）
          logger.warn(`AI ${seat} 手牌為空，強制跳過`);
          proceedToNextDraw(io, room, seat);
          return;
        }
        const aiResp = aiPlayer.decideDiscard(
          gs.hands[seat], gs.melds[seat],
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
        addKongs:       addKongNames(hand, melds),    // 加槓
        timeout,
      });
    }

    player._actionTimer = setTimeout(() => {
      if (room.status !== 'playing' || !room.gameState) return;
      logger.info(`玩家 ${seat} 超時，AI 代打`);
      const gs = room.gameState;
      if (!gs.hands[seat]?.length) {
        proceedToNextDraw(io, room, seat);
        return;
      }
      const aiResp = aiPlayer.decideDiscard(
        gs.hands[seat], gs.melds[seat],
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
// ══════════════════════════════════════
//  回放步驟記錄
// ══════════════════════════════════════
function logMove(roomId, seat, action, tileName, extra = {}) {
  const log = moveLogs.get(roomId);
  if (!log) return;
  log.buf.push({ seq: log.seq++, seat, action, tile_name: tileName || null, extra });
}

async function flushMoveLogs(roomId) {
  const log = moveLogs.get(roomId);
  if (!log || log.buf.length === 0) return;
  const rows = log.buf.map(m => ({ room_id: roomId, ...m }));
  moveLogs.delete(roomId);
  try {
    const supabase = require('../models/supabase');
    // 分批 500 筆插入（避免超過 Supabase 請求大小限制）
    for (let i = 0; i < rows.length; i += 500) {
      await supabase.from('game_moves').insert(rows.slice(i, i + 500));
    }
  } catch (e) {
    logger.warn(`[Replay] flushMoveLogs ${roomId} failed: ${e.message}`);
  }
}

function buildAIContext(room) {
  const gs = room.gameState;
  if (!gs) return {};

  // 收集所有對手已公開的面子（碰/槓/吃），供危牌偵測用
  const allOpponentMelds = [];
  for (const [seat, meldArr] of Object.entries(gs.melds || {})) {
    for (const meld of meldArr) {
      allOpponentMelds.push(meld);
    }
  }

  return {
    pile:             gs.pile || [],
    isTingSeats:      Object.entries(gs.isTing || {})
      .filter(([, v]) => v).map(([s]) => s),
    allOpponentMelds,
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

  // 清除所有玩家的超時計時器
  for (const p of room.players) clearPlayerTimer(p);

  // 解除進行中對局登記（讓玩家可以進新局）
  for (const p of room.players) {
    if (!p.isAI) userActiveGame.delete(p.uid);
  }

  // 取消全員離場的自動結算計時器
  const aTimer = abandonTimers.get(room.roomId);
  if (aTimer) { clearTimeout(aTimer); abandonTimers.delete(room.roomId); }

  // 記錄結局步驟並批次寫入回放資料
  const endAction = result.winner ? 'hu' : 'exhaust';
  logMove(room.roomId, result.winner || 'none', endAction, null,
    { winType: result.winType, taiCount: result.taiResult?.total || 0 });
  flushMoveLogs(room.roomId);

  // 揭露所有人手牌
  const state = room.gameState;
  const allHands    = state?.hands    || {};
  const allFlowers  = state?.flowers  || {};

  logger.info(`Game ended room=${room.roomId} winner=${result.winner}`);

  const playerList = room.players.map(p => ({ uid: p.uid, username: p.username, seat: p.seat, isAI: p.isAI }));

  // 先廣播結果（不含金幣，確保玩家看得到牌局結果）
  io.to(room.roomId).emit(EVENTS.GAME_END, {
    ...result,
    allHands,
    allFlowers,
    melds:   state?.melds,
    players: playerList,
    coinDeltas: {},  // 先送空，結算後補送
  });

  // 結算金幣 + 補送 coinDeltas
  try {
    const coinDeltas = await gameRecord.settleAndRecord(room, result) || {};
    // 補播金幣變化
    io.to(room.roomId).emit('game:coin_settled', { coinDeltas });

    // 成就通知
    setTimeout(() => {
      const achMap = collectAchievementNotifications(room.players);
      for (const [pUid, achs] of Object.entries(achMap)) {
        io.to(`user:${pUid}`).emit('achievement:unlocked', { achievements: achs });
      }
    }, 3000);
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
