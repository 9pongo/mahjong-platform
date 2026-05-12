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

module.exports = router;
