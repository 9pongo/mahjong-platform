// ════════════════════════════════════════
//  server/index.js  —  Server 入口點
// ════════════════════════════════════════
require('dotenv').config();

// ── 環境變數嚴格驗證 ────────────────────
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'];
REQUIRED_ENV.forEach(k => {
  if (!process.env[k]) console.warn(`⚠️  WARNING: ${k} is not set!`);
});

const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const cors         = require('cors');
const path         = require('path');
const helmet       = require('helmet');
const compression  = require('compression');
const rateLimit    = require('express-rate-limit');
const logger       = require('./utils/logger');
const sentry       = require('./utils/sentry');

// ── Express 初始化 ───────────────────────
const app    = express();
const server = http.createServer(app);

// ── Socket.io 初始化 ─────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout:  20000,
  pingInterval: 10000,
  // 斷線重連容忍：保留 socket 事件 30 秒
  connectionStateRecovery: {
    maxDisconnectionDuration: 30000,
    skipMiddlewares: true,
  },
});

app.set('io', io);

// ══════════════════════════════════════
//  Middleware 堆疊
// ══════════════════════════════════════

// ① 安全標頭（helmet）
app.use(helmet({
  contentSecurityPolicy: false,   // 靜態 SPA 不需嚴格 CSP
  crossOriginEmbedderPolicy: false,
}));

// ② Gzip 壓縮（靜態資源 & API 回應）
app.use(compression());

// ③ CORS
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));

// ④ Body Parser（限制 50kb 防 DoS）
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

// ⑤ 靜態檔案（Cache-Control 1h）
app.use(express.static(path.join(__dirname, '../client'), {
  maxAge: '1h',
  etag:   true,
}));

// ⑥ Request Logger（跳過靜態資源與健康檢查）
app.use((req, _res, next) => {
  if (!req.url.startsWith('/api/health') && !req.url.match(/\.(js|css|html|png|ico|json|woff)$/)) {
    logger.info(`${req.method} ${req.url}`);
  }
  next();
});

// ⑦ Rate Limiting
// 全域：每 15 分鐘 300 次
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '請求過於頻繁，請稍後再試' },
});
// 認證路由：每 15 分鐘 20 次（防暴力破解）
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: '登入嘗試過於頻繁，請 15 分鐘後再試' },
});
// 充值路由：每小時 10 次
const monetizeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: '操作過於頻繁' },
});

app.use('/api/', globalLimiter);

// ══════════════════════════════════════
//  API 路由
// ══════════════════════════════════════
const authRouter        = require('./routes/auth');
const userRouter        = require('./routes/user');
const roomRouter        = require('./routes/room');
const rewardRouter      = require('./routes/reward');
const questRouter       = require('./routes/quest');
const friendRouter      = require('./routes/friend');
const guildRouter       = require('./routes/guild');
const shopRouter        = require('./routes/shop');
const dojoRouter        = require('./routes/dojo');
const leaderboardRouter = require('./routes/leaderboard');
const rankRouter        = require('./routes/rank');
const monetizeRouter    = require('./routes/monetize');
const adminRouter       = require('./routes/admin');
const pushRouter        = require('./routes/push');
const tournamentRouter  = require('./routes/tournament');
const analyticsRouter   = require('./routes/analytics');

