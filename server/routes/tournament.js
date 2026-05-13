// ════════════════════════════════════════
//  server/routes/tournament.js
// ════════════════════════════════════════
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const {
  getActiveTournaments,
  getTournamentDetail,
  registerTournament,
} = require('../services/tournamentService');

// GET /api/tournament — 列出進行中 & 即將開始
router.get('/', async (req, res) => {
  try {
    const list = await getActiveTournaments();
    res.json({ tournaments: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/tournament/:id — 賽事詳情 + 排行 + 我的狀態
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const detail = await getTournamentDetail(req.params.id, req.uid);
    if (!detail) return res.status(404).json({ error: '賽事不存在' });
    res.json(detail);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tournament/:id/register — 報名
router.post('/:id/register', requireAuth, async (req, res) => {
  try {
    const result = await registerTournament(req.params.id, req.uid);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
