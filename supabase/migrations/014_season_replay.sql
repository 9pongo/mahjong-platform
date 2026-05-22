-- ════════════════════════════════════════
--  014_season_replay.sql
--  ① rank_history 加賽季獎勵欄位
--  ② game_moves 牌局完整步驟表（回放用）
-- ════════════════════════════════════════

-- ① rank_history 補充獎勵欄位
ALTER TABLE rank_history
  ADD COLUMN IF NOT EXISTS reward_coins    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_diamonds INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rewarded_at     TIMESTAMPTZ;

-- 確保 (uid, season) 唯一索引（upsert 用）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rank_history_uid_season_key'
  ) THEN
    ALTER TABLE rank_history ADD CONSTRAINT rank_history_uid_season_key UNIQUE (uid, season);
  END IF;
END $$;

-- ② game_moves：每局的逐步操作記錄
CREATE TABLE IF NOT EXISTS game_moves (
  id        BIGSERIAL PRIMARY KEY,
  room_id   TEXT        NOT NULL,
  seq       INTEGER     NOT NULL,   -- 動作序號（0起）
  seat      TEXT        NOT NULL,   -- 'east'|'south'|'west'|'north'
  action    TEXT        NOT NULL,   -- 'draw'|'discard'|'pong'|'kong'|'chow'|'hu'|'exhaust'
  tile_name TEXT,                   -- 相關牌名（出牌/摸牌用）
  extra     JSONB       DEFAULT '{}',
  ts        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS game_moves_room_seq ON game_moves (room_id, seq);

-- game_records 補充 room_id 欄位（若不存在）
ALTER TABLE game_records
  ADD COLUMN IF NOT EXISTS room_id TEXT;

CREATE INDEX IF NOT EXISTS game_records_room_id ON game_records (room_id);
