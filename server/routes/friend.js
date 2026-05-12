// ════════════════════════════════════════
//  server/routes/friend.js  —  好友系統
// ════════════════════════════════════════
const router   = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const supabase = require('../models/supabase');

// ── GET /api/friend  — 好友列表（已接受 + 待處理）
router.get('/', requireAuth, async (req, res) => {
  const uid = req.uid;

  // 我發出的 + 別人發給我的
  const { data: sent }     = await supabase.from('friends')
    .select('friend_uid, status, created_at')
    .eq('uid', uid);

  const { data: received } = await supabase.from('friends')
    .select('uid, status, created_at')
    .eq('friend_uid', uid)
    .eq('status', 'pending');   // 只撈待處理

  // 取好友的 username
  const friendUids = (sent || []).map(r => r.friend_uid);
  const pendingUids = (received || []).map(r => r.uid);
  const allUids = [...new Set([...friendUids, ...pendingUids])];

  let userMap = {};
  if (allUids.length) {
    const { data: users } = await supabase.from('users')
      .select('uid, username, vip_level, game_level')
      .in('uid', allUids);
    for (const u of users || []) userMap[u.uid] = u;
  }

  const friends = (sent || [])
    .filter(r => r.status === 'accepted')
    .map(r => ({ ...userMap[r.friend_uid], friendedAt: r.created_at }));

  const pendingOut = (sent || [])
    .filter(r => r.status === 'pending')
    .map(r => ({ ...userMap[r.friend_uid], direction: 'out' }));

  const pendingIn = (received || [])
    .map(r => ({ ...userMap[r.uid], direction: 'in' }));

  res.json({ friends, pending: [...pendingOut, ...pendingIn] });
});

// ── POST /api/friend/add  — 送出好友申請（含 Socket 通知）
router.post('/add', requireAuth, async (req, res) => {
  const { targetUid } = req.body;
  const uid = req.uid;
  if (!targetUid || targetUid === uid)
    return res.status(400).json({ error: '無效的目標 UID' });

  // 確認對方存在
  const { data: target } = await supabase.from('users')
    .select('uid, username').eq('uid', targetUid).maybeSingle();
  if (!target) return res.status(404).json({ error: '找不到此玩家' });

  // 取自己的 username
  const { data: self } = await supabase.from('users')
    .select('username').eq('uid', uid).maybeSingle();

  // 檢查是否已送出或已是好友
  const { data: exists } = await supabase.from('friends')
    .select('status').eq('uid', uid).eq('friend_uid', targetUid).maybeSingle();
  if (exists) return res.status(400).json({ error: exists.status === 'accepted' ? '已是好友' : '申請已送出' });

  // 若對方也送過申請給我 → 直接互加
  const { data: reverse } = await supabase.from('friends')
    .select('status').eq('uid', targetUid).eq('friend_uid', uid).maybeSingle();

  const io = req.app.get('io');

  if (reverse?.status === 'pending') {
    await supabase.from('friends')
      .update({ status: 'accepted' }).eq('uid', targetUid).eq('friend_uid', uid);
    await supabase.from('friends')
      .insert({ uid, friend_uid: targetUid, status: 'accepted' });
    // 通知雙方
    io?.to(`user:${targetUid}`).emit('friend:accepted', { uid, username: self?.username });
    return res.json({ ok: true, accepted: true, username: target.username });
  }

  await supabase.from('friends').insert({ uid, friend_uid: targetUid, status: 'pending' });

  // 即時通知對方有新好友申請
  io?.to(`user:${targetUid}`).emit('friend:request', {
    fromUid:      uid,
    fromUsername: self?.username || '玩家',
  });

  res.json({ ok: true, accepted: false, username: target.username });
});

// ── POST /api/friend/accept  — 接受申請
router.post('/accept', requireAuth, async (req, res) => {
  const { fromUid } = req.body;
  const uid = req.uid;

  const { data } = await supabase.from('friends')
    .select('status').eq('uid', fromUid).eq('friend_uid', uid).maybeSingle();
  if (!data || data.status !== 'pending')
    return res.status(400).json({ error: '無待處理申請' });

  // 雙向接受
  await supabase.from('friends')
    .update({ status: 'accepted' }).eq('uid', fromUid).eq('friend_uid', uid);
  // 新增反向
  await supabase.from('friends')
    .upsert({ uid, friend_uid: fromUid, status: 'accepted' }, { onConflict: 'uid,friend_uid' });

  res.json({ ok: true });
});

// ── POST /api/friend/reject  — 拒絕申請
router.post('/reject', requireAuth, async (req, res) => {
  const { fromUid } = req.body;
  await supabase.from('friends')
    .delete().eq('uid', fromUid).eq('friend_uid', req.uid);
  res.json({ ok: true });
});

// ── DELETE /api/friend/:targetUid  — 刪除好友
router.delete('/:targetUid', requireAuth, async (req, res) => {
  const { targetUid } = req.params;
  const uid = req.uid;
  // 雙向刪除
  await supabase.from('friends').delete()
    .or(`and(uid.eq.${uid},friend_uid.eq.${targetUid}),and(uid.eq.${targetUid},friend_uid.eq.${uid})`);
  res.json({ ok: true });
});

module.exports = router;
