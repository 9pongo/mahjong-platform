// ════════════════════════════════════════
//  server/routes/auth.js
// ════════════════════════════════════════
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../models/supabase');
const { requireAuth } = require('../middleware/auth');
const { validate, sanitize } = require('../middleware/validate');

const sign = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// ── POST /api/auth/register-guest ────────
// 產生遊客帳號，立即可玩
router.post('/register-guest', async (req, res) => {
  try {
    const uid      = uuidv4();
    const username = `玩家${uid.slice(0,6).toUpperCase()}`;
    const { data, error } = await supabase
      .from('users')
      .insert({ uid, username, coins: 1000, vip_level: 0, game_level: 1 })
      .select()
      .single();

    if (error) throw error;
    const token = sign({ uid: data.uid, username: data.username, vip_level: 0 });
    res.json({ token, user: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/auth/send-sms ──────────────
// 發送手機簡訊驗證碼（正式串接台灣簡訊API）
router.post('/send-sms', validate({ phone: 'string|10-10' }), async (req, res) => {
  const { phone } = req.body;
  if (!/^09\d{8}$/.test(phone))
    return res.status(400).json({ error: '手機號碼格式錯誤（09xxxxxxxx）' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  // TODO Phase2: 串接台灣簡訊 API
  console.log(`[SMS] ${phone} → 驗證碼：${code}`);

  // 暫存驗證碼 60 秒（正式用 Redis 或 Supabase）
  await supabase.from('sms_codes').upsert({ phone, code, expires_at: new Date(Date.now() + 60000) });
  res.json({ ok: true, dev_code: process.env.NODE_ENV !== 'production' ? code : undefined });
});

// ── POST /api/auth/verify-sms ────────────
router.post('/verify-sms', requireAuth, async (req, res) => {
  const { phone, code } = req.body;
  const { data: row } = await supabase
    .from('sms_codes')
    .select()
    .eq('phone', phone)
    .single();

  if (!row || row.code !== code || new Date(row.expires_at) < new Date())
    return res.status(400).json({ error: '驗證碼錯誤或已過期' });

  await supabase.from('users').update({ phone, phone_verified: true }).eq('uid', req.user.uid);
  await supabase.from('sms_codes').delete().eq('phone', phone);
  res.json({ ok: true });
});

// ── POST /api/auth/login ─────────────────
// 手機號碼登入（已驗證帳號）
router.post('/login', async (req, res) => {
  const { phone, code } = req.body;
  // 同樣走簡訊驗證流程（無密碼登入）
  const { data: codeRow } = await supabase
    .from('sms_codes')
    .select()
    .eq('phone', phone)
    .single();

  if (!codeRow || codeRow.code !== code || new Date(codeRow.expires_at) < new Date())
    return res.status(400).json({ error: '驗證碼錯誤或已過期' });

  const { data: user, error } = await supabase
    .from('users')
    .select()
    .eq('phone', phone)
    .single();

  if (error || !user) return res.status(404).json({ error: '帳號不存在' });

  await supabase.from('users').update({ last_login: new Date() }).eq('uid', user.uid);
  await supabase.from('sms_codes').delete().eq('phone', phone);

  const token = sign({ uid: user.uid, username: user.username, vip_level: user.vip_level });
  res.json({ token, user });
});

// ── GET /api/auth/me ─────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('uid,username,avatar_url,coins,diamonds,vip_level,game_level,game_exp,phone_verified')
    .eq('uid', req.user.uid)
    .single();
  if (error) return res.status(404).json({ error: '找不到用戶' });

  // 每日登入任務進度
  try {
    const { updateQuestProgress } = require('../services/questService');
    await updateQuestProgress(data.uid, { login: 1 });
    // 更新 last_login
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('uid', data.uid);
  } catch (_) {}

  res.json(data);
});

module.exports = router;
