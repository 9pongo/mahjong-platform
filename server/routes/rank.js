// ════════════════════════════════════════
//  server/routes/rank.js
//  GET /api/rank/me
//  GET /api/rank/leaderboard
// ════════════════════════════════════════
const router      = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const {
  getUserRank,
  getRankLeaderboard,
} = require('../services/rankService');

// GET /api/rank/me  — 自己當前段位（需登入）
router.get('/me', requireAuth, async (req, res) => {
  try {
    const rank = await getUserRank(req.user.uid);
    res.json({ rank });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/rank/leaderboard?limit=20  — 段位榜（公開）
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const list  = await getRankLeaderboard(limit);
    res.json({ list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/rank/user/:uid  — 指定玩家段位（公開）
router.get('/user/:uid', async (req, res) => {
  try {
    const rank = await getUserRank(req.params.uid);
    res.json({ rank });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
