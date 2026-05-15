// ════════════════════════════════════════
//  server/routes/giftcode.js
//  禮品序號（Gift Code）兌換
// ════════════════════════════════════════
const router   = require('express').Router();
const supabase = require('../models/supabase');
const { requireAuth } = require('../middleware/auth');
const { updateCoins }    = require('../services/coinService');

// ── POST /api/giftcode/redeem ─────────────
// 兌換禮品序號（不需特殊 UI，API 端點即可）
router.post('/redeem', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string')
    return res.status(400).json({ error: '請提供序號' });

  const normalizedCode = code.trim().toUpperCase();
  const uid = req.user.uid;

  // ① 查詢序號是否存在
  const { data: gc, error: gcErr } = await supabase
    .from('gift_codes')
    .select()
    .eq('code', normalizedCode)
    .maybeSingle();

  if (gcErr || !gc)
    return res.status(404).json({ error: '序號不存在或已失效' });

  // ② 有效期檢查
  if (gc.expires_at && new Date(gc.expires_at) < new Date())
    return res.status(400).json({ error: '序號已過期' });

  // ③ 使用次數上限
  if (gc.max_uses !== null && gc.uses_count >= gc.max_uses)
    return res.status(400).json({ error: '序號已達使用次數上限' });

  // ④ 重複兌換檢查（每人每序號只能兌換一次）
  const { data: dup } = await supabase
    .from('gift_code_redemptions')
    .select('id')
    .eq('code', normalizedCode)
    .eq('uid', uid)
    .maybeSingle();

  if (dup)
    return res.status(409).json({ error: '此序號您已兌換過' });

  // ── 發放獎勵 ────────────────────────────
  const rewards   = [];
  let   goldAdded = 0;
  let   diamAdded = 0;

  // 金幣
  if (gc.gold_reward > 0) {
    const { ok, error: coinErr } = await updateCoins(uid, gc.gold_reward, `giftcode_${normalizedCode}`);
    if (!ok) return res.status(500).json({ error: coinErr || '金幣發放失敗' });
    goldAdded = gc.gold_reward;
    rewards.push(`${gc.gold_reward} 金幣`);

    // 寫 coin_ledger
    const { data: u } = await supabase.from('users').select('coins').eq('uid', uid).single();
    await supabase.from('coin_ledger').insert({
      uid,
      delta:         gc.gold_reward,
      reason:        `gift_code:${normalizedCode}`,
      type:          'gift_code',
      balance_after: u?.coins ?? 0,
      ref_id:        normalizedCode,
    });
  }

  // 鑽石（使用 Postgres RPC 原子操作）
  if (gc.diamond_reward > 0) {
    const { data: dResult, error: dErr } = await supabase.rpc('update_diamonds_atomic', {
      p_uid:    uid,
      p_delta:  gc.diamond_reward,
      p_reason: `giftcode_${normalizedCode}`,
    });
    if (dErr || !dResult?.ok) {
      // 鑽石失敗不回滾金幣（視為部分成功），記錄 log
      console.error(`[GiftCode] diamond award failed for uid=${uid} code=${normalizedCode}:`, dErr?.message || dResult?.error);
    } else {
      diamAdded = gc.diamond_reward;
      rewards.push(`${gc.diamond_reward} 鑽石`);
      // 寫 diamond_ledger
      await supabase.from('diamond_ledger').insert({
        uid,
        delta:         gc.diamond_reward,
        reason:        `gift_code:${normalizedCode}`,
        balance_after: dResult.new_balance ?? 0,
        ref_id:        normalizedCode,
      });
    }
  }

  // ── 記錄兌換 + 更新使用次數（原子性處理：先記錄再 +1）
  await supabase.from('gift_code_redemptions').insert({
    code:        normalizedCode,
    uid,
    redeemed_at: new Date().toISOString(),
  });

  await supabase.from('gift_codes')
    .update({ uses_count: gc.uses_count + 1 })
    .eq('code', normalizedCode);

  const rewardStr = rewards.length ? rewards.join(' + ') : '（無獎勵）';
  res.json({
    ok: true,
    message:        `序號兌換成功！獲得：${rewardStr}`,
    diamonds_added: diamAdded,
    gold_added:     goldAdded,
  });
});

module.exports = router;
