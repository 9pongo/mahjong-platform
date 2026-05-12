// ════════════════════════════════════════
//  client/js/gameUI.js
//  DOM 渲染層 — 不含任何業務邏輯
// ════════════════════════════════════════
import { gameClient } from './gameClient.js';

const SEATS_ORDER = ['east', 'south', 'west', 'north'];
const SEAT_WIND   = { east:'東', south:'南', west:'西', north:'北' };

// ── 牌色 CSS class ────────────────────────
function suitClass(name) {
  if (!name) return '';
  if (name.includes('萬')) return 'suit-man';
  if (name.includes('筒')) return 'suit-pin';
  if (name.includes('索')) return 'suit-sou';
  if (['春','夏','秋','冬','梅','蘭','菊','竹'].includes(name)) return 'suit-flower';
  return 'suit-honor';
}

// ── 建立牌元素 ────────────────────────────
function makeTile(tile, { size = '', extra = '', onClick = null } = {}) {
  const el = document.createElement('div');
  el.className = `tile ${size}`.trim();

  if (tile === 'back') {
    el.classList.add('back');
    return el;
  }

  const name = typeof tile === 'string' ? tile : tile?.name;
  if (!name) { el.classList.add('back'); return el; }

  el.textContent = name;
  el.classList.add(suitClass(name));
  if (name.includes('花') ||
      ['春','夏','秋','冬','梅','蘭','菊','竹'].includes(name)) {
    el.classList.add('suit-flower');
  }
  if (extra) el.classList.add(extra);
  if (onClick) el.addEventListener('click', onClick);
  return el;
}

// ══════════════════════════════════════════
//  主渲染入口
// ══════════════════════════════════════════
export const gameUI = {

  render(state) {
    _renderRoomInfo(state);
    if (!state.mySeat) {
      _renderWaiting(state);
      return;
    }
    _renderMyHand(state);
    _renderMyMeldsFlowers(state);
    _renderOpponents(state);
    _renderPile(state);
    _renderActionButtons(state);
  },

  showChowMenu() {
    const st = gameClient.getState();
    const tile = st.claimTile;
    if (!tile) return;

    // 從手牌計算可吃序列
    const hand  = st.myHand.map(t => t.name);
    const opts  = st.chowOptions?.length
      ? st.chowOptions
      : _computeChowOpts(hand, tile.name);

    if (!opts.length) {
      gameClient.declareAction('pass');
      return;
    }

    const overlay = document.getElementById('chow-overlay');
    const optsEl  = document.getElementById('chow-opts');
    optsEl.innerHTML = '';

    for (const seq of opts) {
      const btn = document.createElement('button');
      btn.className = 'chow-opt-btn';
      btn.textContent = seq.join('・');
      btn.onclick = () => {
        overlay.classList.add('hidden');
        gameClient.declareAction('chow', { seq });
      };
      optsEl.appendChild(btn);
    }

    overlay.classList.remove('hidden');
  },

  toast(msg, ms = 2000) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), ms);
  },
};

// ══════════════════════════════════════════
//  內部渲染函式
// ══════════════════════════════════════════

function _renderRoomInfo(state) {
  const ri = document.getElementById('room-info');
  const wc = document.getElementById('wall-count');
  if (ri) ri.textContent = state.roomId
    ? `${state.betKey} · ${_statusLabel(state)}`
    : '等待加入...';
  if (wc) wc.textContent = `牌：${state.wallLeft}`;
}

function _statusLabel(state) {
  if (!state.mySeat)   return '等待中';
  if (state.turnSeat === state.mySeat) return '輪到你';
  const name = _oppName(state, state.turnSeat);
  return name ? `等待 ${name}` : '進行中';
}

// ── 等待畫面 ─────────────────────────────
function _renderWaiting(state) {
  // 讓等待覆蓋層更新玩家數（由 gameClient 的 ROOM_STATE 事件負責）
}

// ── 自家手牌 ─────────────────────────────
function _renderMyHand(state) {
  const el = document.getElementById('my-hand-row');
  if (!el) return;
  el.innerHTML = '';

  const isMyTurn    = state.pendingType === 'discard';
  const selectedId  = state._selectedTile;

  for (const tile of state.myHand) {
    const isSelected = tile.id === selectedId;
    const isDrawn    = tile.id === state.lastDrawn;

    const div = makeTile(tile, {
      size: 'hand',
      extra: isSelected ? 'selected' : isDrawn ? 'drawn' : '',
    });

    if (isMyTurn) {
      div.addEventListener('click', () => {
        const curSel = gameClient.getState()._selectedTile;
        if (curSel === tile.id) {
          // 點選已選中的牌 → 確認出牌
          gameClient.playTile(tile.id);
        } else {
          gameClient.selectTile(tile.id);
          gameUI.render(gameClient.getState()); // 即時更新選中樣式
        }
      });
      div.style.cursor = 'pointer';
    }

    el.appendChild(div);
  }
}

// ── 自家花牌 & 吃碰槓 ─────────────────────
function _renderMyMeldsFlowers(state) {
  const meldsEl   = document.getElementById('my-melds-row');
  const flowersEl = document.getElementById('my-flowers-row');
  if (!meldsEl || !flowersEl) return;

  meldsEl.innerHTML = '';
  for (const meld of state.myMelds || []) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:inline-flex;gap:1px;margin-right:4px;';
    for (const t of meld) wrap.appendChild(makeTile(t, { size: 'meld' }));
    meldsEl.appendChild(wrap);
  }

  flowersEl.textContent = (state.myFlowers || []).map(f => f.name || f).join(' ');
}

