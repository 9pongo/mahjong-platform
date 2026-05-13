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
  try {
    const { error } = await supabase.from('announcements').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/announcements/:id/delete  — 同功能，相容 DELETE 被攔截的情況
router.post('/announcements/:id/delete', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('announcements').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  日報 / 運營統計
// ══════════════════════════════════════

// GET /api/admin/daily-report  — 今日/昨日關鍵數字
router.get('/daily-report', requireAdmin, async (req, res) => {
  try {
    const now      = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const todayStart = `${todayStr}T00:00:00.000Z`;
    const yesterday  = new Date(now - 86400000).toISOString().slice(0, 10);
    const yestStart  = `${yesterday}T00:00:00.000Z`;

    const [
      dauRes, newUsersRes, gamesRes,
      yestDauRes, yestGamesRes,
      passRes, referralRes,
    ] = await Promise.all([
      // 今日活躍（有遊戲記錄的不重複 uid）
      supabase.from('game_records').select('uid').gte('played_at', todayStart),
      // 今日新用戶
      supabase.from('users').select('uid', { count: 'exact', head: true }).gte('created_at', todayStart),
      // 今日對局數
      supabase.from('game_records').select('*', { count: 'exact', head: true }).gte('played_at', todayStart),
      // 昨日活躍
      supabase.from('game_records').select('uid').gte('played_at', yestStart).lt('played_at', todayStart),
      // 昨日對局
      supabase.from('game_records').select('*', { count: 'exact', head: true }).gte('played_at', yestStart).lt('played_at', todayStart),
      // 有效月卡數
      supabase.from('monthly_passes').select('*', { count: 'exact', head: true }).gt('expires_at', now.toISOString()),
      // 今日新推薦
      supabase.from('referrals').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
    ]);

    const dau      = new Set((dauRes.data  || []).map(r => r.uid)).size;
    const yestDau  = new Set((yestDauRes.data || []).map(r => r.uid)).size;

    res.json({
      date:           todayStr,
      dau,
      dau_change:     dau - yestDau,
      new_users:      newUsersRes.count || 0,
      games_today:    gamesRes.count    || 0,
      games_yesterday: yestGamesRes.count || 0,
      active_passes:  passRes.count     || 0,
      referrals_today: referralRes.count || 0,
      generated_at:   now.toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/analytics/top-events  — 今日前 10 大事件
router.get('/analytics/top-events', requireAdmin, async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('analytics_events')
      .select('event_name')
      .gte('ts', todayStart.toISOString());

    if (error) return res.status(500).json({ error: error.message });

    // 統計次數
    const counts = {};
    for (const row of data || []) {
      counts[row.event_name] = (counts[row.event_name] || 0) + 1;
    }
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    res.json({ top, total: (data || []).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/event  — 建立限時活動
router.post('/event', requireAdmin, async (req, res) => {
  try {
    const { createEvent } = require('../services/eventService');
    const ev = await createEvent(req.body);
    res.json({ ok: true, event: ev });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/admin/event/:id  — 結束活動
router.delete('/event/:id', requireAdmin, async (req, res) => {
  try {
    const { endEvent } = require('../services/eventService');
    await endEvent(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/event/:id/end  — 同功能，相容 DELETE 被攔截的情況
router.post('/event/:id/end', requireAdmin, async (req, res) => {
  try {
    const { endEvent } = require('../services/eventService');
    await endEvent(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/event/:id/delete  — 刪除活動（相容 Railway 攔截 DELETE）
router.post('/event/:id/delete', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('events').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/events  — 列出所有活動（含過期）
router.get('/events', requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase
      .from('events')
      .select('*')
      .order('starts_at', { ascending: false })
      .limit(30);
    res.json({ events: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  賽事管理
// ══════════════════════════════════════

// GET /api/admin/tournaments
router.get('/tournaments', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('tournaments').select('*').order('starts_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ tournaments: data });
});

// POST /api/admin/tournaments — 建立賽事
router.post('/tournaments', requireAdmin, async (req, res) => {
  const { name, description = '', type = 'special',
          entry_fee = 0, prize_pool = 0, max_players = 100,
          starts_at, ends_at } = req.body;
  if (!name?.trim())  return res.status(400).json({ error: '名稱必填' });
  if (!starts_at || !ends_at) return res.status(400).json({ error: '時間必填' });

  const { data, error } = await supabase.from('tournaments').insert({
    name: name.trim(), description, type,
    entry_fee: Number(entry_fee), prize_pool: Number(prize_pool),
    max_players: Number(max_players),
    starts_at, ends_at,
    status: new Date(starts_at) <= new Date() ? 'active' : 'upcoming',
  }).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, tournament: data });
});

// POST /api/admin/tournaments/:id/edit
router.post('/tournaments/:id/edit', requireAdmin, async (req, res) => {
  const fields = {};
  const allow = ['name','description','type','entry_fee','prize_pool','max_players','starts_at','ends_at','status'];
  for (const k of allow) { if (req.body[k] !== undefined) fields[k] = req.body[k]; }
  const { error } = await supabase.from('tournaments').update(fields).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// POST /api/admin/tournaments/:id/delete
router.post('/tournaments/:id/delete', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('tournaments').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// POST /api/admin/tournaments/:id/close — 手動強制結算
router.post('/tournaments/:id/close', requireAdmin, async (req, res) => {
  try {
    const { closeTournament } = require('../services/tournamentService');
    await closeTournament(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
