-- ════════════════════════════════════════
--  supabase/migrations/002_rpcs_and_views.sql
--  在 Supabase SQL Editor 執行（schema.sql 之後）
--  包含：
--   1. update_coins_atomic  — 原子金幣異動（FOR UPDATE 鎖）
--   2. increment_purchase_count — 每日購買計數（ON CONFLICT DO UPDATE）
--   3. leaderboard view     — 勝場 + 金幣排行
-- ════════════════════════════════════════

-- ── 1. 原子金幣異動 ───────────────────────
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

  UPDATE users SET coins = v_new WHERE uid = p_uid;

  INSERT INTO coin_ledger (uid, delta, reason, balance)
  VALUES (p_uid, p_delta, p_reason, v_new);

  RETURN jsonb_build_object('ok', true, 'new_balance', v_new);
END;
$$;

-- ── 2. 每日購買計數 ───────────────────────
CREATE OR REPLACE FUNCTION increment_purchase_count(
  p_uid         uuid,
  p_product_id  text,
  p_date        date
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO daily_purchase_log (uid, product_id, purchase_date, count)
  VALUES (p_uid, p_product_id, p_date, 1)
  ON CONFLICT (uid, product_id, purchase_date)
  DO UPDATE SET count = daily_purchase_log.count + 1;
END;
$$;

-- ── 3. 排行榜 View ────────────────────────
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  u.uid,
  u.username,
  u.vip_level,
  u.game_level,
  u.coins,
  COALESCE(r.total_wins,  0) AS total_wins,
  COALESCE(r.total_games, 0) AS total_games
FROM users u
LEFT JOIN (
  SELECT uid,
    COUNT(*) FILTER (WHERE win_lose_coins > 0) AS total_wins,
    COUNT(*)                                   AS total_games
  FROM game_records
  GROUP BY uid
) r ON r.uid = u.uid
ORDER BY total_wins DESC, u.coins DESC;
