// ════════════════════════════════════════
//  server/routes/analytics.js
//  前端行為埋點接收端點
//  POST /api/analytics/batch  — 批次接收最多 20 筆事件
// ════════════════════════════════════════
const router   = require('express').Router();
const supabase = require('../models/supabase');
const { optionalAuth } = require('../middleware/auth');

// POST /api/analytics/batch
router.post('/batch', optionalAuth, async (req, res) => {
  const { events, session_id = '' } = req.body;
  if (!Array.isArray(events) || !events.length) return res.json({ ok: true });

  const uid  = req.user?.uid || null;
  const page = req.headers['referer'] || '';

  // 最多接受 20 筆，避免濫用
  const rows = events.slice(0, 20).map(ev => ({
    uid,
    event_name: String(ev.name  || '').slice(0, 100),
    properties: ev.props || {},
    page:       String(ev.page  || page).slice(0, 200),
    session_id: String(session_id).slice(0, 64),
  }));

  // fire-and-forget，不讓埋點影響前端
  supabase.from('analytics_events').insert(rows).then(() => {}).catch(() => {});

  res.json({ ok: true });
});

// GET /api/admin/analytics/summary  (admin 路由中另外掛載)
module.exports = router;
