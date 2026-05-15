// ════════════════════════════════════════
//  server/services/smsService.js
//  SMS OTP 服務（支援 bypass 模式）
//
//  開發模式：SMS_BYPASS=true → 固定接受驗證碼 000000
//  正式模式：串接真實 SMS API（MITAKE / Twilio，TODO）
// ════════════════════════════════════════
const supabase = require('../models/supabase');

const BYPASS    = process.env.SMS_BYPASS === 'true';
const OTP_TTL   = 5 * 60 * 1000; // 5 分鐘
const COOLDOWN  = 60 * 1000;      // 60 秒冷卻（防止重複發送）

/**
 * 發送 OTP 到指定手機號碼
 * @param {string} phone  - 10 碼台灣手機（09xxxxxxxx）
 * @returns {{ ok: boolean, error?: string, dev_code?: string }}
 */
async function sendOtp(phone) {
  if (!/^09\d{8}$/.test(phone)) {
    return { ok: false, error: '手機號碼格式錯誤（09xxxxxxxx）' };
  }

  // 冷卻檢查：避免頻繁發送
  const { data: existing } = await supabase
    .from('phone_otps')
    .select('created_at')
    .eq('phone', phone)
    .eq('used', false)
    .maybeSingle();

  if (existing) {
    const elapsed = Date.now() - new Date(existing.created_at).getTime();
    if (elapsed < COOLDOWN) {
      const remaining = Math.ceil((COOLDOWN - elapsed) / 1000);
      return { ok: false, error: `請等待 ${remaining} 秒後再重新發送` };
    }
  }

  // bypass 模式固定使用 000000，正式則隨機 6 碼
  const code      = BYPASS ? '000000' : String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + OTP_TTL).toISOString();

  // 寫入 / 更新 OTP 記錄
  const { error: dbErr } = await supabase
    .from('phone_otps')
    .upsert(
      { phone, code, expires_at: expiresAt, used: false, created_at: new Date().toISOString() },
      { onConflict: 'phone' }
    );

  if (dbErr) {
    console.error('[SMS] DB error:', dbErr.message);
    return { ok: false, error: '系統錯誤，請稍後再試' };
  }

  if (BYPASS) {
    console.log(`[SMS BYPASS] ${phone} → 驗證碼：${code}（bypass 模式固定接受 000000）`);
  } else {
    // ── TODO：正式環境串接 MITAKE / Twilio ─────
    // await mitake.send({ to: phone, text: `【麻將平台】驗證碼：${code}，5分鐘內有效` });
    console.log(`[SMS] ${phone} → 驗證碼：${code}`);
  }

  return {
    ok: true,
    // 非正式環境回傳驗證碼，方便測試
    dev_code: process.env.NODE_ENV !== 'production' ? code : undefined,
  };
}

/**
 * 驗證 OTP
 * @param {string} phone
 * @param {string} code
 * @returns {{ ok: boolean, error?: string }}
 */
async function verifyOtp(phone, code) {
  const { data: row, error } = await supabase
    .from('phone_otps')
    .select()
    .eq('phone', phone)
    .eq('used', false)
    .maybeSingle();

  if (error || !row)
    return { ok: false, error: '驗證碼不存在或已使用，請重新發送' };
  if (new Date(row.expires_at) < new Date())
    return { ok: false, error: '驗證碼已過期，請重新發送' };
  if (row.code !== String(code))
    return { ok: false, error: '驗證碼錯誤' };

  // 標記為已使用
  await supabase.from('phone_otps').update({ used: true }).eq('phone', phone);

  return { ok: true };
}

module.exports = { sendOtp, verifyOtp };
