// ════════════════════════════════════════
//  client/js/gameClient.js
//  Socket.io 連線管理 & 遊戲狀態機
// ════════════════════════════════════════
import { getSocket, setCurrentRoom, clearCurrentRoom } from './socket.js';

const EVENTS = {
  JOIN_ROOM:       'join_room',
  READY:           'ready',
  PLAY_TILE:       'play_tile',
  DECLARE_ACTION:  'declare_action',
  DECLARE_TING:    'declare_ting',
  REQUEST_AI:      'request_ai',
  ROOM_STATE:      'room_state',
  GAME_START:      'game_start',
  TILE_DRAWN:      'tile_drawn',
  TILE_PLAYED:     'tile_played',
  ACTION_REQUIRED: 'action_required',
  ACTION_RESULT:   'action_result',
  GAME_END:        'game_end',
  ERROR:           'game_error',
};

// ── 本地遊戲狀態 ──────────────────────────
const state = {
  // 連線
  socket:    null,
  roomId:    null,
  user:      null,
  betKey:    null,
  roomType:  null,

  // 自身
  mySeat:    null,
  myHand:    [],        // [{ id, name, suit }]
  lastDrawn: null,      // 剛摸到的牌 (id)
  myFlowers: [],
  myMelds:   [],

  // 對手（按 seat key）
  opponents: {},        // { seat: { username, handCount, melds, flowers, isTing } }

  // 桌面
  pile:      [],        // 棄牌堆
  wallLeft:  0,
  turnSeat:  null,
  phase:     null,
  last:      null,
  lastBy:    null,
  dealer:    null,
  seatMap:   {},        // { seat: uid }

  // 動作狀態
  pendingType:     null,   // 'discard' | 'claim'
  availableActions: [],    // ['hu','pong',...]
  claimTile:        null,  // 搶牌視窗中的目標牌
  chowOptions:      [],    // [[名,名,名],...]（吃牌選項）
  countdown:        0,     // 剩餘秒數
  _countdownTimer:  null,
  _selectedTile:    null,  // 選中要出的牌 id

  // 回呼
  _onStateChange: null,
  _onToast:       null,
};

// ── 公開 API ──────────────────────────────
export const gameClient = {

  init({ user, betKey, roomType, roomId, dojoMode, dojoId, onStateChange, onToast, onGameEnd }) {
    state.user      = user;
    state.betKey    = betKey;
    state.roomType  = roomType;
    state.dojoMode  = dojoMode  || false;
    state.dojoId    = dojoId    || null;
    state._onStateChange = onStateChange;
    state._onToast       = onToast;
    state._onGameEnd     = onGameEnd || null;

    const socket = getSocket(user.token);
    state.socket = socket;

    _registerEvents(socket);

    // 加入房間
    socket.emit(EVENTS.JOIN_ROOM, {
      roomId, betKey, roomType,
      uid:      user.uid,
      username: user.username,
      coins:    user.coins || 1000,
    });
  },

  // 選牌（點擊手牌）
  selectTile(tileId) {
    if (state.pendingType !== 'discard') return;
    state._selectedTile = tileId;
    emit('stateChange');
  },

  // 確認出牌（點擊已選牌、或雙擊）
  playTile(tileId) {
    if (state.pendingType !== 'discard') return;
    if (!state.roomId) return;
    state._selectedTile = null;
    state.pendingType   = null;
    stopCountdown();
    state.socket.emit(EVENTS.PLAY_TILE, { roomId: state.roomId, tileId });
  },

  // 動作宣告（碰/槓/吃/胡/過）
  declareAction(action, extra) {
    if (!state.roomId) return;
    stopCountdown();
    state.pendingType    = null;
    state.availableActions = [];
    state.socket.emit(EVENTS.DECLARE_ACTION, { roomId: state.roomId, action, extra });
    emit('stateChange');
  },

  // 宣告聽牌
  declareTing() {
    if (!state.roomId) return;
    state.socket.emit(EVENTS.DECLARE_TING, { roomId: state.roomId });
  },

  // 準備（補 AI 開始）
  sendReady() {
    if (!state.roomId) return;
    state.socket.emit(EVENTS.READY, { roomId: state.roomId });
  },

  // 要求 AI 代打
  requestAI() {
    if (!state.roomId) return;
    state.socket.emit(EVENTS.REQUEST_AI, { roomId: state.roomId });
  },

  getState: () => state,
};

