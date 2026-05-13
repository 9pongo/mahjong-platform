-- ════════════════════════════════════════
--  008_push.sql  — Web Push 訂閱資料表
-- ════════════════════════════════════════

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  uid        UUID        NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  endpoint   TEXT        NOT NULL UNIQUE,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_uid ON push_subscriptions(uid);
