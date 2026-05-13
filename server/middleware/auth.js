// ════════════════════════════════════════
//  server/middleware/auth.js  —  JWT 驗證
// ════════════════════════════════════════
const jwt = require('jsonwebtoken');

/**
 * 驗證 Bearer token
 * 成功後將 decoded payload 掛到 req.user
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登入' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    req.uid  = req.user.uid;   // 方便直接用 req.uid
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token 無效或已過期' });
  }
}

/**
 * 驗證 Socket.io 連線的 token
 * 掛在 socket.handshake.auth.token
 */
function socketAuth(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('未登入'));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('Token 無效'));
  }
}

/**
 * VIP 等級限制 middleware（工廠函式）
 * 用法：router.get('/xxx', requireAuth, checkVip(3), handler)
 */
function checkVip(minLevel) {
  return (req, res, next) => {
    if ((req.user?.vip_level ?? 0) < minLevel) {
      return res.status(403).json({ error: `需要 VIP ${minLevel} 以上` });
    }
    next();
  };
}

/**
 * 選擇性驗證：有 token 就解析掛到 req.user，沒有也 next()
 * 用於 analytics 等允許匿名的端點
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      req.uid  = req.user.uid;
    } catch (_) { /* 無效 token 忽略 */ }
  }
  next();
}

module.exports = { requireAuth, socketAuth, checkVip, optionalAuth };
