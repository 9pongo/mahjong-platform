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

module.exports = router;
