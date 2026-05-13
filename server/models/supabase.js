// ════════════════════════════════════════
//  server/models/supabase.js  —  Supabase 連線單例
// ════════════════════════════════════════
const { createClient } = require('@supabase/supabase-js');
const WebSocket        = require('ws');

// Node.js < 22 無原生 WebSocket，需明確傳入 ws 套件
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,   // service key 繞過 RLS（後端用）
  {
    realtime: { transport: WebSocket },
  }
);

module.exports = supabase;
