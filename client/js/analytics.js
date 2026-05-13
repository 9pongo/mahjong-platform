// ════════════════════════════════════════
//  client/js/analytics.js
//  輕量行為埋點客戶端
//  - 自動批次送出（最多 20 條 / 5 秒 flush）
//  - 頁面離開前強制 flush（sendBeacon）
//  - 失敗靜默，不影響主功能
// ════════════════════════════════════════

const SESSION_KEY = 'mj_sid';

// 產生 / 取得 session_id（Tab 層級，關掉 Tab 就重置）
function getSessionId() {
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

const SESSION_ID = getSessionId();

let _queue   = [];   // 待送事件
let _timer   = null; // flush 計時器
let _token   = null; // JWT（由 setToken() 設定）

const FLUSH_INTERVAL = 5000;  // 5 秒批次送出
const MAX_QUEUE      = 15;    // 超過此數立即 flush

/** 設定 JWT token（由 authManager 呼叫） */
function setToken(t) { _token = t; }

/** 核心：追蹤一個事件 */
function track(name, props = {}) {
  _queue.push({
    name,
    props,
    page: location.pathname + location.search,
  });
  if (_queue.length >= MAX_QUEUE) {
    flush();
  } else if (!_timer) {
    _timer = setTimeout(flush, FLUSH_INTERVAL);
  }
}

/** 立即送出所有佇列中的事件 */
async function flush() {
  clearTimeout(_timer);
  _timer = null;
  if (!_queue.length) return;
  const events = _queue.splice(0, _queue.length);

  const body = JSON.stringify({ events, session_id: SESSION_ID });
  const headers = { 'Content-Type': 'application/json' };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  try {
    await fetch('/api/analytics/batch', { method: 'POST', headers, body });
  } catch (_) { /* 埋點失敗靜默 */ }
}

/** 頁面關閉前用 sendBeacon 送出（不保證 100% 成功，但比 fetch 更可靠） */
function flushBeacon() {
  if (!_queue.length) return;
  const body = JSON.stringify({ events: _queue, session_id: SESSION_ID });
  navigator.sendBeacon?.('/api/analytics/batch', new Blob([body], { type: 'application/json' }));
  _queue = [];
}

// ── 頁面通用自動追蹤 ─────────────────────

/** 自動追蹤頁面瀏覽 */
function autoPageView() {
  track('page_view', { path: location.pathname });
}

/** 自動追蹤按鈕點擊（透過 data-track 屬性） */
function autoClickTracking() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-track]');
    if (!el) return;
    track('click', { label: el.dataset.track, text: el.textContent.trim().slice(0, 50) });
  }, { passive: true });
}

// 頁面卸載前 flush
window.addEventListener('pagehide',    flushBeacon, { passive: true });
window.addEventListener('beforeunload', flushBeacon);

// ── 預定義業務事件 ────────────────────────
const analytics = {
  setToken,
  track,
  flush,

  // 頁面瀏覽
  pageView: (extra = {}) => track('page_view', { path: location.pathname, ...extra }),

  // 玩家行為
  login:        (method = 'guest') => track('login',        { method }),
  register:     (method = 'guest') => track('register',     { method }),
  quickJoin:    (betKey, roomType) => track('quick_join',    { betKey, roomType }),
  gameStart:    (roomId, betKey)   => track('game_start',    { roomId, betKey }),
  gameEnd:      (result, coins)    => track('game_end',      { result, coins }),
  soloStart:    ()                 => track('solo_start',    {}),

  // 商城 & 金幣
  shopView:     ()                 => track('shop_view',     {}),
  purchaseClick:(itemId, price)    => track('purchase_click', { itemId, price }),

  // 賽事
  tournamentView:     ()           => track('tournament_view', {}),
  tournamentRegister: (id, fee)    => track('tournament_register', { id, fee }),

  // 推播
  pushSubscribe:   ()              => track('push_subscribe',   {}),
  pushUnsubscribe: ()              => track('push_unsubscribe',  {}),

  // 社交
  friendRequest:   ()              => track('friend_request',   {}),
  guildJoin:       ()              => track('guild_join',        {}),

  // 初始化（自動追蹤頁面瀏覽 + 點擊）
  init(token) {
    if (token) setToken(token);
    autoPageView();
    autoClickTracking();
  },
};

export default analytics;
