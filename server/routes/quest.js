// ════════════════════════════════════════
//  server/routes/quest.js  —  任務 API
// ════════════════════════════════════════
const router       = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const questService = require('../services/questService');

// GET /api/quest   — 取得本期任務列表
router.get('/', requireAuth, async (req, res) => {
  try {
    const quests = await questService.getQuests(req.uid);
    res.json({ quests });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/quest/claim  — 領取獎勵
router.post('/claim', requireAuth, async (req, res) => {
  const { questId } = req.body;
  if (!questId) return res.status(400).json({ error: '缺少 questId' });
  try {
    const result = await questService.claimQuest(req.uid, questId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
