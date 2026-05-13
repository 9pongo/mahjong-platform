-- ════════════════════════════════════════
--  011_analytics.sql
--  前端行為埋點事件表
-- ════════════════════════════════════════

CREATE TABLE IF NOT EXISTS analytics_events (
  id          BIGSERIAL    PRIMARY KEY,
  uid         UUID         REFERENCES users(uid) ON DELETE SET NULL,
  event_name  TEXT         NOT NULL,
  properties  JSONB        DEFAULT '{}',
  page        TEXT,
  session_id  TEXT,
  ts          TIMESTAMPTZ  DEFAULT now()
);

-- 查詢常用索引
CREATE INDEX IF NOT EXISTS idx_analytics_event_name ON analytics_events (event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_uid        ON analytics_events (uid);
CREATE INDEX IF NOT EXISTS idx_analytics_ts         ON analytics_events (ts);

-- 自動清理 90 天前的舊資料（RLS policy 可視需要加）
-- 定期在 cron 執行：DELETE FROM analytics_events WHERE ts < now() - interval '90 days';
