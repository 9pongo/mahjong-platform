// ════════════════════════════════════════
//  server/routes/user.js
// ════════════════════════════════════════
const router   = require('express').Router();
const supabase = require('../models/supabase');
const { requireAuth } = require('../middleware/auth');
const { validate, sanitize } = require('../middleware/validate');

// GET /api/user/profile
router.get('/profile', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('uid', req.user.uid)
    .single();
  if (error) return res.status(404).json({ error: '找不到用戶' });
  const { password_hash, reset_token, reset_token_exp, ...safeUser } = data;
  res.json(safeUser);
});

// PUT /api/user/profile
router.put('/profile', requireAuth,
  sanitize('username', 'bio'),
  validate({ username: 'optional:string|2-16' }),
  async (req, res) => {
    const { username, avatar_url } = req.body;
    const updates = {};
    if (username)   updates.username   = username;
    if (avatar_url) updates.avatar_url = avatar_url;
    const { error } = await supabase.from('users').update(updates).eq('uid', req.user.uid);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  }
);

// GET /api/user/vip-info
router.get('/vip-info', requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('users')
    .select('vip_level,v_points')
    .eq('uid', req.user.uid)
    .single();
  const { VIP_LEVELS } = require('../../shared/constants');
  const cur  = VIP_LEVELS.find(v => v.level === data.vip_level) || VIP_LEVELS[0];
  const next = VIP_LEVELS.find(v => v.level === data.vip_level + 1);
  res.json({ ...data, current: cur, next: next || null });
});

// GET /api/user/stats  — 勝率、胡牌率等戰力圖
router.get('/stats', requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('game_records')
    .select('win_lose_coins,hu_count,zimo_count,fangqiang_count,played_at')
    .eq('uid', req.user.uid)
    .order('played_at', { ascending: false })
    .limit(100);

  if (!data || data.length === 0) return res.json({ message: '尚無戰績' });

  const wins     = data.filter(r => r.win_lose_coins > 0).length;
  const hu       = data.reduce((s, r) => s + (r.hu_count || 0), 0);
  const zimo     = data.reduce((s, r) => s + (r.zimo_count || 0), 0);
  const fangqiang= data.reduce((s, r) => s + (r.fangqiang_count || 0), 0);

  res.json({
    games:       data.length,
    win_rate:    ((wins / data.length) * 100).toFixed(1) + '%',
    hu_rate:     ((hu / data.length) * 100).toFixed(1) + '%',
    zimo_rate:   ((zimo / data.length) * 100).toFixed(1) + '%',
    fangqiang_rate: ((fangqiang / data.length) * 100).toFixed(1) + '%',
    recent:      data.slice(0, 10),
  });
});

// GET /api/user/history?page=0&limit=20  — 遊戲歷史記錄
router.get('/history', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const page  = Math.max(parseInt(req.query.page)  ||  0,  0);

  const { data, error, count } = await supabase
    .from('game_records')
    .select('id,room_type,bet_key,win_lose_coins,result,hu_count,zimo_count,fangqiang_count,played_at', { count: 'exact' })
    .eq('uid', req.user.uid)
    .order('played_at', { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ records: data || [], total: count || 0, page, limit });
});

// GET /api/user/search?q=username  — 搜尋玩家（用於加好友）
router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ users: [] });

  const { data, error } = await supabase
    .from('users')
    .select('uid, username, vip_level, game_level, avatar_url')
    .ilike('username', `%${q}%`)
    .neq('uid', req.user.uid)   // 排除自己
    .limit(10);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data || [] });
});

// GET /api/user/public/:uid  — 公開玩家資料（任何人可查）
router.get('/public/:uid', async (req, res) => {
  const { uid } = req.params;

  const [userRes, statsRes, achRes] = await Promise.all([
    supabase.from('users')
      .select('uid, username, vip_level, game_level, avatar_url, created_at')
      .eq('uid', uid).maybeSingle(),
    supabase.from('game_records')
      .select('win_lose_coins, hu_count, zimo_count')
      .eq('uid', uid)
      .order('played_at', { ascending: false })
      .limit(200),
    supabase.from('user_achievements')
      .select('achievement', { count: 'exact', head: true })
      .eq('uid', uid),
  ]);

  if (!userRes.data) return res.status(404).json({ error: '找不到玩家' });

  const records = statsRes.data || [];
  const games   = records.length;
  const wins    = records.filter(r => r.win_lose_coins > 0).length;

  res.json({
    ...userRes.data,
    games,
    wins,
    winRate:   games ? ((wins / games) * 100).toFixed(1) + '%' : '—',
    achCount:  achRes.count || 0,
  });
});

