// ════════════════════════════════════════
//  server/routes/leaderboard.js
// ════════════════════════════════════════
const router   = require('express').Router();
const supabase = require('../models/supabase');

// GET /api/leaderboard?type=wins|coins&limit=20
router.get('/', async (req, res) => {
  const type  = req.query.type  || 'wins';   // wins | coins
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  try {
    if (type === 'coins') {
      // 金幣排行：直接查 users
      const { data, error } = await supabase
        .from('users')
        .select('uid, username, vip_level, game_level, coins')
        .order('coins', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return res.json({ type, list: data || [] });
    }

    // 勝場排行：用 leaderboard view
    const { data, error } = await supabase
      .from('leaderboard')
      .select('uid, username, vip_level, game_level, coins, total_wins, total_games')
      .limit(limit);
    if (error) throw error;

    // 補充勝率
    const list = (data || []).map(r => ({
      ...r,
      win_rate: r.total_games > 0
        ? ((r.total_wins / r.total_games) * 100).toFixed(1) + '%'
        : '0%',
    }));
    res.json({ type, list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
