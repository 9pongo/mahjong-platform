// ════════════════════════════════════════
//  scripts/generate-vapid.js
//  產生 VAPID 金鑰對，貼到 Railway 環境變數
// ════════════════════════════════════════
const webpush = require('web-push');
const keys    = webpush.generateVAPIDKeys();

console.log('\n🔑  VAPID 金鑰產生完成！請將以下三個環境變數加入 Railway / .env：\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_EMAIL=mailto:your-email@example.com`);
console.log('\n⚠️  私鑰請勿洩露或提交至版本控制！\n');
