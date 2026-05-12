// ════════════════════════════════════════
//  server/routes/user.js
// ════════════════════════════════════════
const router   = require('express').Router();
const supabase = require('../models/supabase');
const { requireAuth } = require('../middleware/auth');

// GET /api/user/profile
router.get('/profile', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('uid,username,avatar_url,coins,diamonds,vip_level,v_points,game_level,game_exp,phone_verified')
    .eq('uid', req.user.uid)
    .single();
  if (error) return res.status(404).json({ error: '找不到用戶' });
  res.json(data);
});

// PUT /api/user/profile
router.put('/profile', requireAuth, async (req, res) => {
  const { username, avatar_url } = req.body;
  const updates = {};
  if (username)   updates.username   = username;
  if (avatar_url) updates.avatar_url = avatar_url;
  const { error } = await supabase.from('users').update(updates).eq('uid', req.user.uid);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

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

module.exports = router;
