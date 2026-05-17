// ════════════════════════════════════════
//  server/routes/battlepass.js
//  月見通行證（Battle Pass）API
// ════════════════════════════════════════
const router   = require('express').Router();
const supabase = require('../models/supabase');
const { requireAuth } = require('../middleware/auth');
const { updateCoins }  = require('../services/coinService');

// ── 共用：取得當前 active 通行證 ────────
async function getActivePass() {
  const { data } = await supabase
    .from('battle_passes')
    .select('*')
    .eq('active', true)
    .maybeSingle();
  return data;
}

// ── 共用：計算已解鎖天數 ────────────────
function calcUnlockedDays(pass) {
  const start = new Date(pass.starts_at);
  const now   = new Date();
  const diff  = Math.floor((now - start) / 86400000); // 毫秒→天
  return Math.min(Math.max(diff + 1, 0), 30);
}

// ── GET /api/battlepass/current ─────────
// 取得當前賽季 + 玩家進度（自動建立免費資格）
router.get('/current', requireAuth, async (req, res) => {
  const uid  = req.user.uid;
  const pass = await getActivePass();
  if (!pass) return res.json({ pass: null });

  // 30 天獎勵定義
  const { data: rewards } = await supabase
    .from('battle_pass_rewards')
    .select('*')
    .eq('pass_id', pass.id)
    .order('day');

  // 玩家通行證狀態（自動初始化免費版）
  let { data: userPass } = await supabase
    .from('user_battle_pass')
    .select('*')
    .eq('uid', uid)
    .eq('pass_id', pass.id)
    .maybeSingle();

  if (!userPass) {
    const { data: inserted } = await supabase
      .from('user_battle_pass')
      .insert({ uid, pass_id: pass.id, is_premium: false })
      .select()
      .single();
    userPass = inserted;
  }

  // 已領取記錄
  const { data: claims } = await supabase
    .from('user_battle_pass_claims')
    .select('day, track')
    .eq('uid', uid)
    .eq('pass_id', pass.id);

  const claimedSet    = new Set((claims || []).map(c => `${c.day}-${c.track}`));
  const unlockedDays  = calcUnlockedDays(pass);
  const daysRemaining = Math.max(0,
    Math.ceil((new Date(pass.ends_at) - new Date()) / 86400000)
  );

  const rewardsWithStatus = (rewards || []).map(r => ({
    ...r,
    unlocked:        r.day <= unlockedDays,
    claimed_free:    claimedSet.has(`${r.day}-free`),
    claimed_premium: claimedSet.has(`${r.day}-premium`),
  }));

  res.json({
    pass,
    rewards:        rewardsWithStatus,
    is_premium:     userPass?.is_premium || false,
    unlocked_days:  unlockedDays,
    days_remaining: daysRemaining,
  });
});

// ── POST /api/battlepass/buy ────────────
// 購買通行證（扣鑽石）
router.post('/buy', requireAuth, async (req, res) => {
  const uid  = req.user.uid;
  const pass = await getActivePass();
  if (!pass) return res.status(404).json({ error: '目前沒有進行中的通行證' });

  // 確認尚未購買
  const { data: existing } = await supabase
    .from('user_battle_pass')
    .select('is_premium')
    .eq('uid', uid)
    .eq('pass_id', pass.id)
    .maybeSingle();
  if (existing?.is_premium) return res.status(400).json({ error: '已購買通行證' });

  // 確認鑽石足夠
  const { data: user } = await supabase
    .from('users')
    .select('diamond_balance')
    .eq('uid', uid)
    .single();
  if ((user?.diamond_balance || 0) < pass.premium_price)
    return res.status(400).json({ error: `鑽石不足，需要 ${pass.premium_price} 💎` });

  // 扣鑽石
  const { error: deductErr } = await supabase.rpc('update_diamonds_atomic', {
    p_uid:    uid,
    p_delta:  -pass.premium_price,
    p_reason: `購買月見通行證 ${pass.season}`,
  });
  if (deductErr) return res.status(500).json({ error: deductErr.message });

  // 升級為付費
  await supabase
    .from('user_battle_pass')
    .upsert({ uid, pass_id: pass.id, is_premium: true, purchased_at: new Date().toISOString() });

  res.json({ ok: true, message: '通行證已啟用！👑 所有付費獎勵已解鎖' });
});

// ── POST /api/battlepass/claim ──────────
// 領取單日獎勵（free 或 premium）
router.post('/claim', requireAuth, async (req, res) => {
  const uid   = req.user.uid;
  const { day, track } = req.body;

  if (!day || !['free', 'premium'].includes(track))
    return res.status(400).json({ error: '參數錯誤' });

  const pass = await getActivePass();
  if (!pass) return res.status(404).json({ error: '目前沒有進行中的通行證' });

  // 確認天數已解鎖
  if (day > calcUnlockedDays(pass))
    return res.status(400).json({ error: '該日尚未解鎖' });

  // 付費軌道：確認已購買
  if (track === 'premium') {
    const { data: up } = await supabase
      .from('user_battle_pass')
      .select('is_premium')
      .eq('uid', uid)
      .eq('pass_id', pass.id)
      .maybeSingle();
    if (!up?.is_premium)
      return res.status(403).json({ error: '尚未購買通行證' });
  }

  // 取得獎勵定義
  const { data: reward } = await supabase
    .from('battle_pass_rewards')
    .select('*')
    .eq('pass_id', pass.id)
    .eq('day', day)
    .maybeSingle();
  if (!reward) return res.status(404).json({ error: '找不到獎勵設定' });

  // 插入領取記錄（UNIQUE 防重複）
  const { error: claimErr } = await supabase
    .from('user_battle_pass_claims')
    .insert({ uid, pass_id: pass.id, day, track });
  if (claimErr) {
    if (claimErr.code === '23505')
      return res.status(400).json({ error: '此獎勵已領取過' });
    return res.status(500).json({ error: claimErr.message });
  }

  // 發放獎勵
  const type   = track === 'free' ? reward.free_type    : reward.premium_type;
  const amount = track === 'free' ? reward.free_amount  : reward.premium_amount;
  const label  = track === 'free' ? '免費獎勵' : '通行證獎勵';

  if (type === 'coins' && amount > 0) {
    await updateCoins(uid, amount, `月見通行證 第${day}天 ${label}`);
  } else if (type === 'diamonds' && amount > 0) {
    await supabase.rpc('update_diamonds_atomic', {
      p_uid:    uid,
      p_delta:  amount,
      p_reason: `月見通行證 第${day}天 ${label}`,
    });
  }

  const icon = type === 'coins' ? '🪙' : '💎';
  res.json({ ok: true, type, amount, message: `領取 ${icon} ${amount.toLocaleString()}` });
});

module.exports = router;