// ══════════════════════════════════════
//  Socket 事件處理
// ══════════════════════════════════════
function _registerEvents(socket) {

  // ── 房間狀態更新 ────────────────────────
  socket.on(EVENTS.ROOM_STATE, (room) => {
    state.roomId   = room.roomId;
    if (room.roomId) setCurrentRoom(room.roomId);   // 記住房間供斷線重連
    state.wallLeft = room.wallLeft;
    state.pile     = room.pile     || [];
    state.last     = room.last     || null;
    state.lastBy   = room.lastBy   || null;
    state.turnSeat = room.turnSeat || null;
    state.phase    = room.phase    || null;
    state.dealer   = room.dealer   || null;

    // 更新對手資訊
    if (state.mySeat) {
      state.myMelds = [];
      for (const p of room.players) {
        if (p.seat === state.mySeat) {
          state.myMelds   = p.melds    || [];
          state.myFlowers = p.flowers  || [];
        } else {
          state.opponents[p.seat] = {
            uid:       p.uid,
            username:  p.username,
            handCount: p.handCount,
            melds:     p.melds    || [],
            flowers:   p.flowers  || [],
            isTing:    p.isTing   || false,
            isAI:      p.isAI     || false,
          };
        }
      }
    }

    // 更新等待畫面玩家列表
    if (room.status === 'waiting') {
      _updateWaitList(room.players);
    }

    emit('stateChange');
  });

  // ── 遊戲開始 ──────────────────────────
  socket.on(EVENTS.GAME_START, (data) => {
    state.mySeat    = data.mySeat;
    state.myHand    = data.hand     || [];
    state.myFlowers = data.flowers  || [];
    state.dealer    = data.dealer;
    state.seatMap   = data.seats    || {};
    state.wallLeft  = data.wallLeft || 0;
    state.lastDrawn = null;

    document.getElementById('wait-overlay').classList.add('hidden');
    emit('stateChange');
    toast('遊戲開始！', 2000);
  });

  // ── 摸牌（私訊）────────────────────────
  socket.on(EVENTS.TILE_DRAWN, ({ tile }) => {
    if (tile) {
      state.myHand.push(tile);
      state.lastDrawn = tile.id;
    }
    emit('stateChange');
  });

  // ── 有人出牌 ────────────────────────────
  socket.on(EVENTS.TILE_PLAYED, ({ tile, bySeat }) => {
    state.last   = tile;
    state.lastBy = bySeat;
    // 從自家手牌移除（若是自己出的）
    if (bySeat === state.mySeat) {
      state.myHand = state.myHand.filter(t => t.id !== tile.id);
      state.lastDrawn = null;
    }
    const name = _seatDisplayName(bySeat, true);
    _setActionMsg(`${name} 出了 ${tile.name}`);
    emit('stateChange');
  });

  // ── 動作結果廣播 ────────────────────────
  socket.on(EVENTS.ACTION_RESULT, ({ action, bySeat }) => {
    const name = _seatDisplayName(bySeat, true);
    const labels = { pong: '碰', kong: '槓', chow: '吃', hu: '胡！' };
    _setActionMsg(`${name} ${labels[action] || action}`);
    emit('stateChange');
  });

  // ── 需要動作 ────────────────────────────
  socket.on(EVENTS.ACTION_REQUIRED, (data) => {
    const { type, hand, drawn, availableActions, canHu,
            concealedKongs, tile, chowOpts, timeout } = data;

    state.pendingType    = type;
    state.availableActions = availableActions || [];
    state.claimTile      = tile   || null;
    state.chowOptions    = chowOpts || [];

    if (type === 'discard') {
      if (hand)  state.myHand    = hand;
      if (drawn) state.lastDrawn = drawn?.id;
      // 自摸胡 / 暗槓 加入 availableActions
      const extra = [];
      if (canHu)               extra.push('hu');
      if (concealedKongs?.length) extra.push('kong');
      state.availableActions = [...extra, ...state.availableActions];
    }

    startCountdown(timeout);
    emit('stateChange');
    toast(type === 'discard' ? '輪到你出牌' : `可以${availableActions?.join('/')}`, 1500);
  });

  // ── 遊戲結束 ────────────────────────────
  socket.on(EVENTS.GAME_END, (result) => {
    state.pendingType    = null;
    state.availableActions = [];
    stopCountdown();
    clearCurrentRoom();   // 遊戲結束後清除房間記憶
    _showResult(result);
    emit('stateChange');
    if (state._onGameEnd) state._onGameEnd(result);
  });

  // ── 錯誤 ──────────────────────────────
  socket.on(EVENTS.ERROR, ({ message }) => {
    toast(`⚠️ ${message}`, 3000);
    // 恢復狀態
    state.pendingType = null;
    emit('stateChange');
  });
}