app.use('/api/auth',        authLimiter, authRouter);
app.use('/api/user',        userRouter);
app.use('/api/room',        roomRouter);
app.use('/api/reward',      rewardRouter);
app.use('/api/quest',       questRouter);
app.use('/api/friend',      friendRouter);
app.use('/api/guild',       guildRouter);
app.use('/api/shop',        shopRouter);
app.use('/api/dojo',        dojoRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/rank',        rankRouter);
app.use('/api/monetize',    monetizeLimiter, monetizeRouter);
app.use('/api/admin',       adminRouter);
app.use('/api/push',        pushRouter);
app.use('/api/tournament',  tournamentRouter);
app.use('/api/analytics',   analyticsRouter);

// ── 強化版健康檢查 ────────────────────────
app.get('/api/health', async (_req, res) => {
  const mem   = process.memoryUsage();
  let dbOk    = false;
  let dbMs    = 0;
  try {
    const t0 = Date.now();
    const supabase = require('./models/supabase');
    await supabase.from('users').select('uid').limit(1);
    dbMs = Date.now() - t0;
    dbOk = true;
  } catch {}

  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  const status = dbOk && heapMB < 400 ? 'ok' : 'degraded';

  res.status(status === 'ok' ? 200 : 503).json({
    status,
    ts:         Date.now(),
    uptime:     Math.round(process.uptime()),
    heap_mb:    heapMB,
    rss_mb:     Math.round(mem.rss / 1024 / 1024),
    db:         dbOk ? `ok (${dbMs}ms)` : 'error',
    rooms:      require('./socket/roomManager').getAllRooms().length,
    sockets:    io.engine.clientsCount,
  });
});

// ── 前端錯誤回報（來自 errorHandler.js） ──
app.post('/api/client-error', (req, res) => {
  const { type, message, url, ua, stack } = req.body || {};
  if (message) {
    logger.warn(`[ClientError] ${type || 'Unknown'}: ${message} | url=${url}`);
    // 觸發 Sentry（若啟用）
    sentry.captureMessage(`[Browser] ${type}: ${message}`, 'error');
  }
  res.sendStatus(204);   // 不回傳任何內容
});

// ── 公告 ──────────────────────────────────
app.get('/api/announcements', async (_req, res) => {
  const supabase = require('./models/supabase');
  const { data, error } = await supabase
    .from('announcements')
    .select('id, title, content, type, pinned, created_at, expires_at')
    .eq('active', true)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return res.status(500).json({ error: error.message });

  const now   = Date.now();
  const valid = (data || []).filter(a =>
    !a.expires_at || new Date(a.expires_at).getTime() > now
  ).slice(0, 10);
  res.json({ announcements: valid });
});

// ── 全域錯誤處理（最後一道防線） ────────
// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});
// Sentry error handler（需在 404 之後、500 之前）
app.use(sentry.errorHandler);
// 500（Express 同步錯誤）
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error('Unhandled Express error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ══════════════════════════════════════
//  Socket.io 事件
// ══════════════════════════════════════
const { registerGameSocket } = require('./socket/gameSocket');
const { registerChatSocket } = require('./socket/chatSocket');

function broadcastOnlineCount() {
  io.emit('online_count', { count: io.engine.clientsCount });
}

io.on('connection', socket => {
  logger.info(`Socket connected: ${socket.id}`);
  registerGameSocket(io, socket);
  registerChatSocket(io, socket);
  broadcastOnlineCount();

  socket.on('disconnect', reason => {
    logger.info(`Socket disconnected: ${socket.id} (${reason})`);
    broadcastOnlineCount();
  });
});

// ══════════════════════════════════════
//  Cron 定時任務
// ══════════════════════════════════════
const { startCronJobs } = require('./utils/cronJobs');
startCronJobs();

// ══════════════════════════════════════
//  啟動
// ══════════════════════════════════════
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`🀄 Mahjong Platform listening on port ${PORT}`);
});

// ══════════════════════════════════════
//  Graceful Shutdown（Railway SIGTERM）
// ══════════════════════════════════════
function gracefulShutdown(signal) {
  logger.info(`${signal} received — graceful shutdown`);

  // 停止接受新連線
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  // 通知所有 Socket 客戶端即將重啟
  io.emit('server_restart', { message: '伺服器重啟中，請稍後重新整理頁面' });

  // 30 秒後強制結束（避免卡住）
  setTimeout(() => {
    logger.warn('Forced exit after 30s');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// 捕捉未處理的 Promise 拒絕（防止無聲 crash）
process.on('unhandledRejection', (reason, promise) => {
  logger.error('UnhandledRejection:', { reason: String(reason), promise: String(promise) });
});
process.on('uncaughtException', (err) => {
  logger.error('UncaughtException:', err);
  // 讓 Railway 重啟：不要 process.exit，讓 graceful shutdown 接管
  gracefulShutdown('uncaughtException');
});

module.exports = { app, io };
