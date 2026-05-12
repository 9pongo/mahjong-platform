-- ════════════════════════════════════════
--  supabase/seed.sql
--  初始資料（道館 + Supabase RPC）
--  在 schema.sql 執行後執行
-- ════════════════════════════════════════

-- ── 道館定義 ─────────────────────────────
INSERT INTO dojos (dojo_id, region_name, required_wins, unlock_condition, order_index) VALUES
  ('village',  '新手村',     3,  NULL,       1),
  ('town',     '小鎮廣場',   5,  'village',  2),
  ('teahouse', '江湖茶館',   5,  'town',     3),
  ('hall',     '天下第一廳', 7,  'teahouse', 4),
  ('throne',   '麻將王座',   10, 'hall',     5)
ON CONFLICT (dojo_id) DO NOTHING;

-- ── 每日購買計數 RPC ─────────────────────
-- 用於 shopService._creditCoins() 的 increment
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

-- ── 排行榜 View（Phase 6 用）────────────
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  u.uid,
  u.username,
  u.vip_level,
  u.game_level,
  u.coins,
  COALESCE(r.total_wins, 0) AS total_wins,
  COALESCE(r.total_games, 0) AS total_games
FROM users u
LEFT JOIN (
  SELECT uid,
    COUNT(*) FILTER (WHERE win_lose_coins > 0) AS total_wins,
    COUNT(*) AS total_games
  FROM game_records
  GROUP BY uid
) r ON r.uid = u.uid
ORDER BY total_wins DESC, u.coins DESC;
