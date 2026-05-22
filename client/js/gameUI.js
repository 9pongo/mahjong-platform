// ════════════════════════════════════════
//  client/js/gameUI.js
//  DOM 渲染層 — 不含任何業務邏輯
// ════════════════════════════════════════
import { gameClient } from './gameClient.js';

const SEATS_ORDER = ['east', 'south', 'west', 'north'];
const SEAT_WIND   = { east:'東', south:'南', west:'西', north:'北' };

// ════════════════════════════════════════
//  麻將牌 — 個別 PNG 檔案
//  路徑：/images/tiles/{filename}.png
//  命名規則由美術素材規格表定義
// ════════════════════════════════════════
const _TILE_BASE = '/images/tiles/';

// 牌名（中文）→ 檔案名稱（不含 .png）
const _TILE_FILES = {
  // 萬子
  '一萬':'tile_man_1', '二萬':'tile_man_2', '三萬':'tile_man_3',
  '四萬':'tile_man_4', '五萬':'tile_man_5', '六萬':'tile_man_6',
  '七萬':'tile_man_7', '八萬':'tile_man_8', '九萬':'tile_man_9',
  // 筒子
  '一筒':'tile_circle_1', '二筒':'tile_circle_2', '三筒':'tile_circle_3',
  '四筒':'tile_circle_4', '五筒':'tile_circle_5', '六筒':'tile_circle_6',
  '七筒':'tile_circle_7', '八筒':'tile_circle_8', '九筒':'tile_circle_9',
  // 索子
  '一索':'tile_bamboo_1', '二索':'tile_bamboo_2', '三索':'tile_bamboo_3',
  '四索':'tile_bamboo_4', '五索':'tile_bamboo_5', '六索':'tile_bamboo_6',
  '七索':'tile_bamboo_7', '八索':'tile_bamboo_8', '九索':'tile_bamboo_9',
  // 風牌
  '東':'tile_wind_east', '南':'tile_wind_south', '西':'tile_wind_west', '北':'tile_wind_north',
  // 三元
  '中':'tile_dragon_zhong', '發':'tile_dragon_fa', '白':'tile_dragon_bai',
  // 花牌（1梅2蘭3竹4菊 5春6夏7秋8冬）
  '梅':'tile_flower_1', '蘭':'tile_flower_2', '竹':'tile_flower_3', '菊':'tile_flower_4',
  '春':'tile_flower_5', '夏':'tile_flower_6', '秋':'tile_flower_7', '冬':'tile_flower_8',
  // 牌背
  'back':'tile_back',
};

/** 將個別 PNG 套用到元素，回傳 true=成功 / false=無對應牌 */
function _applySprite(el, key, _sizeClass) {
  const fname = _TILE_FILES[key];
  if (!fname) return false;
  el.style.backgroundImage    = `url('${_TILE_BASE}${fname}.png')`;
  el.style.backgroundRepeat   = 'no-repeat';
  el.style.backgroundSize     = '100% 100%';
  el.style.backgroundPosition = '0 0';
  el.style.backgroundColor    = 'transparent';
  el.style.color              = 'transparent';
  return true;
}

// ── 牌色 CSS class（sprite 套用失敗時的 fallback）─
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
    _applySprite(el, 'back', size || 'hand');
    return el;
  }

  const name = typeof tile === 'string' ? tile : tile?.name;
  if (!name) {
    el.classList.add('back');
    _applySprite(el, 'back', size || 'hand');
    return el;
  }

  if (!_applySprite(el, name, size || 'hand')) {
    // fallback：文字渲染（sprite 未覆蓋時）
    el.textContent = name;
    el.classList.add(suitClass(name));
    if (['春','夏','秋','冬','梅','蘭','菊','竹'].includes(name))
      el.classList.add('suit-flower');
  }

  if (extra) el.classList.add(extra);
  if (onClick) el.addEventListener('click', onClick);
  return el;
}

// ══════════════════════════════════════════
//  主渲染入口
// ══════════════════════════════════════════
// 骰子開局動畫
let _diceShown = false;
function _showDice(d1, d2) {
  const el = document.getElementById('dice-display');
  if (!el) return;
  el.innerHTML = `
    <img src="/images/ui/dice_${d1}.png" class="dice-img">
    <img src="/images/ui/dice_${d2}.png" class="dice-img">
  `;
  el.style.display = 'flex';
  setTimeout(() => { el.style.display = 'none'; }, 2800);
}

