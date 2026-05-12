// ════════════════════════════════════════
//  server/routes/admin.js
//  管理後台 API（需 ADMIN_KEY 環境變數）
//  所有路由加 requireAdmin middleware
// ════════════════════════════════════════
const router   = require('express').Router();
const https    = require('https');
const http     = require('http');
const supabase = require('../models/supabase');
const logger   = require('../utils/logger');

// ── 告警推播工具 ─────────────────────────

/** 發送 Discord Webhook */
function notifyDiscord(message) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const parsed  = new URL(url);
      const body    = JSON.stringify({ content: message });
      const lib     = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        res.resume();
        resolve({ ok: res.statusCode < 300 });
      });
      req.on('error', (e) => { logger.warn('Discord notify error: ' + e.message); resolve({ ok: false }); });
      req.write(body);
      req.end();
    } catch (e) {
      logger.warn('Discord notify error: ' + e.message);
      resolve({ ok: false });
    }
  });
}

/** 發送 LINE Notify */
function notifyLine(message) {
  const token = process.env.LINE_NOTIFY_TOKEN;
  if (!token) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const body = `message=${encodeURIComponent(message)}`;
      const req = https.request({
        hostname: 'notify-api.line.me',
        path: '/api/notify',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'Authorization': `Bearer ${token}`,
        },
      }, (res) => {
        res.resume();
        resolve({ ok: res.statusCode === 200 });
      });
      req.on('error', (e) => { logger.warn('LINE notify error: ' + e.message); resolve({ ok: false }); });
      req.write(body);
      req.end();
    } catch (e) {
      logger.warn('LINE notify error: ' + e.message);
      resolve({ ok: false });
    }
  });
}

/** 同時推播 Discord + LINE（fire-and-forget 不等待） */
function pushAlert(message) {
  notifyDiscord(message).catch(() => {});
  notifyLine(message).catch(() => {});
}

// ── 管理員驗證 middleware ─────────────────
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: '禁止訪問' });
  }
  next();
}

// ══════════════════════════════════════
//  系統概覽
// ══════════════════════════════════════

