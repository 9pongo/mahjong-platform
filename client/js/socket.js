// ════════════════════════════════════════
//  client/js/socket.js  —  Socket.io 連線管理
//  含斷線自動重連邏輯
// ════════════════════════════════════════
import { authManager } from './auth.js';

let _socket    = null;
let _roomId    = null;   // 記憶目前房間，斷線後重連用
let _reconnectTimer = null;

export function getSocket(tokenOverride) {
  if (_socket && _socket.connected) return _socket;

  const user = authManager.getUser();
  _socket = io({
    auth: {
      token:    tokenOverride || authManager.getToken(),
      uid:      user?.uid,
      username: user?.username,
    },
    reconnection:        true,
    reconnectionAttempts: 10,
    reconnectionDelay:    1000,
    reconnectionDelayMax: 5000,
  });

  _socket.on('connect', () => {
    console.log('Socket connected:', _socket.id);
    // 重連後自動重新加入原本的房間
    if (_roomId) {
      console.log('Reconnecting to room:', _roomId);
      _socket.emit('reconnect_room', { roomId: _roomId });
    }
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  });

  _socket.on('disconnect', (reason) => {
    console.warn('Socket disconnected:', reason);
    // 非主動斷線（不是 transport close by client）才顯示提示
    if (reason !== 'io client disconnect') {
      _showReconnectBanner(true);
    }
  });

  _socket.on('connect_error', (err) => {
    console.error('Socket error:', err.message);
    _showReconnectBanner(true);
  });

  _socket.io.on('reconnect', (attempt) => {
    console.log(`Socket reconnected after ${attempt} attempts`);
    _showReconnectBanner(false);
  });

  _socket.io.on('reconnect_failed', () => {
    console.error('Socket reconnect failed');
    _showReconnectBanner(true, true);
  });

  // 伺服器主動重啟通知（graceful shutdown）
  _socket.on('server_restart', ({ message }) => {
    _showRestartBanner(message || '伺服器重啟中，請稍後重新整理頁面');
  });

  return _socket;
}

/** 設定目前的房間 ID（由 gameClient 呼叫） */
export function setCurrentRoom(roomId) {
  _roomId = roomId;
}

/** 清除房間（遊戲結束後呼叫） */
export function clearCurrentRoom() {
  _roomId = null;
}

/** 斷線後重連至原房間（手動觸發用） */
export function reconnectRoom(roomId) {
  const s = getSocket();
  if (roomId) _roomId = roomId;
  if (_roomId) s.emit('reconnect_room', { roomId: _roomId });
}

// ── 伺服器重啟橫幅 ───────────────────────
function _showRestartBanner(msg) {
  let banner = document.getElementById('_restart_banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = '_restart_banner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:10000',
      'background:#995500', 'color:#fff', 'text-align:center',
      'padding:10px', 'font-size:13px', 'font-family:sans-serif',
      'display:flex', 'align-items:center', 'justify-content:center', 'gap:12px',
    ].join(';');
    const btn = document.createElement('button');
    btn.textContent = '立即重新整理';
    btn.style.cssText = 'background:#fff;color:#333;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px';
    btn.onclick = () => location.reload();
    banner.innerHTML = `⚠️ ${msg}`;
    banner.appendChild(btn);
    document.body.appendChild(banner);
  }
  banner.style.display = 'flex';
}

// ── 斷線提示橫幅 ─────────────────────────
function _showReconnectBanner(show, failed = false) {
  let banner = document.getElementById('_reconnect_banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = '_reconnect_banner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
      'background:#cc3300', 'color:#fff', 'text-align:center',
      'padding:8px', 'font-size:13px', 'font-family:sans-serif',
      'transition:opacity .3s',
    ].join(';');
    document.body.appendChild(banner);
  }
  if (show) {
    banner.textContent = failed
      ? '⚠️ 無法連線，請重新整理頁面'
      : '🔄 連線中斷，正在重新連接...';
    banner.style.display = 'block';
    banner.style.opacity = '1';
  } else {
    banner.textContent = '✅ 已重新連線';
    banner.style.background = '#006622';
    setTimeout(() => { banner.style.opacity = '0'; }, 1500);
    setTimeout(() => { banner.style.display = 'none'; banner.style.background = '#cc3300'; }, 1800);
  }
}
