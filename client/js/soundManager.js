// ════════════════════════════════════════
//  client/js/soundManager.js
//  Web Audio API 合成音效，無需外部音檔
//  全部聲音在第一次使用者互動後才初始化
// ════════════════════════════════════════

let _ctx = null;
let _enabled = true;

function _getCtx() {
  if (!_ctx) {
    try {
      _ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      _enabled = false;
    }
  }
  if (_ctx?.state === 'suspended') _ctx.resume();
  return _ctx;
}

/** 播放一段合成音 */
function _tone(freq, duration, type = 'sine', gain = 0.25, delay = 0) {
  if (!_enabled) return;
  const ctx = _getCtx();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const g   = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime + delay);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + delay + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + duration);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(ctx.currentTime + delay);
  osc.stop(ctx.currentTime + delay + duration + 0.01);
}

// ══════════════════════════════════════
//  公開音效
// ══════════════════════════════════════
export const soundManager = {

  /** 切換音效開關 */
  toggle() {
    _enabled = !_enabled;
    return _enabled;
  },

  isEnabled() { return _enabled; },

  /** 點選手牌 */
  tileClick() {
    _tone(1200, 0.05, 'square', 0.15);
  },

  /** 出牌（丟到棄牌堆）*/
  tilePlay() {
    _tone(800,  0.04, 'square', 0.18);
    _tone(600,  0.06, 'square', 0.10, 0.04);
  },

  /** 摸牌 */
  tileDraw() {
    _tone(1400, 0.03, 'sine', 0.12);
    _tone(1600, 0.03, 'sine', 0.08, 0.03);
  },

  /** 碰牌 */
  pong() {
    _tone(500, 0.07, 'sawtooth', 0.20);
    _tone(700, 0.07, 'sawtooth', 0.15, 0.04);
  },

  /** 槓牌 */
  kong() {
    _tone(400, 0.05, 'sawtooth', 0.22);
    _tone(560, 0.05, 'sawtooth', 0.18, 0.05);
    _tone(700, 0.07, 'sawtooth', 0.15, 0.10);
  },

  /** 吃牌 */
  chow() {
    _tone(900,  0.04, 'triangle', 0.18);
    _tone(1100, 0.04, 'triangle', 0.14, 0.05);
  },

  /** 胡牌！（小型勝利音樂） */
  hu() {
    // C4 → E4 → G4 → C5（快速上升）
    const notes = [261, 330, 392, 523, 659];
    notes.forEach((f, i) => {
      _tone(f, 0.12, 'sine', 0.22, i * 0.08);
    });
  },

  /** 流局 */
  draw() {
    _tone(440, 0.15, 'sine', 0.18);
    _tone(330, 0.20, 'sine', 0.14, 0.15);
    _tone(220, 0.25, 'sine', 0.10, 0.30);
  },

  /** 對手胡牌（低沉） */
  opponentHu() {
    _tone(200, 0.10, 'sawtooth', 0.20);
    _tone(150, 0.15, 'sawtooth', 0.15, 0.10);
  },

  /** 聊天訊息 */
  chatMsg() {
    _tone(1000, 0.03, 'sine', 0.10);
    _tone(1200, 0.03, 'sine', 0.08, 0.04);
  },

  /** 倒數警告（快到時間了） */
  countdown() {
    _tone(880, 0.04, 'square', 0.12);
  },
};
