-- ════════════════════════════════════════
--  supabase/migrations/005_achievements.sql
--  成就系統 + 公告系統
--  在 Supabase SQL Editor 執行
-- ════════════════════════════════════════

-- ── 1. 玩家成就解鎖紀錄 ───────────────────
CREATE TABLE IF NOT EXISTS user_achievements (
  id           bigserial   PRIMARY KEY,
  uid          uuid        NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  achievement  text        NOT NULL,   -- achievement id (e.g. 'first_game')
  unlocked_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (uid, achievement)            -- 每個成就只解鎖一次
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_uid ON user_achievements(uid);

-- ── 2. RLS：只能看自己的成就 ─────────────
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_achievements' AND policyname = 'self_read'
  ) THEN
    CREATE POLICY self_read ON user_achievements
      FOR SELECT USING (uid = auth.uid());
  END IF;
END $$;

-- service_role 可讀寫（後端用）
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_achievements' AND policyname = 'service_full'
  ) THEN
    CREATE POLICY service_full ON user_achievements
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 3. 公告系統 ──────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id         bigserial   PRIMARY KEY,
  title      text        NOT NULL,
  content    text        NOT NULL DEFAULT '',
  type       text        NOT NULL DEFAULT 'info',   -- info | warn | event
  pinned     boolean     NOT NULL DEFAULT false,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(active, created_at DESC)
  WHERE active = true;
