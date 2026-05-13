// ════════════════════════════════════════
//  client/js/pushClient.js
//  Web Push 訂閱管理（封裝 PushManager API）
// ════════════════════════════════════════
import { authManager } from './auth.js';

const API = '/api/push';

/** Base64URL → Uint8Array（VAPID applicationServerKey 需要） */
function _urlB64ToUint8Array(b64) {
  const pad  = '='.repeat((4 - (b64.length % 4)) % 4);
  const b64s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw  = atob(b64s);
  return Uint8Array.from(Array.from(raw, c => c.charCodeAt(0)));
}

export const pushClient = {
  /** 檢查當前環境是否支援 Web Push */
  isSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  },

  /**
   * 取得目前推播狀態
   * @returns {'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'}
   */
  async getStatus() {
    if (!this.isSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      return sub ? 'subscribed' : 'unsubscribed';
    } catch {
      return 'unsupported';
    }
  },

  /**
   * 訂閱推播，向 API 儲存訂閱資訊
   * @returns {boolean} 是否成功
   */
  async subscribe() {
    if (!this.isSupported()) return false;
    try {
      // 取 VAPID 公鑰
      const res = await fetch(`${API}/vapid-public-key`);
      const { enabled, publicKey } = await res.json();
      if (!enabled) return 'not_configured';   // 伺服器未設定 VAPID

      // 請求通知權限
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return false;

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: _urlB64ToUint8Array(publicKey),
      });

      // 上傳訂閱到伺服器
      const token = authManager.getToken();
      const r = await fetch(`${API}/subscribe`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(sub.toJSON()),
      });
      return r.ok;
    } catch (e) {
      console.warn('[Push] subscribe 失敗', e);
      return false;
    }
  },

  /**
   * 取消訂閱並通知伺服器
   */
  async unsubscribe() {
    if (!this.isSupported()) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;

      const token = authManager.getToken();
      await fetch(`${API}/unsubscribe`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    } catch (e) {
      console.warn('[Push] unsubscribe 失敗', e);
    }
  },
};
