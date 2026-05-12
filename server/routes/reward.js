// ════════════════════════════════════════
//  server/routes/reward.js  —  每日獎勵 API
// ════════════════════════════════════════
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const supabase = require('../models/supabase');
const {
  spinWheel, openHongbao, getDailyStatus,
} = require('../services/dailyRewardService');

// GET /api/reward/daily-status
router.get('/daily-status', requireAuth, async (req, res) => {
  const { data: user } = await supabase
    .from('users').select('vip_level').eq('uid', req.user.uid).single();
  const status = await getDailyStatus(req.user.uid, user?.vip_level || 0);
  res.json(status);
});

// POST /api/reward/spin
router.post('/spin', requireAuth, async (req, res) => {
  const result = await spinWheel(req.user.uid);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

// POST /api/reward/hongbao
router.post('/hongbao', requireAuth, async (req, res) => {
  const { data: user } = await supabase
    .from('users').select('vip_level').eq('uid', req.user.uid).single();
  const result = await openHongbao(req.user.uid, user?.vip_level || 0);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

module.exports = router;