// ══════════════════════════════════════
//  倒數計時
// ══════════════════════════════════════
function startCountdown(ms) {
  stopCountdown();
  const wrap = document.getElementById('countdown-wrap');
  const bar  = document.getElementById('countdown-bar');
  if (!wrap || !bar) return;

  const total = ms || 8000;
  let elapsed = 0;
  wrap.style.opacity = '1';
  bar.style.transition = 'none';
  bar.style.width = '100%';

  // 強制 reflow
  bar.offsetHeight;

  bar.style.transition = `width ${total / 1000}s linear`;
  bar.style.width = '0%';

  state._countdownTimer = setTimeout(() => {
    wrap.style.opacity = '0';
  }, total);
}

function stopCountdown() {
  if (state._countdownTimer) {
    clearTimeout(state._countdownTimer);
    state._countdownTimer = null;
  }
  const wrap = document.getElementById('countdown-wrap');
  const bar  = document.getElementById('countdown-bar');
  if (wrap) wrap.style.opacity = '0';
  if (bar)  { bar.style.transition = 'none'; bar.style.width = '100%'; }
}

// ══════════════════════════════════════
//  UI 輔助
// ══════════════════════════════════════
function _updateWaitList(players) {
  const el = document.getElementById('player-list');
  if (!el) return;
  el.innerHTML = players.map(p =>
    `<div>${p.isAI ? '🤖' : '👤'} ${p.username} (${p.seat})</div>`
  ).join('');
}

function _setActionMsg(msg) {
  const el = document.getElementById('last-action-msg');
  if (el) { el.textContent = msg; }
}

function _seatDisplayName(seat, relative) {
  if (!seat) return '—';
  if (seat === state.mySeat) return '我';
  // 判斷上/下/對家
  const seats = ['east','south','west','north'];
  const myIdx  = seats.indexOf(state.mySeat);
  const tIdx   = seats.indexOf(seat);
  if (myIdx < 0) return seat;
  const diff = ((tIdx - myIdx) + 4) % 4;
  const labels = { 1:'下家', 2:'對家', 3:'上家' };
  const opp = state.opponents[seat];
  const name = opp?.username || seat;
  return relative ? `${labels[diff] || seat}(${name})` : name;
}

function _showResult(result) {
  const overlay = document.getElementById('result-overlay');
  const title   = document.getElementById('result-title');
  const winEl   = document.getElementById('result-win');
  const detEl   = document.getElementById('result-details');

  overlay.classList.remove('hidden');

  if (!result.winner) {
    title.textContent = '流局';
    winEl.textContent = '本局平手，無人胡牌';
    detEl.textContent = '';
    return;
  }

  const isWin = result.winner === state.mySeat;
  title.textContent = isWin ? '🎉 胡牌！' : '😢 對手胡牌';
  winEl.style.color = isWin ? '#44ff88' : '#ff6644';

  const tai = result.taiResult;
  const methodLabel = result.method === 'tsumo' ? '自摸' : '食炮';
  winEl.textContent = `${_seatDisplayName(result.winner, true)} ${methodLabel} ${tai?.total ?? 0} 台`;

  if (tai?.details?.length) {
    detEl.innerHTML = tai.details
      .filter(d => d.tai > 0)
      .map(d => `<span>${d.name}：${d.tai} 台</span>`)
      .join(' · ');
  }
}

function emit(event) {
  if (event === 'stateChange' && state._onStateChange) {
    state._onStateChange({ ...state });
  }
}

function toast(msg, ms = 2000) {
  if (state._onToast) state._onToast(msg, ms);
}
