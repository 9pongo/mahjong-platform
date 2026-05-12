// ════════════════════════════════════════
//  scripts/alert-webhook.js
//  供 UptimeRobot / Railway Webhook 呼叫的測試工具
//
//  用法：
//   node scripts/alert-webhook.js <BASE_URL> <ADMIN_KEY> [message]
//
//  範例（測試告警接收）：
//   node scripts/alert-webhook.js https://web-production-xxxx.up.railway.app mySecretKey "測試告警"
// ════════════════════════════════════════
const https = require('https');
const http  = require('http');
const url   = require('url');

const BASE     = process.argv[2] || 'http://localhost:3000';
const KEY      = process.argv[3] || '';
const MESSAGE  = process.argv[4] || '手動測試告警';

if (!KEY) {
  console.error('❌ 需要提供 ADMIN_KEY');
  console.error('用法: node scripts/alert-webhook.js <BASE_URL> <ADMIN_KEY> [message]');
  process.exit(1);
}

function request(baseUrl, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed  = url.parse(baseUrl + path);
    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? https : http;
    const data    = body ? JSON.stringify(body) : null;

    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.path,
      method,
      headers: {
        ...headers,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = lib.request(opts, (res) => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`\n🚀 Alert Webhook Test — ${BASE}`);
  console.log(`   金鑰：${KEY.slice(0,4)}****\n`);

  // 1. 測試健康檢查
  try {
    const health = await request(BASE, '/api/health', 'GET', {});
    console.log(`✅ Health: ${JSON.stringify(health.data)}`);
  } catch (e) {
    console.error(`❌ Health check 失敗: ${e.message}`);
    return;
  }

  // 2. 測試統計端點（驗證金鑰）
  try {
    const stats = await request(BASE, '/api/admin/stats', 'GET', { 'x-admin-key': KEY });
    if (stats.status === 403) {
      console.error('❌ ADMIN_KEY 錯誤，403 禁止訪問');
      return;
    }
    console.log(`✅ Stats: 玩家 ${stats.data.totalUsers}, 對局 ${stats.data.totalGames}`);
  } catch (e) {
    console.error(`❌ Stats 失敗: ${e.message}`);
  }

  // 3. 發送告警通知
  try {
    const alert = await request(BASE, '/api/admin/alert', 'POST',
      { 'x-admin-key': KEY },
      { type: 'test', message: MESSAGE, source: 'manual-test' }
    );
    console.log(`✅ Alert sent: ${JSON.stringify(alert.data)}`);
  } catch (e) {
    console.error(`❌ Alert 失敗: ${e.message}`);
  }

  console.log('\n📋 UptimeRobot 設定參考：');
  console.log(`   Monitor URL: ${BASE}/api/health`);
  console.log(`   Alert URL:   ${BASE}/api/admin/alert?key=${KEY}`);
  console.log(`   Method: POST, Body: {"type":"down","message":"服務離線","source":"uptimerobot"}\n`);
}

main();
