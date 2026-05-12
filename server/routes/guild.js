// ════════════════════════════════════════
//  server/routes/guild.js  —  公會系統
// ════════════════════════════════════════
const router   = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const supabase = require('../models/supabase');
const { v4: uuidv4 } = require('uuid');

// ── GET /api/guild/my  — 我的公會
router.get('/my', requireAuth, async (req, res) => {
  const uid = req.uid;
  const { data: member } = await supabase.from('guild_members')
    .select('guild_id, role, joined_at').eq('uid', uid).maybeSingle();
  if (!member) return res.json({ guild: null });

  const { data: guild } = await supabase.from('guilds')
    .select('*').eq('guild_id', member.guild_id).maybeSingle();

  const { data: members } = await supabase.from('guild_members')
    .select('uid, role, joined_at').eq('guild_id', member.guild_id).limit(20);

  const memberUids = (members || []).map(m => m.uid);
  const { data: users } = await supabase.from('users')
    .select('uid, username, vip_level, game_level').in('uid', memberUids);
  const userMap = {};
  for (const u of users || []) userMap[u.uid] = u;

  const enriched = (members || []).map(m => ({
    ...userMap[m.uid], role: m.role, joinedAt: m.joined_at,
  }));

  res.json({ guild: { ...guild, members: enriched, myRole: member.role } });
});

// ── GET /api/guild/list  — 公開公會清單
router.get('/list', requireAuth, async (req, res) => {
  const { data: guilds } = await supabase.from('guilds')
    .select('guild_id, name, type, created_at').limit(20).order('created_at', { ascending: false });

  // 各公會人數
  const guildIds = (guilds || []).map(g => g.guild_id);
  const counts = {};
  if (guildIds.length) {
    const { data: mems } = await supabase.from('guild_members')
      .select('guild_id').in('guild_id', guildIds);
    for (const m of mems || []) counts[m.guild_id] = (counts[m.guild_id] || 0) + 1;
  }

  res.json({ guilds: (guilds || []).map(g => ({ ...g, memberCount: counts[g.guild_id] || 0 })) });
});

// ── POST /api/guild/create  — 建立公會
router.post('/create', requireAuth, async (req, res) => {
  const { name, type } = req.body;
  const uid = req.uid;
  if (!name || name.length < 2 || name.length > 16)
    return res.status(400).json({ error: '公會名稱需 2~16 字' });

  // 已在公會中 → 不能再建
  const { data: inGuild } = await supabase.from('guild_members')
    .select('guild_id').eq('uid', uid).maybeSingle();
  if (inGuild) return res.status(400).json({ error: '已在公會中，請先退出' });

  // 名稱不重複
  const { data: exists } = await supabase.from('guilds')
    .select('guild_id').eq('name', name).maybeSingle();
  if (exists) return res.status(400).json({ error: '公會名稱已被使用' });

  const guildId = uuidv4();
  await supabase.from('guilds').insert({ guild_id: guildId, name, type, leader_uid: uid });
  await supabase.from('guild_members').insert({ uid, guild_id: guildId, role: 'leader' });

  res.json({ ok: true, guildId, name });
});

// ── POST /api/guild/join  — 加入公會
router.post('/join', requireAuth, async (req, res) => {
  const { guildId } = req.body;
  const uid = req.uid;
  if (!guildId) return res.status(400).json({ error: '缺少 guildId' });

  const { data: guild } = await supabase.from('guilds')
    .select('guild_id, name').eq('guild_id', guildId).maybeSingle();
  if (!guild) return res.status(404).json({ error: '公會不存在' });

  const { data: inGuild } = await supabase.from('guild_members')
    .select('guild_id').eq('uid', uid).maybeSingle();
  if (inGuild) return res.status(400).json({ error: '已在公會中，請先退出' });

  // 人數上限 30
  const { count } = await supabase.from('guild_members')
    .select('*', { count: 'exact', head: true }).eq('guild_id', guildId);
  if (count >= 30) return res.status(400).json({ error: '公會人數已滿' });

  await supabase.from('guild_members').insert({ uid, guild_id: guildId, role: 'member' });
  res.json({ ok: true, name: guild.name });
});

// ── DELETE /api/guild/leave  — 退出公會
router.delete('/leave', requireAuth, async (req, res) => {
  const uid = req.uid;
  const { data: member } = await supabase.from('guild_members')
    .select('guild_id, role').eq('uid', uid).maybeSingle();
  if (!member) return res.status(400).json({ error: '你不在任何公會' });

  if (member.role === 'leader') {
    // 找下一個人接手，或解散
    const { data: others } = await supabase.from('guild_members')
      .select('uid').eq('guild_id', member.guild_id).neq('uid', uid).limit(1);
    if (others?.length) {
      await supabase.from('guilds').update({ leader_uid: others[0].uid }).eq('guild_id', member.guild_id);
      await supabase.from('guild_members').update({ role: 'leader' })
        .eq('uid', others[0].uid).eq('guild_id', member.guild_id);
    } else {
      // 解散公會
      await supabase.from('guilds').delete().eq('guild_id', member.guild_id);
    }
  }

  await supabase.from('guild_members').delete()
    .eq('uid', uid).eq('guild_id', member.guild_id);
  res.json({ ok: true });
});

// ── GET /api/guild/leaderboard  — 公會成員勝場排行
router.get('/leaderboard', requireAuth, async (req, res) => {
  const uid = req.uid;

  // 找我所在的公會
  const { data: member } = await supabase.from('guild_members')
    .select('guild_id').eq('uid', uid).maybeSingle();
  if (!member) return res.json({ list: [], guildId: null });

  // 取所有成員 uid + 角色
  const { data: members } = await supabase.from('guild_members')
    .select('uid, role').eq('guild_id', member.guild_id);

  if (!members?.length) return res.json({ list: [], guildId: member.guild_id });

  const uids = members.map(m => m.uid);
  const roleMap = {};
  for (const m of members) roleMap[m.uid] = m.role;

  // 從 leaderboard view 撈戰績（已按勝場降序）
  const { data: stats, error } = await supabase
    .from('leaderboard')
    .select('uid, username, total_wins, total_games, coins, game_level')
    .in('uid', uids);

  if (error) return res.status(500).json({ error: error.message });

  const list = (stats || []).map(s => ({
    ...s,
    role:     roleMap[s.uid] || 'member',
    win_rate: s.total_games > 0
      ? ((s.total_wins / s.total_games) * 100).toFixed(1) + '%'
      : '0%',
  })).sort((a, b) => b.total_wins - a.total_wins);

  res.json({ list, guildId: member.guild_id });
});

module.exports = router;
