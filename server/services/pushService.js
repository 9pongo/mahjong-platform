// ════════════════════════════════════════
//  server/services/pushService.js
//  Web Push 推播（最佳努力，不拋錯）
// ════════════════════════════════════════
const webpush  = require('web-push');
const supabase = require('../models/supabase');
const logger   = require('../utils/logger');

// ── VAPID 設定（無設定時靜默停用）──────
const VAPID_PUB  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIV = process.env.VAPID_PRIVATE_KEY;
const VAPID_MAIL = process.env.VAPID_EMAIL || 'mailto:admin@mahjong.app';

let _enabled = false;
if (VAPID_PUB && VAPID_PRIV) {
  try {
    webpush.setVapidDetails(VAPID_MAIL, VAPID_PUB, VAPID_PRIV);
    _enabled = true;
    logger.info('[Push] Web Push 已啟用');
  } catch (e) {
    logger.warn('[Push] VAPID 設定失敗：' + e.message);
  }
} else {
  logger.info('[Push] VAPID 未設定，Web Push 停用（設定 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 啟用）');
}

/**
 * 向指定 uid 的所有裝置發送推播
 * @param {string} uid
 * @param {{ title: string, body: string, tag?: string, data?: object }} payload
 */
async function sendPush(uid, payload) {
  if (!_enabled) return;
  try {
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('uid', uid);
    if (error || !subs?.length) return;

    const msg = JSON.stringify({
      title: payload.title || '麻將平台',
      body:  payload.body  || '',
      tag:   payload.tag   || 'default',
      data:  payload.data  || {},
    });

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            msg
          );
        } catch (err) {
          // 410 / 404 → 訂閱已失效，清除
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id);
          }
        }
      })
    );
  } catch (e) {
    // push 為附加功能，絕不影響主流程
    logger.warn('[Push] sendPush 失敗：' + e.message);
  }
}

module.exports = { sendPush, isPushEnabled: () => _enabled };
