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
const { sendOtp, verifyOtp } = require('../services/smsService');

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
// 舊端點保留相容（轉發到新版 smsService）
router.post('/send-sms', async (req, res) => {
  const { phone } = req.body;
  const result = await sendOtp(phone);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, dev_code: result.dev_code });
});

// ── POST /api/auth/verify-sms ────────────
// 舊端點保留相容
router.post('/verify-sms', requireAuth, async (req, res) => {
  const { phone, code } = req.body;
  const result = await verifyOtp(phone, code);
  if (!result.ok) return res.status(400).json({ error: result.error });

  // 檢查手機是否已被其他帳號使用（one-phone-one-account）
  const { data: taken } = await supabase
    .from('users')
    .select('uid')
    .eq('phone', phone)
    .neq('uid', req.user.uid)
    .maybeSingle();
  if (taken) return res.status(409).json({ error: '此手機號碼已綁定其他帳號' });

  await supabase.from('users').update({ phone, phone_verified: true }).eq('uid', req.user.uid);
  res.json({ ok: true });
});

// ── POST /api/auth/phone/send-otp ────────
// 新版：發送手機驗證碼（需登入）
router.post('/phone/send-otp', requireAuth, async (req, res) => {
  const { phone } = req.body;
  const result = await sendOtp(phone);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, dev_code: result.dev_code });
});

// ── POST /api/auth/phone/verify ──────────
// 新版：驗證 OTP 並綁定手機（需登入）
router.post('/phone/verify', requireAuth, async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ error: '缺少手機號碼或驗證碼' });

  const result = await verifyOtp(phone, String(code));
  if (!result.ok) return res.status(400).json({ error: result.error });

  // 一機一帳：確認手機未被其他帳號佔用
  const { data: taken } = await supabase
    .from('users')
    .select('uid')
    .eq('phone', phone)
    .eq('status', 'active')
    .neq('uid', req.user.uid)
    .maybeSingle();
  if (taken) return res.status(409).json({ error: '此手機號碼已綁定其他帳號' });

  const { error } = await supabase
    .from('users')
    .update({ phone, phone_verified: true })
    .eq('uid', req.user.uid);
  if (error) return res.status(500).json({ error: error.message });

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
  if (user.is_banned)  return res.status(403).json({ error: '帳號已被封禁，請聯繫客服' });

  await supabase.from('users').update({ last_login: new Date() }).eq('uid', user.uid);
  await supabase.from('sms_codes').delete().eq('phone', phone);

  const token = sign({ uid: user.uid, username: user.username, vip_level: user.vip_level });
  res.json({ token, user });
});

// ── POST /api/auth/register-email ───────
// 以 email + 密碼 建立帳號（可綁定現有遊客帳號）
router.post('/register-email', requireAuth, async (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: '請輸入有效的 Email' });
  if (!password || password.length < 6)
    return res.status(400).json({ error: '密碼至少 6 位' });

  // 確認 email 尚未被使用
  const { data: exist } = await supabase
    .from('users').select('uid').eq('email', email).maybeSingle();
  if (exist) return res.status(409).json({ error: '此 Email 已被使用' });

  const hash = await bcrypt.hash(password, 10);
  const updates = { email, password_hash: hash };
  if (username?.trim()) updates.username = username.trim();

  const { data, error } = await supabase
    .from('users').update(updates).eq('uid', req.user.uid).select().single();
  if (error) return res.status(500).json({ error: error.message });

  const token = sign({ uid: data.uid, username: data.username, vip_level: data.vip_level });
  res.json({ ok: true, token, user: data });
});

// ── POST /api/auth/login-email ───────────
// Email + 密碼 登入
router.post('/login-email', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: '請輸入 Email 與密碼' });

  const { data: user, error } = await supabase
    .from('users').select('*').eq('email', email).maybeSingle();
  if (error || !user) return res.status(401).json({ error: 'Email 或密碼錯誤' });
  if (!user.password_hash) return res.status(401).json({ error: '此帳號尚未設定密碼，請用遊客登入後到個人頁面綁定' });
  if (user.is_banned) return res.status(403).json({ error: '帳號已被封禁，請聯繫客服' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Email 或密碼錯誤' });

  await supabase.from('users').update({ last_login: new Date() }).eq('uid', user.uid);
  const token = sign({ uid: user.uid, username: user.username, vip_level: user.vip_level });
  res.json({ token, user });
});

// ── POST /api/auth/forgot-password ──────
// 產生重設 token，存入 DB；正式環境可寄 Email
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '請輸入 Email' });

  const { data: user } = await supabase
    .from('users').select('uid, username').eq('email', email).maybeSingle();

  // 不論帳號是否存在，都回傳相同訊息（防 user enumeration）
  if (!user) return res.json({ ok: true });

  const token   = uuidv4().replace(/-/g, '');  // 32-char hex token
  const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 分鐘有效

  await supabase.from('users')
    .update({ reset_token: token, reset_token_exp: expires.toISOString() })
    .eq('uid', user.uid);

  const resetUrl = `${process.env.APP_URL || ''}/pages/reset-password.html?token=${token}`;

  // 正式環境：此處可串接 Email 服務（Resend / SendGrid）
  console.log(`[Auth] 密碼重設連結 for ${email}: ${resetUrl}`);

  // 開發模式回傳 token 方便測試
  const devData = process.env.NODE_ENV !== 'production' ? { reset_url: resetUrl } : {};
  res.json({ ok: true, ...devData });
});

// ── POST /api/auth/reset-password ───────
// 驗證 token 並設定新密碼
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token)    return res.status(400).json({ error: '缺少重設 token' });
  if (!password || password.length < 6) return res.status(400).json({ error: '密碼至少 6 位' });

  const { data: user } = await supabase
    .from('users').select('uid, reset_token_exp')
    .eq('reset_token', token).maybeSingle();

  if (!user) return res.status(400).json({ error: '重設連結無效或已過期' });
  if (new Date(user.reset_token_exp) < new Date())
    return res.status(400).json({ error: '重設連結已過期，請重新申請' });

  const hash = await bcrypt.hash(password, 10);
  const { error } = await supabase.from('users').update({
    password_hash:    hash,
    reset_token:      null,
    reset_token_exp:  null,
  }).eq('uid', user.uid);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── GET /api/auth/me ─────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')          // select * 避免遷移未執行時新欄位不存在導致報錯
    .eq('uid', req.user.uid)
    .single();
  if (error) return res.status(404).json({ error: '找不到用戶' });

  // 不回傳敏感欄位
  const { password_hash, reset_token, reset_token_exp, ...safeUser } = data;

  // 每日登入任務進度
  try {
    const { updateQuestProgress } = require('../services/questService');
    await updateQuestProgress(safeUser.uid, { login: 1 });
    // 更新 last_login
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('uid', safeUser.uid);
  } catch (_) {}

  res.json(safeUser);
});

module.exports = router;
