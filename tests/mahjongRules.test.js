// ════════════════════════════════════════
//  tests/mahjongRules.test.js
//  麻將規則引擎完整測試（純記憶體，無 DB）
// ════════════════════════════════════════
const {
  checkWin, chowOptions, concealedKongNames,
  addKongNames,
} = require('../shared/mahjongRules');

let _passed = 0;
let _failed = 0;

function assert(cond, label, detail = '') {
  if (cond) {
    console.log(`  ✅ ${label}`);
    _passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    _failed++;
  }
}

function tiles(...names) {
  return names.map((name, i) => ({ id: `t${i}`, name }));
}

// ══════════════════════════════════════
//  checkWin
// ══════════════════════════════════════
function testCheckWin() {
  console.log('\n── checkWin ──────────────────────────────');

  // 七對子
  const sevenPairs = tiles(
    '一萬','一萬','二萬','二萬','三萬','三萬',
    '四萬','四萬','五萬','五萬','六萬','六萬',
    '東','東'
  );
  assert(checkWin(sevenPairs, []), '七對子 14 張（無副露）');

  // 標準和牌：3組 + 1對 = 4面子1雀頭
  const standard = tiles(
    '一萬','二萬','三萬',
    '四萬','五萬','六萬',
    '七萬','八萬','九萬',
    '東','東','東',
    '西','西'
  );
  assert(checkWin(standard, []), '標準：3 順子 + 1 刻子 + 雀頭');

  // 手牌 10 張 + 1 副已碰的（算入面子）
  const hand10 = tiles(
    '一萬','二萬','三萬',
    '四萬','五萬','六萬',
    '北','北','北',
    '白','白'
  );
  const meld1 = tiles('東','東','東');
  assert(checkWin(hand10, [meld1]), '10 張 + 1 副碰（傳入 melds）');

  // 不和：12 張散牌
  const noWin = tiles(
    '一萬','三萬','五萬','七萬',
    '一筒','三筒','五筒',
    '一索','三索',
    '東','南','西','北'
  );
  assert(!checkWin(noWin, []), '散牌不和');

  // 邊界：空手牌應為 false
  assert(!checkWin([], []), '空手牌不和');

  // 全刻：4 刻 + 1 雀頭
  const allPong = tiles(
    '一萬','一萬','一萬',
    '九萬','九萬','九萬',
    '一筒','一筒','一筒',
    '九索','九索','九索',
    '中','中'
  );
  assert(checkWin(allPong, []), '全刻（碰碰胡）14 張');
}

// ══════════════════════════════════════
//  chowOptions
// ══════════════════════════════════════
function testChowOptions() {
  console.log('\n── chowOptions ───────────────────────────');

  const hand = tiles('一萬','二萬','四萬','五萬','七萬','八萬','九萬');

  // 三萬：可左吃(一二三)、中吃(二三四)
  const opts3 = chowOptions(hand, { name: '三萬' });
  assert(Array.isArray(opts3) && opts3.length >= 1, '三萬：至少一種吃法');
  const has123 = opts3.some(o => o.join('') === '一萬二萬三萬');
  assert(has123, '三萬：包含 一二三萬');

  // 六萬：可右吃(四五六)、中吃(五六七)
  const opts6 = chowOptions(hand, { name: '六萬' });
  assert(opts6.length >= 1, '六萬：至少一種吃法');

  // 發（字牌）：不能吃
  const optsZ = chowOptions(hand, { name: '發' });
  assert(!optsZ.length, '字牌無法吃');

  // 一筒（手牌無筒子）：不能吃
  const opts1t = chowOptions(hand, { name: '一筒' });
  assert(!opts1t.length, '無對應手牌時不能吃');
}

// ══════════════════════════════════════
//  concealedKongNames
// ══════════════════════════════════════
function testConcealedKong() {
  console.log('\n── concealedKongNames ────────────────────');

  // 手中有四張一萬
  const hand4 = tiles('一萬','一萬','一萬','一萬','二萬','三萬');
  const kongs = concealedKongNames(hand4);
  assert(kongs.includes('一萬'), '四張一萬 → 可暗槓');
  assert(!kongs.includes('二萬'), '只有一張二萬 → 不可暗槓');

  // 沒有四張同名
  const handNone = tiles('一萬','二萬','三萬','四萬','五萬','六萬');
  assert(!concealedKongNames(handNone).length, '無四張同名 → 無暗槓');
}

// ══════════════════════════════════════
//  addKongNames（加槓）
// ══════════════════════════════════════
function testAddKong() {
  console.log('\n── addKongNames ──────────────────────────');

  const hand  = tiles('東','二萬','三萬');
  const melds = [tiles('東','東','東')];  // 已碰的刻子

  const addable = addKongNames(hand, melds);
  assert(addable.includes('東'), '手中有東且已碰東 → 可加槓');

  const melds2 = [tiles('南','南','南')];
  assert(!addKongNames(hand, melds2).includes('東'), '已碰的不是東 → 不可加槓東');
  assert(!addKongNames(hand, melds2).includes('南'), '手中無南 → 不可加槓南');
}

// ══════════════════════════════════════
//  執行
// ══════════════════════════════════════
console.log('══════ 麻將規則測試 ══════');
try { testCheckWin();     } catch (e) { console.error('checkWin crash:', e.message); _failed++; }
try { testChowOptions();  } catch (e) { console.error('chowOptions crash:', e.message); _failed++; }
try { testConcealedKong();} catch (e) { console.error('concealedKong crash:', e.message); _failed++; }
try { testAddKong();      } catch (e) { console.error('addKong crash:', e.message); _failed++; }

console.log(`\n══════ 結果 ══════`);
console.log(`  ✅ 通過：${_passed}`);
console.log(`  ❌ 失敗：${_failed}`);
console.log('══════════════════\n');
process.exit(_failed > 0 ? 1 : 0);
