-- ════════════════════════════════════════
--  013_v15.sql  — 雙幣 / 帳號安全 / 社交補強
--  執行方法：Supabase SQL Editor → 貼上執行
-- ════════════════════════════════════════

-- ── 0. shop_purchases 擴充 ───────────────
ALTER TABLE shop_purchases
  ADD COLUMN IF NOT EXISTS diamonds_received INT NOT NULL DEFAULT 0;

-- ── 1. 用戶表擴充 ────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS diamond_balance   INT         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vault_coins       INT         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vault_total_in    INT         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS phone             TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status            TEXT        NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tos_agreed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS social_fb         TEXT,
  ADD COLUMN IF NOT EXISTS social_ig         TEXT,
  ADD COLUMN IF NOT EXISTS social_line       TEXT,
  ADD COLUMN IF NOT EXISTS social_fb_public  BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS social_ig_public  BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS social_line_public BOOLEAN    NOT NULL DEFAULT false;

-- 一機一帳號（active 帳號中手機唯一）
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_active
  ON users (phone)
  WHERE phone IS NOT NULL AND status = 'active';

-- ── 2. 鑽石帳本 ──────────────────────────
CREATE TABLE IF NOT EXISTS diamond_ledger (
  id            BIGSERIAL    PRIMARY KEY,
  uid           UUID         REFERENCES users(uid) ON DELETE SET NULL,
  delta         INT          NOT NULL,
  balance_after INT          NOT NULL,
  type          TEXT         NOT NULL,
  ref_id        TEXT,
  note          TEXT,
  operator_uid  UUID         REFERENCES users(uid) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dl_uid  ON diamond_ledger(uid);
CREATE INDEX IF NOT EXISTS idx_dl_type ON diamond_ledger(type);

-- ── 3. 金幣帳本升級（相容舊版）──────────────
-- coin_ledger 可能已存在（舊版欄位：uid, delta, reason, balance）
-- CREATE TABLE IF NOT EXISTS 負責全新安裝；ALTER TABLE 負責升級現有表
CREATE TABLE IF NOT EXISTS coin_ledger (
  id            BIGSERIAL    PRIMARY KEY,
  uid           UUID         REFERENCES users(uid) ON DELETE SET NULL,
  delta         INT          NOT NULL,
  balance_after INT,
  type          TEXT         NOT NULL DEFAULT 'legacy',
  ref_id        TEXT,
  note          TEXT,
  operator_uid  UUID         REFERENCES users(uid) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  DEFAULT now()
);
-- 補充舊版缺少的欄位（IF NOT EXISTS 保冪等）
ALTER TABLE coin_ledger ADD COLUMN IF NOT EXISTS balance_after INT;
ALTER TABLE coin_ledger ADD COLUMN IF NOT EXISTS type          TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE coin_ledger ADD COLUMN IF NOT EXISTS ref_id        TEXT;
ALTER TABLE coin_ledger ADD COLUMN IF NOT EXISTS note          TEXT;
ALTER TABLE coin_ledger ADD COLUMN IF NOT EXISTS operator_uid  UUID REFERENCES users(uid) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cl_uid  ON coin_ledger(uid);
CREATE INDEX IF NOT EXISTS idx_cl_type ON coin_ledger(type);

-- ── 4. 商店產品表 ─────────────────────────
CREATE TABLE IF NOT EXISTS shop_products (
  id               SERIAL       PRIMARY KEY,
  name             TEXT         NOT NULL,
  description      TEXT,
  type             TEXT         NOT NULL DEFAULT 'gold_package',
  diamond_price    INT          NOT NULL,
  gold_coins       INT,
  tournament_type  TEXT,
  discount_pct     NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  discount_starts  TIMESTAMPTZ,
  discount_ends    TIMESTAMPTZ,
  sort_order       INT          NOT NULL DEFAULT 0,
  active           BOOLEAN      NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ  DEFAULT now()
);

INSERT INTO shop_products (name, type, diamond_price, gold_coins, sort_order) VALUES
  ('100 金幣禮包',  'gold_package',  100,  100,  1),
  ('500 金幣禮包',  'gold_package',  500,  500,  2),
  ('1000 金幣禮包', 'gold_package',  1000, 1000, 3),
  ('3000 金幣禮包', 'gold_package',  2800, 3000, 4),
  ('5000 金幣禮包', 'gold_package',  4500, 5000, 5)
ON CONFLICT DO NOTHING;

-- ── 5. 帳號刪除紀錄 ──────────────────────
CREATE TABLE IF NOT EXISTS account_deletions (
  uid              UUID         PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  requested_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  scheduled_purge  TIMESTAMPTZ  NOT NULL,
  restored_at      TIMESTAMPTZ,
  restored_by      UUID         REFERENCES users(uid) ON DELETE SET NULL,
  note             TEXT
);

-- ── 6. 序號禮包 ───────────────────────────
CREATE TABLE IF NOT EXISTS gift_codes (
  code           TEXT         PRIMARY KEY,
  diamond_reward INT          NOT NULL DEFAULT 0,
  gold_reward    INT          NOT NULL DEFAULT 0,
  max_uses       INT,
  uses_count     INT          NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ,
  created_by     UUID         REFERENCES users(uid) ON DELETE SET NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ  DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gift_code_redemptions (
  id          BIGSERIAL    PRIMARY KEY,
  code        TEXT         NOT NULL REFERENCES gift_codes(code),
  uid         UUID         NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (code, uid)
);

-- ── 7. 手機驗證 OTP 暫存 ─────────────────
CREATE TABLE IF NOT EXISTS phone_otps (
  id          BIGSERIAL    PRIMARY KEY,
  uid         UUID         NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  phone       TEXT         NOT NULL,
  code        TEXT         NOT NULL,
  purpose     TEXT         NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  used        BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_uid ON phone_otps(uid, purpose);

-- ── 8. RLS ────────────────────────────────
ALTER TABLE diamond_ledger        ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_ledger           ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_deletions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_codes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_code_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_otps            ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='diamond_ledger' AND policyname='dl_self') THEN
    CREATE POLICY "dl_self"    ON diamond_ledger FOR SELECT USING (uid = auth.uid()::uuid); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='diamond_ledger' AND policyname='dl_service') THEN
    CREATE POLICY "dl_service" ON diamond_ledger FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='coin_ledger' AND policyname='cl_self') THEN
    CREATE POLICY "cl_self"    ON coin_ledger FOR SELECT USING (uid = auth.uid()::uuid); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='coin_ledger' AND policyname='cl_service') THEN
    CREATE POLICY "cl_service" ON coin_ledger FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shop_products' AND policyname='sp_read') THEN
    CREATE POLICY "sp_read"    ON shop_products FOR SELECT USING (active = true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shop_products' AND policyname='sp_service') THEN
    CREATE POLICY "sp_service" ON shop_products FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='gift_codes' AND policyname='gc_service') THEN
    CREATE POLICY "gc_service" ON gift_codes FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='gift_code_redemptions' AND policyname='gcr_service') THEN
    CREATE POLICY "gcr_service" ON gift_code_redemptions FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='account_deletions' AND policyname='ad_service') THEN
    CREATE POLICY "ad_service" ON account_deletions FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='phone_otps' AND policyname='otp_service') THEN
    CREATE POLICY "otp_service" ON phone_otps FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;

-- ── 9. 鑽石原子操作 RPC ──────────────────
CREATE OR REPLACE FUNCTION update_diamonds_atomic(
  p_uid    UUID,
  p_delta  INT,
  p_reason TEXT DEFAULT ''
) RETURNS JSONB AS $$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT diamond_balance INTO v_current
  FROM users WHERE uid = p_uid FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '找不到用戶');
  END IF;

  v_new := v_current + p_delta;

  IF v_new < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '鑽石不足');
  END IF;

  UPDATE users SET diamond_balance = v_new WHERE uid = p_uid;

  RETURN jsonb_build_object('ok', true, 'new_balance', v_new);
END;
$$ LANGUAGE plpgsql;
