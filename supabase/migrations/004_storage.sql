-- ════════════════════════════════════════
--  supabase/migrations/004_storage.sql
--  頭像上傳 + 遊戲記錄索引
--  在 Supabase SQL Editor 執行
-- ════════════════════════════════════════

-- ── 1. 建立 avatars Storage Bucket ────────
-- 須先到 Supabase Dashboard → Storage → New Bucket
--   名稱：avatars
--   Public：✅ 開啟（讓前端可直接讀取圖片 URL）
--   File size limit：512000（500 KB）
--   Allowed MIME types：image/jpeg,image/png,image/webp
--
-- 或執行下方 SQL（Supabase 新版支援）：
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  512000,
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 512000,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

-- ── 2. Storage RLS：已登入用戶可上傳自己的頭像 ──
-- 只允許上傳 <uid>.* 格式（Server-side 以 service_role 上傳，跳過此限制）
-- 前端不直接上傳，統一走 /api/user/avatar → Server → Supabase Storage (service_role)
-- 因此只需設定 public read

CREATE POLICY "Avatar public read"
  ON storage.objects FOR SELECT
  USING ( bucket_id = 'avatars' );

-- ── 3. game_records 索引補充 ──────────────
CREATE INDEX IF NOT EXISTS idx_game_records_uid_played
  ON game_records(uid, played_at DESC);

-- ── 4. users 新增 avatar_url 欄位（若不存在）─
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url text;
