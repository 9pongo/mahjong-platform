-- ════════════════════════════════════════
--  006_ranks.sql  —  段位系統
--  執行方法：Supabase SQL Editor → 貼上執行
-- ════════════════════════════════════════

-- 玩家段位（每賽季重置）
CREATE TABLE IF NOT EXISTS user_ranks (
  uid        TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  rp         INTEGER NOT NULL DEFAULT 0,       -- Rank Points
  season     INTEGER NOT NULL DEFAULT 0,       -- yyyyMM，e.g. 202605
  wins       INTEGER NOT NULL DEFAULT 0,
  losses     INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 賽季歷史（每月歸檔）
CREATE TABLE IF NOT EXISTS rank_history (
  id          BIGSERIAL PRIMARY KEY,
  uid         TEXT NOT NULL,
  season      INTEGER NOT NULL,
  final_rp    INTEGER NOT NULL,
  rank_name   TEXT,
  recorded_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE user_ranks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rank_history ENABLE ROW LEVEL SECURITY;

-- 任何人可讀排行（排行榜用）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_ranks' AND policyname='user_ranks_read') THEN
    CREATE POLICY "user_ranks_read"         ON user_ranks  FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_ranks' AND policyname='user_ranks_service') THEN
    CREATE POLICY "user_ranks_service"      ON user_ranks  FOR ALL    USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rank_history' AND policyname='rank_history_read') THEN
    CREATE POLICY "rank_history_read"       ON rank_history FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rank_history' AND policyname='rank_history_service') THEN
    CREATE POLICY "rank_history_service"    ON rank_history FOR ALL    USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 排行榜索引
CREATE INDEX IF NOT EXISTS idx_user_ranks_season_rp ON user_ranks(season, rp DESC);
CREATE INDEX IF NOT EXISTS idx_rank_history_uid     ON rank_history(uid, season DESC);
