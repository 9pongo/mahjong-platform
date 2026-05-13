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

/** 產生 6 碼大寫邀請碼 */
function genInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// inviteCode → roomId 快速索引
const codeIndex = new Map();

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
    isPrivate: false,
    inviteCode: null,
    players:  [],
    observers: [],              // socketId[]
    status:   'waiting',
    gameState: null,
    createdAt: Date.now(),
  };
  rooms.set(roomId, room);
  return room;
}

/** 建立私人房間（不被自動配桌撮合） */
function createPrivateRoom(betKey, hostUid) {
  const room = createRoom(null, betKey, hostUid);
  room.isPrivate  = true;
  const code = genInviteCode();
  room.inviteCode = code;
  codeIndex.set(code, room.roomId);
  return room;
}

/** 透過邀請碼取得房間 */
function getRoomByCode(code) {
  const roomId = codeIndex.get((code || '').toUpperCase());
  return roomId ? rooms.get(roomId) || null : null;
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

/** 自動配桌：找同桌金的等待中公開房間，沒有就建新房 */
function matchmake(uid, roomType, betKey) {
  for (const room of rooms.values()) {
    if (
      room.betKey === betKey &&
      room.roomType === (roomType || BET_CONFIGS[betKey]?.roomType) &&
      room.status === 'waiting' &&
      !room.isPrivate &&                         // 私人房不參與自動配桌
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
    if (room.isPrivate) continue;              // 不列出私人房
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

/** 觀戰：加入觀察者 */
function addObserver(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return false;
  if (!room.observers.includes(socketId)) room.observers.push(socketId);
  return true;
}

/** 觀戰：離開觀察者 */
function removeObserver(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.observers = room.observers.filter(id => id !== socketId);
}

function setGameState(roomId, state) {
  const room = rooms.get(roomId);
  if (room) room.gameState = state;
}

function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (room?.inviteCode) codeIndex.delete(room.inviteCode);  // 清理邀請碼索引
  rooms.delete(roomId);
}

function getAllRooms() {
  return [...rooms.values()];
}

module.exports = {
  createRoom, createPrivateRoom, getRoomByCode,
  getRoom, joinRoom, leaveRoom,
  matchmake, fillWithAI, listRooms, setGameState,
  deleteRoom, getAllRooms,
  addObserver, removeObserver,
};
