// ════════════════════════════════════════
//  server/socket/roomManager.js
//  房間狀態完全在記憶體管理（Phase 3 後可改 Redis）
// ════════════════════════════════════════
const { v4: uuidv4 }   = require('uuid');
const { BET_CONFIGS, MAX_PLAYERS } = require('../../shared/constants');

/** 從桌金設定推算 AI 難度 */
function getAILevel(betKey) {
  if (betKey === '10_3')                              return 'easy';
  if (betKey === '1000_300' || betKey === '1000_300d') return 'hard';
  return 'normal';
}

// roomId → Room 物件
const rooms = new Map();

/**
 * Room 結構：
 * {
 *   roomId, roomType, betKey, baseBet, taiUnit,
 *   players: [{ uid, username, socketId, seat, coins, ready, isAI }],
 *   status: 'waiting' | 'playing' | 'finished',
 *   gameState: null | Object,   // 由 mahjongEngine 填充
 *   createdAt,
 * }
 */

function createRoom(roomType, betKey, hostUid) {
  const cfg = BET_CONFIGS[betKey];
  if (!cfg) throw new Error(`無效桌金設定：${betKey}`);

  const roomId = uuidv4();
  const room = {
    roomId,
    roomType: roomType || cfg.roomType,
    betKey,
    baseBet:  cfg.baseBet,
    taiUnit:  cfg.taiUnit,
    aiLevel:  getAILevel(betKey),   // 'easy' | 'normal' | 'hard'
    players:  [],
    status:   'waiting',
    gameState: null,
    createdAt: Date.now(),
  };
  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function joinRoom(roomId, playerInfo) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('房間不存在');
  if (room.status !== 'waiting') throw new Error('遊戲已開始');
  if (room.players.length >= MAX_PLAYERS) throw new Error('房間已滿');
  if (room.players.some(p => p.uid === playerInfo.uid)) return room; // 已在房

  const seats = ['east','south','west','north'];
  const takenSeats = room.players.map(p => p.seat);
  const seat = seats.find(s => !takenSeats.includes(s));

  room.players.push({
    uid:      playerInfo.uid,
    username: playerInfo.username,
    socketId: playerInfo.socketId,
    seat,
    coins:    playerInfo.coins || 1000,
    ready:    false,
    isAI:     false,
    isTing:   false,
    flowers:  [],
  });
  return room;
}

function leaveRoom(roomId, uid) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.players = room.players.filter(p => p.uid !== uid);
  if (room.players.length === 0) rooms.delete(roomId);
  return room;
}

/** 自動配桌：找同桌金的等待中房間，沒有就建新房 */
function matchmake(uid, roomType, betKey) {
  for (const room of rooms.values()) {
    if (
      room.betKey === betKey &&
      room.roomType === (roomType || BET_CONFIGS[betKey]?.roomType) &&
      room.status === 'waiting' &&
      room.players.length < MAX_PLAYERS &&
      !room.players.some(p => p.uid === uid)
    ) {
      return room;
    }
  }
  return createRoom(roomType, betKey, uid);
}

/** 填入 AI 代打，補滿4人 */
function fillWithAI(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const seats = ['east','south','west','north'];
  const takenSeats = room.players.map(p => p.seat);
  for (const seat of seats) {
    if (!takenSeats.includes(seat)) {
      room.players.push({
        uid: `AI_${seat}`, username: `AI(${seat})`,
        socketId: null, seat,
        coins: 999999, ready: true, isAI: true,
        isTing: false, flowers: [],
      });
    }
  }
}

function listRooms(type) {
  const list = [];
  for (const room of rooms.values()) {
    if (type && room.roomType !== type) continue;
    if (room.status !== 'waiting') continue;
    list.push({
      roomId:    room.roomId,
      roomType:  room.roomType,
      betKey:    room.betKey,
      baseBet:   room.baseBet,
      taiUnit:   room.taiUnit,
      players:   room.players.length,
    });
  }
  return list;
}

function setGameState(roomId, state) {
  const room = rooms.get(roomId);
  if (room) room.gameState = state;
}

function deleteRoom(roomId) {
  rooms.delete(roomId);
}

function getAllRooms() {
  return [...rooms.values()];
}

module.exports = {
  createRoom, getRoom, joinRoom, leaveRoom,
  matchmake, fillWithAI, listRooms, setGameState,
  deleteRoom, getAllRooms,
};
