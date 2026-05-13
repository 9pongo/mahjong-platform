// ════════════════════════════════════════
//  tests/validate.test.js
//  輸入驗證中介層測試（無 DB、無 Express 依賴）
// ════════════════════════════════════════
const { validate, sanitize } = require('../server/middleware/validate');

let _passed = 0;
let _failed = 0;

function assert(cond, label, detail = '') {
  if (cond) { console.log(`  ✅ ${label}`); _passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); _failed++; }
}

// ── Mock Express req/res/next ───────────
function mockReq(body = {}, query = {}, params = {}) {
  return { body, query, params };
}
function mockRes() {
  const r = { _status: 200, _body: null };
  r.status = (s) => { r._status = s; return r; };
  r.json   = (b) => { r._body = b; return r; };
  return r;
}

// ── 執行 middleware pipeline ───────────
function run(middlewares, req) {
  const res  = mockRes();
  let called = false;
  const next = () => { called = true; };
  for (const mw of middlewares) {
    if (res._body) break;   // 已回應就停
    mw(req, res, next);
  }
  return { res, nextCalled: called };
}

// ══════════════════════════════════════
//  validate 測試
// ══════════════════════════════════════
function testValidateString() {
  console.log('\n── validate string ───────────────────────');

  const mw = validate({ username: 'string|2-16' });

  const { res: r1, nextCalled: n1 } = run([mw], mockReq({ username: 'Alice' }));
  assert(n1 && !r1._body, '合法 username → next()');

  const { res: r2, nextCalled: n2 } = run([mw], mockReq({ username: 'A' }));
  assert(!n2 && r2._status === 400, '太短 → 400');
  assert(r2._body?.error?.includes('username'), '錯誤訊息含欄位名');

  const { res: r3, nextCalled: n3 } = run([mw], mockReq({}));
  assert(!n3 && r3._status === 400, '缺失必填 → 400');

  const { res: r4, nextCalled: n4 } = run([mw], mockReq({ username: 'A'.repeat(17) }));
  assert(!n4 && r4._status === 400, '太長 → 400');
}

function testValidateInt() {
  console.log('\n── validate int ──────────────────────────');

  const mw = validate({ days: 'int|1-365' });

  const { nextCalled: n1 } = run([mw], mockReq({ days: 30 }));
  assert(n1, '合法整數 30 → next()');

  const { res: r2 } = run([mw], mockReq({ days: 0 }));
  assert(r2._status === 400, '0 超出範圍 → 400');

  const { res: r3 } = run([mw], mockReq({ days: 1.5 }));
  assert(r3._status === 400, '浮點數 → 400');

  const { res: r4 } = run([mw], mockReq({ days: 'abc' }));
  assert(r4._status === 400, '非數字字串 → 400');
}

function testValidateOptional() {
  console.log('\n── validate optional ─────────────────────');

  const mw = validate({ bio: 'optional:string|0-200' });

  const { nextCalled: n1 } = run([mw], mockReq({}));
  assert(n1, '選填欄位缺失 → next()');

  const { nextCalled: n2 } = run([mw], mockReq({ bio: '你好' }));
  assert(n2, '選填欄位合法 → next()');

  const { res: r3 } = run([mw], mockReq({ bio: 'X'.repeat(201) }));
  assert(r3._status === 400, '選填欄位超長 → 400');
}

function testValidateMultiple() {
  console.log('\n── validate multiple fields ──────────────');

  const mw = validate({
    username: 'string|2-16',
    age:      'optional:int|0-150',
  });

  const { nextCalled: n1 } = run([mw], mockReq({ username: 'Bob', age: 25 }));
  assert(n1, '兩欄位皆合法 → next()');

  const { res: r2 } = run([mw], mockReq({ username: 'B', age: 25 }));
  assert(r2._status === 400, 'username 不合法 → 400，即使 age 合法');
}

// ══════════════════════════════════════
//  sanitize 測試
// ══════════════════════════════════════
function testSanitize() {
  console.log('\n── sanitize XSS ──────────────────────────');

  const mw  = sanitize('username', 'bio');
  const req = mockReq({ username: '<script>alert(1)</script>', bio: 'ok & fine' });
  run([mw], req);

  assert(!req.body.username.includes('<script>'), 'script tag 已過濾');
  assert(req.body.username.includes('&lt;'), '< → &lt;');
  assert(req.body.bio.includes('&amp;'), '& → &amp;');

  // 非字串欄位不受影響
  const req2 = mockReq({ username: 42, bio: null });
  run([mw], req2);
  assert(req2.body.username === 42, '非字串欄位不被修改');
}

// ══════════════════════════════════════
//  執行
// ══════════════════════════════════════
console.log('══════ 輸入驗證測試 ══════');
try { testValidateString();   } catch (e) { console.error('crash:', e.message); _failed++; }
try { testValidateInt();      } catch (e) { console.error('crash:', e.message); _failed++; }
try { testValidateOptional(); } catch (e) { console.error('crash:', e.message); _failed++; }
try { testValidateMultiple(); } catch (e) { console.error('crash:', e.message); _failed++; }
try { testSanitize();         } catch (e) { console.error('crash:', e.message); _failed++; }

console.log(`\n══════ 結果 ══════`);
console.log(`  ✅ 通過：${_passed}`);
console.log(`  ❌ 失敗：${_failed}`);
process.exit(_failed > 0 ? 1 : 0);