// ── 對手（3 個方向）──────────────────────
function _renderOpponents(state) {
  if (!state.mySeat) return;
  const myIdx = SEATS_ORDER.indexOf(state.mySeat);

  const positions = {
    top:   SEATS_ORDER[(myIdx + 2) % 4],  // 對家
    left:  SEATS_ORDER[(myIdx + 3) % 4],  // 上家
    right: SEATS_ORDER[(myIdx + 1) % 4],  // 下家
  };

  for (const [zone, seat] of Object.entries(positions)) {
    _renderOpponent(state, zone, seat);
  }
}

function _renderOpponent(state, zone, seat) {
  const opp     = state.opponents[seat];
  const tagEl   = document.getElementById(`${zone}-tag`);
  const handEl  = document.getElementById(`${zone}-hand`);
  const meldsEl = document.getElementById(`${zone}-melds`);

  const labels = { top: '對家', left: '上家', right: '下家' };
  const name = opp?.username || '—';
  const wind = SEAT_WIND[seat] || seat;
  const tingMark = opp?.isTing ? ' 🔔' : '';
  const isTurn   = state.turnSeat === seat;

  if (tagEl) {
    tagEl.textContent = `${labels[zone]} ${name}(${wind})${tingMark}`;
    tagEl.style.color = isTurn ? '#ffd700' : '#aaffcc';
  }

  if (handEl) {
    handEl.innerHTML = '';
    const count = opp?.handCount || 0;
    const isSide = zone === 'left' || zone === 'right';
    const backSize = isSide ? 'back xs' : 'back sm';
    for (let i = 0; i < count; i++) {
      const b = document.createElement('div');
      b.className = `tile ${backSize}`;
      handEl.appendChild(b);
    }
    // 顯示花牌數量
    if (opp?.flowers?.length) {
      const fEl = document.createElement('div');
      fEl.style.cssText = 'font-size:9px;color:#88ff44;text-align:center;';
      fEl.textContent = `🌸${opp.flowers.length}`;
      handEl.appendChild(fEl);
    }
  }

  if (meldsEl) {
    meldsEl.innerHTML = '';
    for (const meld of opp?.melds || []) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:1px;margin-bottom:2px;flex-wrap:wrap;justify-content:center;';
      for (const t of meld) wrap.appendChild(makeTile(t, { size: 'meld' }));
      meldsEl.appendChild(wrap);
    }
  }
}

// ── 棄牌堆 ───────────────────────────────
function _renderPile(state) {
  const el = document.getElementById('pile-grid');
  if (!el) return;
  el.innerHTML = '';

  const pile = state.pile || [];
  // 只顯示最後 24 張（3 排 × 8）
  const show = pile.slice(-24);

  for (let i = 0; i < show.length; i++) {
    const tile  = show[i];
    const isLast = tile?.id === state.last?.id && tile?.id;
    el.appendChild(makeTile(tile, {
      size:  'pile',
      extra: isLast ? 'last' : '',
    }));
  }
}

// ── 操作按鈕 ─────────────────────────────
function _renderActionButtons(state) {
  const ids = ['hu','pong','kong','chow','pass','ting'];
  const show = new Set();

  if (state.pendingType === 'claim') {
    for (const a of state.availableActions || []) show.add(a);
    show.add('pass');
  } else if (state.pendingType === 'discard') {
    for (const a of state.availableActions || []) show.add(a);
    // 聽牌按鈕：只在有手牌且尚未聽牌時顯示
    show.add('ting');
  }

  for (const id of ids) {
    const btn = document.getElementById(`btn-${id}`);
    if (btn) btn.style.display = show.has(id) ? 'inline-block' : 'none';
  }
}

// ══════════════════════════════════════════
//  吃牌序列計算（客戶端備援）
// ══════════════════════════════════════════
function _computeChowOpts(handNames, tileName) {
  const WAN  = '一二三四五六七八九'.split('').map(c => c + '萬');
  const TONG = '一二三四五六七八九'.split('').map(c => c + '筒');
  const SUO  = '一二三四五六七八九'.split('').map(c => c + '索');
  const GROUPS = [WAN, TONG, SUO];

  const opts = [];
  for (const group of GROUPS) {
    const idx = group.indexOf(tileName);
    if (idx < 0) continue;
    // 左吃、中吃、右吃
    const patterns = [
      [idx - 2, idx - 1, idx],
      [idx - 1, idx,     idx + 1],
      [idx,     idx + 1, idx + 2],
    ];
    for (const [a, b, c] of patterns) {
      if (a < 0 || c >= group.length) continue;
      const need = [group[a], group[b], group[c]].filter(n => n !== tileName);
      if (need.every(n => handNames.includes(n))) {
        opts.push([group[a], group[b], group[c]]);
      }
    }
  }
  return opts;
}

// ── 對手名字 ─────────────────────────────
function _oppName(state, seat) {
  if (!seat) return null;
  if (seat === state.mySeat) return '你';
  return state.opponents[seat]?.username || null;
}