// GET /api/admin/stats
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const [usersRes, gamesRes, coinsRes] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('game_records').select('*', { count: 'exact', head: true }),
      supabase.from('coin_ledger')
        .select('delta')
        .gt('delta', 0)
        .gte('created_at', new Date(Date.now() - 86400000).toISOString()),
    ]);

    const totalCoinsIn = (coinsRes.data || []).reduce((s, r) => s + Number(r.delta), 0);

    res.json({
      totalUsers:  usersRes.count  || 0,
      totalGames:  gamesRes.count  || 0,
      coinsIn24h:  totalCoinsIn,
      serverTime:  new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  玩家管理
// ══════════════════════════════════════

// GET /api/admin/users?q=搜尋字串&limit=20
router.get('/users', requireAdmin, async (req, res) => {
  const q     = req.query.q     || '';
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const page  = Math.max(parseInt(req.query.page)  || 0, 0);

  let query = supabase.from('users')
    .select('uid, username, coins, vip_level, game_level, is_banned, created_at')
    .order('created_at', { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);

  if (q) query = query.ilike('username', `%${q}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data || [] });
});

// GET /api/admin/user/:uid  — 玩家詳情 + 流水帳
router.get('/user/:uid', requireAdmin, async (req, res) => {
  const { uid } = req.params;

  const [userRes, ledgerRes, gamesRes] = await Promise.all([
    supabase.from('users')
      .select('*').eq('uid', uid).maybeSingle(),
    supabase.from('coin_ledger')
      .select('delta, reason, balance, created_at')
      .eq('uid', uid)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase.from('game_records')
      .select('win_lose_coins, result, played_at')
      .eq('uid', uid)
      .order('played_at', { ascending: false })
      .limit(20),
  ]);

  if (!userRes.data) return res.status(404).json({ error: '找不到用戶' });
  res.json({
    user:    userRes.data,
    ledger:  ledgerRes.data  || [],
    games:   gamesRes.data   || [],
  });
});

// POST /api/admin/user/:uid/ban  — 封禁/解封
router.post('/user/:uid/ban', requireAdmin, async (req, res) => {
  const { uid } = req.params;
  const { ban = true, reason = '違規' } = req.body;

  const { error } = await supabase.from('users')
    .update({ is_banned: ban }).eq('uid', uid);
  if (error) return res.status(500).json({ error: error.message });

  logger.info(`Admin ${ban ? 'ban' : 'unban'} uid=${uid} reason="${reason}"`);
  res.json({ ok: true, uid, banned: ban });
});

// POST /api/admin/user/:uid/coins  — 手動調整金幣
router.post('/user/:uid/coins', requireAdmin, async (req, res) => {
  const { uid } = req.params;
  const { delta, reason = 'admin_adjust' } = req.body;

  if (typeof delta !== 'number') return res.status(400).json({ error: '缺少 delta' });

  const { updateCoins } = require('../services/coinService');
  const result = await updateCoins(uid, delta, reason);
  if (!result.ok) return res.status(400).json({ error: result.error });

  logger.info(`Admin coin adjust uid=${uid} delta=${delta} reason="${reason}"`);
  res.json({ ok: true, newBalance: result.newBalance });
});

// ══════════════════════════════════════
//  流水帳查詢
// ══════════════════════════════════════

// GET /api/admin/ledger?limit=50&reason=shop_coins_1
router.get('/ledger', requireAdmin, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const reason = req.query.reason || null;

  let query = supabase.from('coin_ledger')
    .select('uid, delta, reason, balance, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (reason) query = query.eq('reason', reason);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ledger: data || [] });
});

// ══════════════════════════════════════
//  告警 Webhook（Railway / UptimeRobot 呼叫）
// ══════════════════════════════════════

// POST /api/admin/alert  — 接收外部告警並推播
router.post('/alert', requireAdmin, async (req, res) => {
  const { type = 'unknown', message = '', source = '' } = req.body;
  const ts  = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const txt = `🚨 [麻將平台] ${ts}\n來源: ${source}\n類型: ${type}\n${message}`;

  logger.error(`🚨 ALERT [${source}/${type}]: ${message}`);
  pushAlert(txt);

  res.json({ ok: true, received: true });
});

// GET /api/admin/notify/test  — 測試推播是否設定正確
router.get('/notify/test', requireAdmin, async (req, res) => {
  const msg = `✅ 麻將平台告警測試\n時間: ${new Date().toISOString()}\n推播設定正常！`;
  const [discord, line] = await Promise.all([
    notifyDiscord(msg),
    notifyLine(msg),
  ]);
  res.json({
    ok: true,
    discord: !!process.env.DISCORD_WEBHOOK_URL,
    discordSent: discord?.ok,
    line:    !!process.env.LINE_NOTIFY_TOKEN,
    lineSent: line?.ok,
  });
});

// ══════════════════════════════════════
//  公告管理
// ══════════════════════════════════════

// GET /api/admin/announcements  — 列出（含已關閉）
router.get('/announcements', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ announcements: data || [] });
});

// POST /api/admin/announcements  — 建立公告
router.post('/announcements', requireAdmin, async (req, res) => {
  const { title, content = '', type = 'info', pinned = false, expires_at } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: '標題必填' });
  const { data, error } = await supabase.from('announcements').insert({
    title: title.trim(), content: content.trim(), type, pinned,
    active: true,
    expires_at: expires_at || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  logger.info(`Admin created announcement: ${title}`);
  res.json({ ok: true, announcement: data });
});

// PATCH /api/admin/announcements/:id  — 修改 / 下架
router.patch('/announcements/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { title, content, type, pinned, active, expires_at } = req.body;
  const updates = {};
  if (title    !== undefined) updates.title    = title;
  if (content  !== undefined) updates.content  = content;
  if (type     !== undefined) updates.type     = type;
  if (pinned   !== undefined) updates.pinned   = pinned;
  if (active   !== undefined) updates.active   = active;
  if (expires_at !== undefined) updates.expires_at = expires_at;
  const { error } = await supabase.from('announcements').update(updates).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// DELETE /api/admin/announcements/:id  — 刪除
router.delete('/announcements/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('announcements').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