// GET /api/user/achievements  — 取得玩家成就清單（含未解鎖）
router.get('/achievements', requireAuth, async (req, res) => {
  const { getUserAchievements } = require('../services/achievementService');
  const list = await getUserAchievements(req.user.uid);
  res.json({ achievements: list });
});

// POST /api/user/avatar  — 上傳頭像（base64 → Supabase Storage）
router.post('/avatar', requireAuth, async (req, res) => {
  const { imageData } = req.body;   // 'data:image/jpeg;base64,...'
  if (!imageData) return res.status(400).json({ error: '缺少 imageData' });

  // 解析 Base64 頭部
  const match = imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!match) return res.status(400).json({ error: '格式錯誤，需要 JPEG/PNG/WebP base64' });

  const mimeType  = match[1];
  const ext       = mimeType.split('/')[1].replace('jpeg', 'jpg');
  const buffer    = Buffer.from(match[2], 'base64');

  // 限制大小 500 KB
  if (buffer.length > 512000) return res.status(400).json({ error: '圖片超過 500 KB' });

  const uid      = req.user.uid;
  const filePath = `${uid}.${ext}`;

  try {
    // 上傳到 Supabase Storage（service_role 可略過 RLS）
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(filePath, buffer, { contentType: mimeType, upsert: true });

    if (upErr) return res.status(500).json({ error: upErr.message });

    // 取得公開 URL
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    // 更新 users 表
    await supabase.from('users').update({ avatar_url: publicUrl }).eq('uid', uid);

    res.json({ ok: true, avatarUrl: publicUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/user/social-links ─────────────
// 更新社群媒體連結（FB / IG / LINE）
router.put('/social-links', requireAuth, async (req, res) => {
  const {
    social_fb, social_ig, social_line,
    social_fb_public, social_ig_public, social_line_public,
  } = req.body;

  // 簡單 URL 格式檢查（允許空字串 = 清除）
  const urlOk = (v) => !v || typeof v === 'string' && v.length <= 200;
  if (!urlOk(social_fb) || !urlOk(social_ig) || !urlOk(social_line))
    return res.status(400).json({ error: '連結格式錯誤' });

  const updates = {
    social_fb:          social_fb  || null,
    social_ig:          social_ig  || null,
    social_line:        social_line || null,
    social_fb_public:   !!social_fb_public,
    social_ig_public:   !!social_ig_public,
    social_line_public: !!social_line_public,
  };

  const { error } = await supabase.from('users').update(updates).eq('uid', req.user.uid);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── GET /api/user/social-links ─────────────
// 取得自己的社群連結（包含私有資訊）
router.get('/social-links', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('social_fb,social_ig,social_line,social_fb_public,social_ig_public,social_line_public')
    .eq('uid', req.user.uid)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── POST /api/user/delete-account ──────────
// 申請帳號刪除（軟刪除：90 天保留期後清除）
router.post('/delete-account', requireAuth, async (req, res) => {
  const { confirm } = req.body;
  if (confirm !== 'DELETE') return res.status(400).json({ error: '請輸入 DELETE 確認刪除' });

  const uid = req.user.uid;

  // 確認帳號未已處於刪除狀態
  const { data: user } = await supabase
    .from('users')
    .select('status, coins, username')
    .eq('uid', uid)
    .single();

  if (!user) return res.status(404).json({ error: '找不到帳號' });
  if (user.status === 'deleted') return res.status(400).json({ error: '帳號已在刪除流程中' });

  const scheduledAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 天後

  // 記錄刪除申請
  await supabase.from('account_deletions').insert({
    uid,
    requested_at: new Date().toISOString(),
    scheduled_purge_at: scheduledAt,
    coins_at_request: user.coins || 0,
    username_at_request: user.username,
  });

  // 軟刪除：解除手機綁定（可被其他帳號使用），標記狀態
  const { error } = await supabase
    .from('users')
    .update({
      status: 'deleted',
      phone: null,
      phone_verified: false,
    })
    .eq('uid', uid);

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    ok: true,
    message: `帳號已申請刪除，將於 90 天後（${scheduledAt.slice(0,10)}）永久清除。期間可聯繫客服取消。`,
    scheduled_purge_at: scheduledAt,
  });
});

module.exports = router;
