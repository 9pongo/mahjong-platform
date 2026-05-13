// ════════════════════════════════════════
//  server/routes/room.js  —  房間 REST API
// ════════════════════════════════════════
const router      = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const roomManager = require('../socket/roomManager');

// GET /api/room/list  — 大廳房間列表
router.get('/list', requireAuth, async (req, res) => {
  const { type } = req.query;  // short | public | diamond
  const rooms = roomManager.listRooms(type);
  res.json(rooms);
});

// POST /api/room/create
router.post('/create', requireAuth, async (req, res) => {
  const { roomType, betKey } = req.body;
  const room = roomManager.createRoom(roomType, betKey, req.user.uid);
  res.json(room);
});

// POST /api/room/matchmake  — 自動配桌
router.post('/matchmake', requireAuth, async (req, res) => {
  const { roomType, betKey } = req.body;
  const room = roomManager.matchmake(req.user.uid, roomType, betKey);
  res.json({ roomId: room.roomId });
});

// POST /api/room/private  — 建立私人房（含邀請碼）
router.post('/private', requireAuth, async (req, res) => {
  try {
    const { betKey } = req.body;
    if (!betKey) return res.status(400).json({ error: '缺少 betKey' });
    const room = roomManager.createPrivateRoom(betKey, req.user.uid);
    res.json({ roomId: room.roomId, inviteCode: room.inviteCode });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/room/join-code  — 透過邀請碼加入私人房
router.post('/join-code', requireAuth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: '缺少邀請碼' });
    const room = roomManager.getRoomByCode(code);
    if (!room) return res.status(404).json({ error: '邀請碼無效或房間不存在' });
    if (room.status !== 'waiting') return res.status(400).json({ error: '遊戲已開始' });
    res.json({ roomId: room.roomId, betKey: room.betKey });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
