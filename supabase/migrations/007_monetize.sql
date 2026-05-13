-- ════════════════════════════════════════
--  007_monetize.sql  —  變現 & 活動系統
--  執行方法：Supabase SQL Editor → 貼上執行
-- ════════════════════════════════════════

-- ── 月卡 ────────────────────────────────
CREATE TABLE IF NOT EXISTS monthly_passes (
  uid           UUID PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  daily_coins   INTEGER     NOT NULL DEFAULT 500,
  last_claimed  DATE,                          -- 上次領取日期（台灣時間 DATE）
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── 推薦碼 ──────────────────────────────
CREATE TABLE IF NOT EXISTS referral_codes (
  code       TEXT PRIMARY KEY,
  owner_uid  UUID NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS referrals (
  id           BIGSERIAL PRIMARY KEY,
  code         TEXT NOT NULL,
  referrer_uid UUID NOT NULL REFERENCES users(uid),
  referred_uid UUID NOT NULL UNIQUE,          -- 每個帳號只能被推薦一次
  reward_coins INTEGER NOT NULL DEFAULT 1000,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ── 限時活動 ────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT,
  type        TEXT    NOT NULL DEFAULT 'coin_bonus',
              -- coin_bonus | rp_bonus | double_win
  multiplier  NUMERIC(4,2) NOT NULL DEFAULT 1.5,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── RLS ─────────────────────────────────
ALTER TABLE monthly_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE events          ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- monthly_passes
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='monthly_passes' AND policyname='mp_self') THEN
    CREATE POLICY "mp_self"    ON monthly_passes FOR SELECT USING (uid = auth.uid()::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='monthly_passes' AND policyname='mp_service') THEN
    CREATE POLICY "mp_service" ON monthly_passes FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- referral_codes
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='referral_codes' AND policyname='rc_read') THEN
    CREATE POLICY "rc_read"    ON referral_codes FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='referral_codes' AND policyname='rc_service') THEN
    CREATE POLICY "rc_service" ON referral_codes FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- referrals
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='referrals' AND policyname='ref_service') THEN
    CREATE POLICY "ref_service" ON referrals FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- events
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='events' AND policyname='events_read') THEN
    CREATE POLICY "events_read"    ON events FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='events' AND policyname='events_service') THEN
    CREATE POLICY "events_service" ON events FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 索引 ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_referral_codes_owner ON referral_codes(owner_uid);
CREATE INDEX IF NOT EXISTS idx_events_active        ON events(active, starts_at, ends_at);

-- ── 範例活動（可刪除） ───────────────────
INSERT INTO events (name, description, type, multiplier, starts_at, ends_at, active)
VALUES (
  '🎉 開幕慶典活動',
  '遊戲結算金幣 ×1.5！限時 7 天',
  'coin_bonus', 1.5,
  now(), now() + interval '7 days',
  true
) ON CONFLICT DO NOTHING;
