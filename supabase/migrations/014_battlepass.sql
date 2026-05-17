-- ══════════════════════════════════════
--  014_battlepass.sql
--  月見通行證（Battle Pass）系統
-- ══════════════════════════════════════

-- 1. 賽季定義
CREATE TABLE IF NOT EXISTS battle_passes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  season         TEXT NOT NULL,                    -- 'YYYY-MM'
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ NOT NULL,
  premium_price  INT NOT NULL DEFAULT 300,         -- 鑽石購買通行證
  active         BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT now()
);
-- 同時只能一個 active 賽季
CREATE UNIQUE INDEX IF NOT EXISTS battle_passes_one_active
  ON battle_passes(active) WHERE active = true;

-- 2. 每日獎勵定義（1-30天）
CREATE TABLE IF NOT EXISTS battle_pass_rewards (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id        UUID NOT NULL REFERENCES battle_passes(id) ON DELETE CASCADE,
  day            INT NOT NULL CHECK (day BETWEEN 1 AND 30),
  free_type      TEXT NOT NULL DEFAULT 'coins'
                   CHECK (free_type IN ('coins','diamonds','none')),
  free_amount    INT NOT NULL DEFAULT 0,
  premium_type   TEXT NOT NULL DEFAULT 'coins'
                   CHECK (premium_type IN ('coins','diamonds','none')),
  premium_amount INT NOT NULL DEFAULT 0,
  UNIQUE(pass_id, day)
);

-- 3. 玩家通行證（免費自動加入；付費需購買）
CREATE TABLE IF NOT EXISTS user_battle_pass (
  uid          UUID NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  pass_id      UUID NOT NULL REFERENCES battle_passes(id) ON DELETE CASCADE,
  is_premium   BOOLEAN NOT NULL DEFAULT false,
  purchased_at TIMESTAMPTZ,
  PRIMARY KEY(uid, pass_id)
);

-- 4. 玩家每日領取記錄
CREATE TABLE IF NOT EXISTS user_battle_pass_claims (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid        UUID NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  pass_id    UUID NOT NULL REFERENCES battle_passes(id) ON DELETE CASCADE,
  day        INT NOT NULL,
  track      TEXT NOT NULL CHECK (track IN ('free','premium')),
  claimed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(uid, pass_id, day, track)
);

-- ── 插入 2026-05 首賽季 ───────────────────────
INSERT INTO battle_passes (name, season, starts_at, ends_at, premium_price, active)
VALUES (
  '月見通行證 — 2026年5月',
  '2026-05',
  '2026-05-01 00:00:00+08',
  '2026-05-31 23:59:59+08',
  300,
  true
) ON CONFLICT DO NOTHING;

-- 插入 30 天獎勵
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM battle_passes WHERE season = '2026-05';
  IF v_id IS NULL THEN RETURN; END IF;

  INSERT INTO battle_pass_rewards
    (pass_id, day, free_type, free_amount, premium_type, premium_amount)
  VALUES
  -- 第1週
  (v_id,  1, 'coins',    100, 'coins',    500),
  (v_id,  2, 'coins',     50, 'coins',    200),
  (v_id,  3, 'coins',    100, 'coins',    300),
  (v_id,  4, 'coins',     50, 'coins',    200),
  (v_id,  5, 'coins',    150, 'coins',    500),
  (v_id,  6, 'coins',     50, 'coins',    200),
  (v_id,  7, 'diamonds',   2, 'diamonds',  10),  -- 週獎
  -- 第2週
  (v_id,  8, 'coins',    100, 'coins',    300),
  (v_id,  9, 'coins',     50, 'coins',    200),
  (v_id, 10, 'coins',    200, 'coins',    600),
  (v_id, 11, 'coins',     50, 'coins',    200),
  (v_id, 12, 'coins',    100, 'coins',    300),
  (v_id, 13, 'coins',     50, 'coins',    200),
  (v_id, 14, 'diamonds',   3, 'diamonds',  20),  -- 雙週獎
  -- 第3週
  (v_id, 15, 'coins',    200, 'coins',    600),
  (v_id, 16, 'coins',     50, 'coins',    200),
  (v_id, 17, 'coins',    100, 'coins',    300),
  (v_id, 18, 'coins',     50, 'coins',    200),
  (v_id, 19, 'coins',    150, 'coins',    500),
  (v_id, 20, 'coins',     50, 'coins',    200),
  (v_id, 21, 'diamonds',   5, 'diamonds',  30),  -- 三週獎
  -- 第4週
  (v_id, 22, 'coins',    100, 'coins',    300),
  (v_id, 23, 'coins',     50, 'coins',    200),
  (v_id, 24, 'coins',    200, 'coins',    600),
  (v_id, 25, 'coins',     50, 'coins',    200),
  (v_id, 26, 'coins',    100, 'coins',    300),
  (v_id, 27, 'coins',     50, 'coins',    200),
  (v_id, 28, 'coins',    150, 'coins',    500),
  (v_id, 29, 'coins',    100, 'coins',    300),
  (v_id, 30, 'diamonds',  10, 'diamonds',  50)   -- 滿月大獎 🌕
  ON CONFLICT DO NOTHING;
END $$;
