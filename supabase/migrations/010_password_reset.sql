-- ════════════════════════════════════════
--  010_password_reset.sql
--  為帳號加入 email 登入 + 密碼重設支援
-- ════════════════════════════════════════

-- 1. 在 users 表加入新欄位（nullable 相容現有遊客帳號）
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email           TEXT,
  ADD COLUMN IF NOT EXISTS password_hash   TEXT,
  ADD COLUMN IF NOT EXISTS reset_token     TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_exp TIMESTAMPTZ;

-- 唯一索引：email 不能重複（NULL 除外）
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
  ON users (email) WHERE email IS NOT NULL;

-- 2. reset_token 也不能重複
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_reset_token
  ON users (reset_token) WHERE reset_token IS NOT NULL;
