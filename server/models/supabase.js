// ════════════════════════════════════════
//  server/models/supabase.js  —  Supabase 連線單例
// ════════════════════════════════════════
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // service key 繞過 RLS（後端用）
);

module.exports = supabase;
