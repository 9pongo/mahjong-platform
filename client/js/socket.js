// ════════════════════════════════════════
//  client/js/socket.js  —  Socket.io 連線管理
//  使用前需在 HTML 引入 socket.io CDN：
//  <script src="/socket.io/socket.io.js"></script>
// ════════════════════════════════════════
import { authManager } from './auth.js';

let _socket = null;

export function getSocket(tokenOverride) {
  if (_socket && _socket.connected) return _socket;

  const user = authManager.getUser();
  _socket = io({
    auth: {
      token:    tokenOverride || authManager.getToken(),
      uid:      user?.uid,
      username: user?.username,
    },
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  _socket.on('connect', () => {
    console.log('Socket connected:', _socket.id);
  });

  _socket.on('disconnect', (reason) => {
    console.warn('Socket disconnected:', reason);
  });

  _socket.on('connect_error', (err) => {
    console.error('Socket error:', err.message);
  });

  return _socket;
}

/** 斷線後重連至原房間 */
export function reconnectRoom(roomId) {
  const s = getSocket();
  s.emit('reconnect_room', { roomId });
}
