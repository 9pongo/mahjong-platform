#!/usr/bin/env node
// ════════════════════════════════════════
//  scripts/smoke-test.js
//  部署後煙霧測試 — 驗證關鍵 API 端點
//  執行：node scripts/smoke-test.js [BASE_URL]
//  例如：node scripts/smoke-test.js https://mahjong-xxx.up.railway.app
//        node scripts/smoke-test.js http://localhost:3000
// ════════════════════════════════════════

const BASE = process.argv[2] || 'http://localhost:3000';

let passed = 0;
let failed = 0;
let _token  = '';
let _uid    = '';

async function req(method, path, body, authToken) {
  const url = BASE + path;
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

function pass(label) {
  console.log(`  ✅  ${label}`);
  passed++;
}

function fail(label, detail) {
  console.log(`  ❌  ${label}  ← ${detail}`);
  failed++;
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 42 - title.length))}`);
}

// ═══════════════════════════════════════
//  測試項目
// ═══════════════════════════════════════

async function testHealth() {
  section('健康檢查');
  const { status, data } = await req('GET', '/api/health');
  if (status === 200 && data.ok === true) pass('GET /api/health → ok');
  else fail('GET /api/health', `status=${status}`);
}

async function testRegisterGuest() {
  section('遊客註冊 / 登入');
  const { status, data } = await req('POST', '/api/auth/register-guest');
  if (status === 200 && data.token && data.user?.uid) {
    pass('POST /api/auth/register-guest → token + user');
    _token = data.token;
    _uid   = data.user.uid;
  } else {
    fail('POST /api/auth/register-guest', `status=${status} data=${JSON.stringify(data)}`);
  }
}

async function testGetMe() {
  section('取得自身資料');
  const { status, data } = await req('GET', '/api/auth/me', null, _token);
  if (status === 200 && data.uid === _uid) pass('GET /api/auth/me → uid match');
  else fail('GET /api/auth/me', `status=${status}`);
}

async function testUserStats() {
  section('玩家資料');
  const { status: s1 } = await req('GET', '/api/user/profile', null, _token);
  if (s1 === 200) pass('GET /api/user/profile');
  else fail('GET /api/user/profile', `status=${s1}`);

  const { status: s2, data: d2 } = await req('GET', '/api/user/vip-info', null, _token);
  if (s2 === 200 && 'vip_level' in d2) pass('GET /api/user/vip-info → vip_level');
  else fail('GET /api/user/vip-info', `status=${s2}`);
}

async function testReward() {
  section('每日獎勵');
  const { status, data } = await req('GET', '/api/reward/daily-status', null, _token);
  if (status === 200 && 'spinClaimed' in data) pass('GET /api/reward/daily-status');
  else fail('GET /api/reward/daily-status', `status=${status}`);

  const { status: s2, data: d2 } = await req('POST', '/api/reward/spin', {}, _token);
  if (s2 === 200 && d2.coins !== undefined) pass('POST /api/reward/spin → coins');
  else if (s2 === 400 && d2.error) pass(`POST /api/reward/spin → 已領取 (${d2.error})`);
  else fail('POST /api/reward/spin', `status=${s2}`);
}

async function testQuest() {
  section('任務系統');
  const { status, data } = await req('GET', '/api/quest', null, _token);
  if (status === 200 && Array.isArray(data.quests) && data.quests.length > 0)
    pass(`GET /api/quest → ${data.quests.length} 筆任務`);
  else fail('GET /api/quest', `status=${status}`);
}

async function testShop() {
  section('商城');
  const { status, data } = await req('GET', '/api/shop/products', null, _token);
  if (status === 200 && Array.isArray(data.products) && data.products.length > 0) {
    pass(`GET /api/shop/products → ${data.products.length} 件商品 (mock=${data.isMock})`);
  } else {
    fail('GET /api/shop/products', `status=${status}`);
    return;
  }

  // 購買最小商品（mock 模式直接到帳）
  const { status: s2, data: d2 } = await req('POST', '/api/shop/order', { productId: 'coins_1' }, _token);
  if (s2 === 200 && (d2.mock === true || d2.ecpayUrl)) pass('POST /api/shop/order → order created');
  else fail('POST /api/shop/order', `status=${s2} ${JSON.stringify(d2)}`);
}

async function testDojo() {
  section('道館');
  const { status, data } = await req('GET', '/api/dojo', null, _token);
  if (status === 200 && Array.isArray(data.dojos) && data.dojos.length === 5)
    pass(`GET /api/dojo → 5 個道館`);
  else fail('GET /api/dojo', `status=${status} dojos=${data.dojos?.length}`);
}

async function testFriend() {
  section('好友 / 公會');
  const { status: sf } = await req('GET', '/api/friend', null, _token);
  if (sf === 200) pass('GET /api/friend');
  else fail('GET /api/friend', `status=${sf}`);

  const { status: sg } = await req('GET', '/api/guild/my', null, _token);
  if (sg === 200) pass('GET /api/guild/my');
  else fail('GET /api/guild/my', `status=${sg}`);

  const { status: sl } = await req('GET', '/api/guild/list', null, _token);
  if (sl === 200) pass('GET /api/guild/list');
  else fail('GET /api/guild/list', `status=${sl}`);
}

async function testAuth401() {
  section('未授權保護');
  const { status } = await req('GET', '/api/auth/me');    // 無 token
  if (status === 401) pass('GET /api/auth/me 無 token → 401');
  else fail('401 保護', `預期 401，收到 ${status}`);
}

// ═══════════════════════════════════════
//  執行
// ═══════════════════════════════════════
(async () => {
  console.log(`\n🀄 Smoke Test — ${BASE}`);
  console.log(`   時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);

  await testHealth();
  await testRegisterGuest();
  if (_token) {
    await testGetMe();
    await testUserStats();
    await testReward();
    await testQuest();
    await testShop();
    await testDojo();
    await testFriend();
  }
  await testAuth401();

  console.log(`\n══════ 結果 ══════`);
  console.log(`  ✅ 通過：${passed}`);
  console.log(`  ❌ 失敗：${failed}`);
  console.log(`  合計：${passed + failed}`);
  console.log(`══════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
})();
