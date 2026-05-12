// ════════════════════════════════════════
//  server/routes/dojo.js  —  道館 API
// ════════════════════════════════════════
const router      = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const dojoService = require('../services/dojoService');

// GET /api/dojo  — 道館列表 + 進度
router.get('/', requireAuth, async (req, res) => {
  try {
    const dojos = await dojoService.getDojoProgress(req.uid);
    res.json({ dojos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dojo/win  — 贏局後更新進度（由 gameSocket 呼叫，或前端直接通報）
router.post('/win', requireAuth, async (req, res) => {
  const { dojoId } = req.body;
  if (!dojoId) return res.status(400).json({ error: '缺少 dojoId' });
  try {
    const result = await dojoService.recordWin(req.uid, dojoId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
