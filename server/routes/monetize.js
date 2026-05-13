// ════════════════════════════════════════
//  server/routes/monetize.js
//  變現路由：月卡 / 推薦碼 / 充值 stub
//  金流串接端口預留，目前回傳 pending
// ════════════════════════════════════════
const router   = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const {
  getPassStatus, purchasePass, claimDailyPass,
} = require('../services/monthlyPassService');
const {
  getOrCreateCode, useReferralCode, getReferralStats,
} = require('../services/referralService');
const { getActiveEvents } = require('../services/eventService');

// ══════════════════════════════════════
//  月卡
// ══════════════════════════════════════

// GET /api/monetize/pass  — 月卡狀態
router.get('/pass', requireAuth, async (req, res) => {
  try {
    const status = await getPassStatus(req.user.uid);
    res.json({ pass: status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/monetize/pass/claim  — 手動領取今日月卡
router.post('/pass/claim', requireAuth, async (req, res) => {
  try {
    const result = await claimDailyPass(req.user.uid);
    res.json({ ok: true, coins: result.coins });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/monetize/pass/buy  — 購買月卡（金流 stub）
// ⚠️  金流串接端口：待串接真實支付後實作
router.post('/pass/buy', requireAuth, async (req, res) => {
  try {
    const { days = 30 } = req.body;
    // TODO: 接收金流回調後再呼叫 purchasePass
    // 目前開發模式直接到帳（免費月卡 stub）
    const result = await purchasePass(req.user.uid, days);
    res.json({
      ok: true,
      stub: true,   // 標記為 stub（上線後移除）
      message: '月卡已啟用（測試模式，金流待串接）',
      expires_at: result.expires_at,
      days_left:  result.days_left,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  推薦碼
// ══════════════════════════════════════

// GET /api/monetize/referral  — 我的推薦碼 & 統計
router.get('/referral', requireAuth, async (req, res) => {
  try {
    const stats = await getReferralStats(req.user.uid);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/monetize/referral/use  — 使用推薦碼
router.post('/referral/use', requireAuth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: '缺少推薦碼' });
    const result = await useReferralCode(code, req.user.uid);
    res.json({ ok: true, reward: result.reward });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  活動
// ══════════════════════════════════════

// GET /api/monetize/events  — 進行中活動（公開）
router.get('/events', async (_req, res) => {
  try {
    const events = await getActiveEvents();
    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  充值 stub（金流串接預留端口）
// ══════════════════════════════════════

/**
 * POST /api/monetize/topup
 * Body: { packageId: string }
 * ⚠️  TODO: 串接金流（ECPay / 藍新 / 歐付寶）後實作
 */
router.post('/topup', requireAuth, async (req, res) => {
  const { packageId } = req.body;
  // 回傳 stub 回應，不實際扣款
  res.json({
    ok:      false,
    stub:    true,
    status:  'coming_soon',
    message: '線上充值即將開放，敬請期待！如需購買請聯繫客服。',
    packageId,
    contact: process.env.SUPPORT_LINE || null,
  });
});

module.exports = router;
