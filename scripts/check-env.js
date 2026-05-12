#!/usr/bin/env node
// ════════════════════════════════════════
//  scripts/check-env.js
//  啟動前確認所有必要環境變數都已填寫
//  執行：node scripts/check-env.js
// ════════════════════════════════════════
require('dotenv').config();

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'JWT_SECRET',
];

const OPTIONAL = [
  'PORT',
  'NODE_ENV',
  'CLIENT_ORIGIN',
  'ECPAY_MERCHANT_ID',
];

let ok = true;

console.log('\n══════ 環境變數檢查 ══════\n');

for (const key of REQUIRED) {
  const val = process.env[key];
  if (!val || val.includes('xxxx') || val === 'your-secret-key-change-me') {
    console.log(`❌  ${key}  ← 必填，尚未設定`);
    ok = false;
  } else {
    const preview = val.length > 20 ? val.slice(0, 12) + '...' : val;
    console.log(`✅  ${key} = ${preview}`);
  }
}

console.log('');
for (const key of OPTIONAL) {
  const val = process.env[key];
  console.log(`⬜  ${key} = ${val || '(未設定，使用預設值)'}`);
}

if (!process.env.ECPAY_MERCHANT_ID) {
  console.log('\n ℹ️  ECPAY_MERCHANT_ID 未設定 → 商城為 Mock 模式（直接到帳）');
}

console.log('\n══════════════════════════\n');

if (!ok) {
  console.error('🚫 有必填欄位未設定，請先編輯 .env 再啟動伺服器\n');
  process.exit(1);
} else {
  console.log('✅ 環境變數檢查通過\n');
}
