-- ════════════════════════════════════════
--  supabase/migrations/003_admin.sql
--  管理後台相關 schema 補充
--  在 Supabase SQL Editor 執行
-- ════════════════════════════════════════

-- ── 1. users 表新增 is_banned 欄位 ────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_banned boolean NOT NULL DEFAULT false;

-- ── 2. 封禁索引 ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_banned ON users(is_banned)
  WHERE is_banned = true;

-- ── 3. coin_ledger 補 created_at 索引 ─────
CREATE INDEX IF NOT EXISTS idx_coin_ledger_created ON coin_ledger(created_at DESC);

-- ── 4. RLS：只有 Service Role 可以看 coin_ledger 全表
--  （前端透過 /api/admin 路由存取，不直接查 DB）
-- 若已有 RLS 規則不衝突則跳過
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'coin_ledger' AND policyname = 'service_full_access'
  ) THEN
    CREATE POLICY service_full_access ON coin_ledger
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
