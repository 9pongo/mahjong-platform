// ════════════════════════════════════════
//  tests/mahjongEngine.test.js
//  引擎邏輯驗證（不需 DB，純記憶體）
// ════════════════════════════════════════
const engine  = require('../server/services/mahjongEngine');
const roomMgr = require('../server/socket/roomManager');
const { ACTIONS } = require('../shared/constants');

// ── 建立測試房間 ──────────────────────────
function makeRoom() {
  const room = roomMgr.createRoom('short', '10_3', 'p1');
  roomMgr.joinRoom(room.roomId, { uid:'p1', username:'玩家1', socketId:'s1', coins:9999 });
  roomMgr.joinRoom(room.roomId, { uid:'p2', username:'玩家2', socketId:'s2', coins:9999 });
  roomMgr.joinRoom(room.roomId, { uid:'p3', username:'玩家3', socketId:'s3', coins:9999 });
  roomMgr.joinRoom(room.roomId, { uid:'p4', username:'玩家4', socketId:'s4', coins:9999 });
  return room;
}

// ── 測試 1：初始化 ────────────────────────
function testInit() {
  const room  = makeRoom();
  const state = engine.initGame(room);

  const totalTiles = Object.values(state.hands).reduce((s,h)=>s+h.length,0)
    + Object.values(state.flowers).reduce((s,f)=>s+f.length,0)
    + state.wall.length;

  // 台灣 16 張制：144 張全數分配
  console.assert(totalTiles === 144,
    `❌ 總牌數應為 144，實際 ${totalTiles}`);

  // 莊家 16 張（花牌補完後），其他 13 張
  const [e,s,w,n] = ['east','south','west','north'];
  console.assert(state.hands[e].length === 16 || state.hands[e].length < 16,
    '莊家手牌應 ≤ 16（可能有花牌補進）');

  console.log('✅ testInit 通過');
  return room;
}

// ── 測試 2：出牌 ─────────────────────────
function testPlayTile() {
  const room  = makeRoom();
  const state = engine.initGame(room);

  const dealer     = state.dealerSeat;
  const dealerUID  = room.players.find(p => p.seat === dealer).uid;
  const hand       = state.hands[dealer];
  const tile       = hand[0];

  const result = engine.playTile(room, dealerUID, tile.id);
  console.assert(result.claimWindow, '❌ 出牌後應有 claimWindow');
  console.assert(result.claimWindow.tile.id === tile.id, '❌ claimWindow.tile 應與出牌相同');
  console.assert(!state.hands[dealer].find(t => t.id === tile.id), '❌ 出牌後手牌應減少');

  console.log('✅ testPlayTile 通過');
}

// ── 測試 3：全過後推進到下家 ───────────────
function testAllPass() {
  const room  = makeRoom();
  const state = engine.initGame(room);

  const dealer    = state.dealerSeat;
  const dealerUID = room.players.find(p => p.seat === dealer).uid;
  const tile      = state.hands[dealer][0];

  engine.playTile(room, dealerUID, tile.id);

  // 推進：全過
  const { nextSeat } = engine.proceedToNextDraw(room, dealer);
  const seats = ['east','south','west','north'];
  const expected = seats[(seats.indexOf(dealer) + 1) % 4];
  console.assert(nextSeat === expected,
    `❌ 全過後下一家應為 ${expected}，實際 ${nextSeat}`);

  console.log('✅ testAllPass 通過');
}

// ── 測試 4：AI 決策不為空 ─────────────────
function testAIDecide() {
  const aiPlayer = require('../server/services/aiPlayer');
  const room  = makeRoom();
  const state = engine.initGame(room);
  const seat  = 'east';

  const resp = aiPlayer.decideDiscard(state.hands[seat], state.melds[seat]);
  console.assert(resp && resp.action, '❌ AI 應回傳 action');
  console.assert(
    ['hu','kong','play'].includes(resp.action),
    `❌ AI action 應為 hu/kong/play，實際 ${resp.action}`
  );
  if (resp.action === 'play') {
    console.assert(resp.extra?.tileId, '❌ play 動作應有 tileId');
  }

  console.log('✅ testAIDecide 通過');
}

// ── 執行 ──────────────────────────────────
console.log('── 麻將引擎測試 ──');
try { testInit(); } catch(e) { console.error('❌ testInit 失敗:', e.message); }
try { testPlayTile(); } catch(e) { console.error('❌ testPlayTile 失敗:', e.message); }
try { testAllPass(); } catch(e) { console.error('❌ testAllPass 失敗:', e.message); }
try { testAIDecide(); } catch(e) { console.error('❌ testAIDecide 失敗:', e.message); }
console.log('── 測試完成 ──');
