// ════════════════════════════════════════
//  server/routes/push.js  — Web Push 訂閱管理
// ════════════════════════════════════════
const router   = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const supabase = require('../models/supabase');
const { isPushEnabled } = require('../services/pushService');

// ── GET /api/push/vapid-public-key
router.get('/vapid-public-key', (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key || !isPushEnabled()) return res.json({ enabled: false });
  res.json({ enabled: true, publicKey: key });
});

// ── POST /api/push/subscribe  — 儲存訂閱
router.post('/subscribe', requireAuth, async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth)
    return res.status(400).json({ error: '無效訂閱資料' });

  const { error } = await supabase.from('push_subscriptions').upsert(
    { uid: req.uid, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    { onConflict: 'endpoint' }
  );
  if (error) return res.status(500).json({ error: '訂閱儲存失敗' });
  res.json({ ok: true });
});

// ── POST /api/push/unsubscribe  — 刪除訂閱
router.post('/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) {
    await supabase.from('push_subscriptions')
      .delete().eq('uid', req.uid).eq('endpoint', endpoint);
  } else {
    // 清除此帳號所有裝置
    await supabase.from('push_subscriptions').delete().eq('uid', req.uid);
  }
  res.json({ ok: true });
});

module.exports = router;
