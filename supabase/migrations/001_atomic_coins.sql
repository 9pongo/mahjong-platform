-- ════════════════════════════════════════
--  supabase/migrations/001_atomic_coins.sql
--  原子金幣更新 RPC — 防止並發競爭條件
--  在 Supabase SQL Editor 執行
-- ════════════════════════════════════════

-- 原子增減金幣（FOR UPDATE 鎖定行）
-- 回傳：{ ok, new_balance, error }
CREATE OR REPLACE FUNCTION update_coins_atomic(
  p_uid    uuid,
  p_delta  bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_current bigint;
  v_new     bigint;
BEGIN
  -- 鎖定該用戶的 row，防止並發修改
  SELECT coins INTO v_current
  FROM users
  WHERE uid = p_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '找不到用戶');
  END IF;

  v_new := v_current + p_delta;

  IF v_new < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '金幣不足');
  END IF;

  -- 更新金幣
  UPDATE users SET coins = v_new WHERE uid = p_uid;

  -- 寫入流水帳
  INSERT INTO coin_ledger (uid, delta, reason, balance)
  VALUES (p_uid, p_delta, p_reason, v_new);

  RETURN jsonb_build_object('ok', true, 'new_balance', v_new);
END;
$$;
