// ════════════════════════════════════════
//  tests/rankService.test.js
//  段位計算邏輯測試（不依賴 DB，純函式部分）
// ════════════════════════════════════════

// rankService 透過 supabase.js，需要 stub 環境變數才能 require
process.env.SUPABASE_URL        = process.env.SUPABASE_URL        || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'placeholder_key_for_test';
process.env.JWT_SECRET          = process.env.JWT_SECRET          || 'test_secret';

const { getRankInfo, getCurrentSeason, RANKS } = require('../server/services/rankService');

let _passed = 0;
let _failed = 0;

function assert(cond, label, detail = '') {
  if (cond) { console.log(`  ✅ ${label}`); _passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); _failed++; }
}

// ══════════════════════════════════════
//  getRankInfo
// ══════════════════════════════════════
function testGetRankInfo() {
  console.log('\n── getRankInfo ───────────────────────────');

  const r0 = getRankInfo(0);
  assert(r0.name === '新手', 'RP=0 → 新手');
  assert(r0.minRp === 0, 'minRp=0');
  assert(r0.nextRp > 0, '有下一段位 RP');

  const r1 = getRankInfo(100);
  assert(r1.name === '初段', 'RP=100 → 初段');

  const r3 = getRankInfo(600);
  assert(r3.name === '三段', 'RP=600 → 三段');

  const rMax = getRankInfo(99999);
  assert(rMax.name === '宗師', 'RP 極大值 → 宗師');
  assert(rMax.nextRp === null, '宗師無下一段位');

  // 臨界值
  const rBefore = getRankInfo(99);
  assert(rBefore.name === '新手', 'RP=99 → 仍是新手');
  const rAt = getRankInfo(100);
  assert(rAt.name === '初段', 'RP=100 → 升初段');

  // emoji 存在
  assert(typeof r0.emoji === 'string' && r0.emoji.length > 0, '新手有 emoji');
  assert(typeof rMax.emoji === 'string' && rMax.emoji.length > 0, '宗師有 emoji');
}

// ══════════════════════════════════════
//  getCurrentSeason
// ══════════════════════════════════════
function testGetCurrentSeason() {
  console.log('\n── getCurrentSeason ──────────────────────');

  const season = getCurrentSeason();
  assert(typeof season === 'number', '回傳 number');
  assert(season > 202000, `season > 202000（實際：${season}）`);
  assert(season < 209912, `season < 209912（不超過合理範圍）`);

  // 格式：yyyyMM，月份 1-12
  const mm = season % 100;
  assert(mm >= 1 && mm <= 12, `月份合法：${mm}`);
}

// ══════════════════════════════════════
//  RANKS 陣列完整性
// ══════════════════════════════════════
function testRanksArray() {
  console.log('\n── RANKS 陣列 ────────────────────────────');

  assert(Array.isArray(RANKS) && RANKS.length >= 4, '至少 4 個段位');

  // 遞增
  for (let i = 1; i < RANKS.length; i++) {
    assert(
      RANKS[i].minRp > RANKS[i - 1].minRp,
      `段位 ${i} minRp 遞增（${RANKS[i-1].minRp} < ${RANKS[i].minRp}）`
    );
  }

  // 每個段位都有 name、emoji、minRp
  for (const r of RANKS) {
    assert(
      r.name && r.emoji && typeof r.minRp === 'number',
      `${r.name}：有 name/emoji/minRp`
    );
  }

  // 第一個段位 minRp 必須為 0
  assert(RANKS[0].minRp === 0, '第一段位 minRp=0');
}

// ══════════════════════════════════════
//  執行
// ══════════════════════════════════════
console.log('══════ 段位系統測試 ══════');
try { testRanksArray();      } catch (e) { console.error('crash:', e.message); _failed++; }
try { testGetRankInfo();     } catch (e) { console.error('crash:', e.message); _failed++; }
try { testGetCurrentSeason();} catch (e) { console.error('crash:', e.message); _failed++; }

console.log(`\n══════ 結果 ══════`);
console.log(`  ✅ 通過：${_passed}`);
console.log(`  ❌ 失敗：${_failed}`);
process.exit(_failed > 0 ? 1 : 0);