export const gameUI = {

  render(state) {
    _renderRoomInfo(state);
    if (!state.mySeat) {
      _renderWaiting(state);
      return;
    }
    // 遊戲開始時顯示骰子一次
    if (state.phase === 'playing' && !_diceShown && state.wallLeft > 0) {
      _diceShown = true;
      const d1 = Math.ceil(Math.random() * 6);
      const d2 = Math.ceil(Math.random() * 6);
      _showDice(d1, d2);
    }
    _renderMyHand(state);
    _renderMyMeldsFlowers(state);
    _renderOpponents(state);
    _renderPile(state);
    _renderActionButtons(state);
    _renderMyStatus(state);
  },

  showKongMenu(opts) {
    // opts: string[] 牌名
    if (!opts?.length) { gameClient.declareAction('kong'); return; }
    if (opts.length === 1) { gameClient.declareAction('kong', { name: opts[0] }); return; }

    // 顯示選擇 overlay（複用 chow-overlay）
    const overlay = document.getElementById('chow-overlay');
    const optsEl  = document.getElementById('chow-opts');
    const titleEl = overlay?.querySelector('h2');
    if (!overlay || !optsEl) return;

    if (titleEl) titleEl.textContent = '選擇槓牌';
    optsEl.innerHTML = '';
    for (const name of opts) {
      const btn = document.createElement('button');
      btn.className = 'chow-opt-btn';
      btn.style.background = 'rgba(153,0,255,0.25)';
      btn.style.borderColor = '#9900ff';
      btn.textContent = `槓 ${name}`;
      btn.onclick = () => {
        overlay.classList.add('hidden');
        if (titleEl) titleEl.textContent = '選擇吃牌組合';
        gameClient.declareAction('kong', { name });
      };
      optsEl.appendChild(btn);
    }
    overlay.classList.remove('hidden');
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

    // 最後一張（剛摸的）加入場動畫
    if (isDrawn) {
      div.classList.add('anim-in');
      setTimeout(() => div.classList.remove('anim-in'), 300);
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

  // 花牌：用圖片渲染
  flowersEl.innerHTML = '';
  for (const f of state.myFlowers || []) {
    flowersEl.appendChild(makeTile(f, { size: 'meld' }));
  }
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
  const name   = opp?.username || '—';
  const wind   = SEAT_WIND[seat] || seat;
  const isTurn = state.turnSeat === seat;
  const isDealer = state.dealer === seat;
  const isAI     = opp?.isAI || false;
  const isTing   = opp?.isTing || false;

  if (tagEl) {
    const dealerIcon = isDealer
      ? `<img src="/images/ui/icon_dealer.png" style="width:14px;height:14px;vertical-align:middle;margin-right:2px">`
      : '';
    const aiIcon = isAI
      ? `<img src="/images/ui/icon_ai.png" style="width:13px;height:13px;vertical-align:middle;margin-right:2px">`
      : '';
    const tingIcon = isTing
      ? `<img src="/images/ui/icon_ting.png" style="height:13px;width:auto;vertical-align:middle;margin-left:3px">`
      : '';
    tagEl.innerHTML = `${dealerIcon}${aiIcon}${labels[zone]} ${name}(${wind})${tingIcon}`;
    tagEl.style.color = isTurn ? '#ffd700' : '#aaffcc';
  }

  if (handEl) {
    handEl.innerHTML = '';
    const count = opp?.handCount || 0;
    const isSide  = zone === 'left' || zone === 'right';
    const backSz  = isSide ? 'xs' : 'sm';
    for (let i = 0; i < count; i++) {
      handEl.appendChild(makeTile('back', { size: backSz }));
    }
    // 顯示花牌圖片（側邊用更小尺寸）
    if (opp?.flowers?.length) {
      const fWrap = document.createElement('div');
      fWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:1px;justify-content:center;margin-top:2px;';
      for (const f of opp.flowers) {
        fWrap.appendChild(makeTile(f, { size: isSide ? 'xs' : 'sm' }));
      }
      handEl.appendChild(fWrap);
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
    if (!btn) continue;
    const wasHidden = btn.style.display === 'none';
    const nowShow   = show.has(id);
    btn.style.display = nowShow ? 'inline-block' : 'none';
    // 剛出現的按鈕加入場動畫
    if (nowShow && wasHidden) {
      btn.style.animation = 'none';
      btn.offsetHeight;   // reflow
      btn.style.animation = '';
    }
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

// ── 自己狀態（莊牌 + 聽牌圖示）──────────
function _renderMyStatus(state) {
  const el = document.getElementById('my-status');
  if (!el) return;
  const isDealer = state.dealer === state.mySeat;
  const isTing   = state.isTing || false;
  el.innerHTML = [
    isDealer ? `<img src="/images/ui/icon_dealer.png" style="height:14px;width:14px">` : '',
    isTing   ? `<img src="/images/ui/icon_ting.png"   style="height:13px;width:auto">` : '',
  ].join('');
}

// ── 對手名字 ─────────────────────────────
function _oppName(state, seat) {
  if (!seat) return null;
  if (seat === state.mySeat) return '你';
  return state.opponents[seat]?.username || null;
}
