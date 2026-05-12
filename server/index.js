// ════════════════════════════════════════
//  server/index.js  —  Server 入口點
// ════════════════════════════════════════
require('dotenv').config();

// 必填環境變數檢查（比 check-env.js 更輕量，不 exit 而是印警告）
['SUPABASE_URL','SUPABASE_SERVICE_KEY','JWT_SECRET'].forEach(k => {
  if (!process.env[k]) console.warn(`⚠️  WARNING: ${k} is not set!`);
});

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const path       = require('path');
const logger     = require('./utils/logger');

// ── Express 初始化 ───────────────────────
const app    = express();
const server = http.createServer(app);

// ── Socket.io 初始化 ─────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || '*',
    methods: ['GET','POST'],
  },
  pingTimeout: 20000,
  pingInterval: 10000,
});

// ── Middleware ──────────────────────────
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// 靜態檔案（client 資料夾）
app.use(express.static(path.join(__dirname, '../client')));

// 簡易請求日誌
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// ── API 路由 ────────────────────────────
const authRouter   = require('./routes/auth');
const userRouter   = require('./routes/user');
const roomRouter   = require('./routes/room');
const rewardRouter = require('./routes/reward');
const questRouter  = require('./routes/quest');
const friendRouter = require('./routes/friend');
const guildRouter  = require('./routes/guild');
const shopRouter   = require('./routes/shop');
const dojoRouter        = require('./routes/dojo');
const leaderboardRouter = require('./routes/leaderboard');
const adminRouter       = require('./routes/admin');

app.use('/api/auth',        authRouter);
app.use('/api/user',        userRouter);
app.use('/api/room',        roomRouter);
app.use('/api/reward',      rewardRouter);
app.use('/api/quest',       questRouter);
app.use('/api/friend',      friendRouter);
app.use('/api/guild',       guildRouter);
app.use('/api/shop',        shopRouter);
app.use('/api/dojo',        dojoRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/admin',       adminRouter);

// 健康檢查
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Socket.io 事件 ──────────────────────
const { registerGameSocket } = require('./socket/gameSocket');
const { registerChatSocket } = require('./socket/chatSocket');

io.on('connection', socket => {
  logger.info(`Socket connected: ${socket.id}`);
  registerGameSocket(io, socket);
  registerChatSocket(io, socket);

  socket.on('disconnect', reason => {
    logger.info(`Socket disconnected: ${socket.id} (${reason})`);
  });
});

// ── Cron 定時任務 ────────────────────────
const { startCronJobs } = require('./utils/cronJobs');
startCronJobs();

// ── 啟動 ────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`🀄 Mahjong Platform listening on port ${PORT}`);
});

module.exports = { app, io };
